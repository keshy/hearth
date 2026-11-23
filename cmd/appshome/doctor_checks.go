package main

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"appshome/internal/builder"
	"appshome/internal/cast"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

// randomizedMAC reports a locally administered address, which is what
// macOS Private Wi-Fi Address uses.
func randomizedMAC(mac string) bool {
	hw, err := net.ParseMAC(mac)
	return err == nil && len(hw) > 0 && hw[0]&0x02 != 0
}

func checkRepo(r *report, cfg config.Config) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	repo := cfg.RepoPath()
	if cfg.GitMode() {
		if _, err := deploy.Git(ctx, os.TempDir(), "ls-remote", "--heads", cfg.RepoURL, cfg.Branch); err != nil {
			r.fail("can't read %s: %v", cfg.RepoURL, err)
			r.info("the service runs as this user, so its git credentials (SSH key or credential helper) must work non-interactively")
		} else {
			r.ok("remote %s @ %s reachable", cfg.RepoURL, cfg.Branch)
		}
	} else {
		r.ok("local folder %s (rescanned every %ds)", repo, cfg.PollSeconds)
	}

	if _, err := os.Stat(filepath.Join(repo, "apps")); err != nil {
		r.info("no apps/ checked out at %s yet (the first deploy creates it)", repo)
	} else {
		apps, problems := registry.Discover(repo)
		r.ok("%d app manifest(s) valid in %s/apps", len(apps), repo)
		for name, p := range problems {
			r.fail("apps/%s: %s", name, p)
		}
	}

	if b, err := os.ReadFile(cfg.StatePath()); err == nil {
		var st deploy.State
		if json.Unmarshal(b, &st) == nil {
			if st.Commit.SHA != "" {
				r.ok("deployed %s %q %s", st.Commit.Short(), st.Commit.Subject, ago(st.DeployedAt))
			}
			for name, a := range st.Apps {
				if a.Status != "live" {
					r.warn("%s: %s", name, a.Error)
				}
			}
			if st.LastError != "" {
				r.fail("last sync: %s", st.LastError)
			}
		}
	} else {
		r.info("nothing deployed yet")
	}
}

func checkBuilder(r *report, cfg config.Config) {
	project := builder.ResolveProject(cfg)
	if project == "" {
		r.warn("no GCP project; set one with: appshome init --gcp-project ID (or gcloud config set project ID)")
	} else {
		r.ok("project %s, location %s, model %s", project, cfg.GCPLocation, cfg.GeminiModel)
	}
	adc := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if adc == "" {
		home, _ := os.UserHomeDir()
		adc = filepath.Join(home, ".config", "gcloud", "application_default_credentials.json")
	}
	if _, err := os.Stat(adc); err != nil {
		r.warn("no Application Default Credentials; run: gcloud auth application-default login")
	} else {
		r.ok("credentials %s", adc)
	}
	repo := cfg.RepoPath()
	for _, f := range []string{builder.RulesFile, builder.TemplateDir} {
		if _, err := os.Stat(filepath.Join(repo, f)); err != nil {
			r.info("%s not found in %s yet (needed by the builder)", f, repo)
		}
	}
	if cfg.GitMode() {
		r.info("the builder pushes to %s; make sure this user can push there", cfg.Branch)
	}
}

func checkConnect(r *report, cfg config.Config) {
	if runtime.GOOS != "darwin" {
		r.info("needs the macOS host")
		return
	}
	ytdlp := filepath.Join(cfg.ToolsDir(), "yt-dlp")
	if out, err := exec.Command(ytdlp, "--version").Output(); err != nil {
		r.warn("yt-dlp isn't installed yet; appshome serve downloads it to %s", cfg.ToolsDir())
	} else {
		r.ok("yt-dlp %s", strings.TrimSpace(string(out)))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ds, err := cast.Discover(ctx, 2500*time.Millisecond)
	switch {
	case err != nil:
		r.warn("couldn't look for devices: %v", err)
	case len(ds) == 0:
		r.info("no Cast speakers or TVs answered on this network")
	default:
		for _, d := range ds {
			r.ok("%s (%s) at %s", d.Name, d.Model, d.Addr)
		}
	}
}

func ago(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return time.Since(t).Round(time.Second).String() + " ago"
}
