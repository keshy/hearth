package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/term"

	"appshome/internal/caddy"
	"appshome/internal/deploy"
	"appshome/internal/netinfo"
)

func cmdInit(args []string) error {
	fs := flag.NewFlagSet("init", flag.ExitOnError)
	data := dataFlag(fs)
	domain := fs.String("domain", "", "apps domain (default apps.home)")
	httpPort := fs.Int("http-port", 0, "HTTP port Caddy listens on (default 80)")
	httpsPort := fs.Int("https-port", 0, "HTTPS port Caddy listens on (default 443)")
	appListen := fs.String("app-listen", "", "address the portal/admin server binds (default 127.0.0.1:7070)")
	caddyAdmin := fs.String("caddy-admin", "", "Caddy admin API address (default localhost:2019)")
	dnsListen := fs.String("dns-listen", "", "DNS listen address (default auto: :53, falling back to <lan-ip>:53)")
	iface := fs.String("interface", "", "pin the LAN interface instead of auto-detecting")
	lanIP := fs.String("lan-ip", "", "pin the LAN IP instead of auto-detecting")
	repoURL := fs.String("repo-url", "", "git remote to deploy apps from (empty: use --repo-dir as a local folder)")
	repoDir := fs.String("repo-dir", "", "checkout location (git mode) or local apps repo (local mode)")
	branch := fs.String("branch", "", "branch to deploy (default main)")
	poll := fs.Int("poll", 0, "seconds between checks for new commits (default 60)")
	project := fs.String("gcp-project", "", "GCP project for the builder's Gemini calls (default: gcloud's)")
	location := fs.String("gcp-location", "", "Vertex AI location (default global)")
	model := fs.String("gemini-model", "", "Gemini model for the builder (default gemini-4-argon)")
	fs.Parse(args)

	cfg, existed, err := loadOrDefault(*data)
	if err != nil {
		return err
	}
	fs.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "domain":
			cfg.Domain = strings.ToLower(*domain)
		case "http-port":
			cfg.HTTPPort = *httpPort
		case "https-port":
			cfg.HTTPSPort = *httpsPort
		case "app-listen":
			cfg.AppListen = *appListen
		case "caddy-admin":
			cfg.CaddyAdmin = *caddyAdmin
		case "dns-listen":
			cfg.DNSListen = *dnsListen
		case "interface":
			cfg.Interface = *iface
		case "lan-ip":
			cfg.LANIP = *lanIP
		case "repo-url":
			cfg.RepoURL = *repoURL
		case "repo-dir":
			cfg.RepoDir = *repoDir
		case "branch":
			cfg.Branch = *branch
		case "poll":
			cfg.PollSeconds = *poll
		case "gcp-project":
			cfg.GCPProject = *project
		case "gcp-location":
			cfg.GCPLocation = *location
		case "gemini-model":
			cfg.GeminiModel = *model
		}
	})
	if err := cfg.Validate(); err != nil {
		return err
	}
	if !cfg.GitMode() && cfg.RepoDir == "" {
		return errors.New("set --repo-url (deploy from git) or --repo-dir (local folder with apps/)")
	}
	for _, d := range []string{cfg.LogsDir(), cfg.LiveDir(), cfg.ReleasesDir(), cfg.AppDataDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	engine := deploy.New(cfg, log.New(os.Stderr, "", 0), nil)
	if _, err := caddy.Write(caddyInput(cfg, engine.Apps(), engine.LiveDir)); err != nil {
		return err
	}

	verb := "Created"
	if existed {
		verb = "Updated"
	}
	fmt.Printf("%s %s\n", verb, cfg.Path())
	fmt.Printf("Wrote   %s\n", cfg.CaddyfilePath())
	if cfg.GitMode() {
		fmt.Printf("Apps    %s @ %s (checked out to %s)\n", cfg.RepoURL, cfg.Branch, cfg.RepoPath())
	} else {
		fmt.Printf("Apps    %s (local folder)\n", cfg.RepoPath())
	}
	if info, err := netinfo.Discover(cfg.Interface, cfg.LANIP); err == nil {
		fmt.Printf("LAN     %s on %s (router %s)\n", info.IP, info.Interface, orDash(info.Gateway))
	} else {
		fmt.Printf("LAN     not detected yet: %v\n", err)
	}
	return nil
}

func cmdSetPassword(args []string) error {
	fs := flag.NewFlagSet("set-password", flag.ExitOnError)
	data := dataFlag(fs)
	stdin := fs.Bool("stdin", false, "read the password from stdin instead of prompting")
	ifUnset := fs.Bool("if-unset", false, "do nothing if a password is already set")
	fs.Parse(args)

	cfg, _, err := loadOrDefault(*data)
	if err != nil {
		return err
	}
	if *ifUnset && cfg.AdminPasswordHash != "" {
		fmt.Println("Admin password already set; leaving it unchanged.")
		return nil
	}

	var pw string
	switch {
	case *stdin:
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return err
		}
		pw = strings.TrimRight(line, "\r\n")
	case term.IsTerminal(int(os.Stdin.Fd())):
		fmt.Print("New admin password (user is \"admin\"): ")
		a, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil {
			return err
		}
		fmt.Print("Repeat it: ")
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil {
			return err
		}
		if string(a) != string(b) {
			return errors.New("passwords don't match")
		}
		pw = string(a)
	default:
		return errors.New("no terminal; pass --stdin and pipe the password in")
	}
	if len(pw) < 8 {
		return errors.New("use at least 8 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	cfg.AdminPasswordHash = string(hash)
	if err := cfg.Save(); err != nil {
		return err
	}
	// Private apps get the hash through the Caddyfile; refresh it if running.
	c := &http.Client{Timeout: 5 * time.Second}
	if resp, err := c.Post("http://"+cfg.AppListen+"/_internal/reload", "application/json", nil); err == nil {
		resp.Body.Close()
	}
	fmt.Printf("Admin password saved. Sign in at %s as user \"admin\".\n", cfg.AdminURL())
	return nil
}

func cmdCaddyfile(args []string) error {
	fs := flag.NewFlagSet("caddyfile", flag.ExitOnError)
	data := dataFlag(fs)
	fs.Parse(args)
	cfg, _, err := loadOrDefault(*data)
	if err != nil {
		return err
	}
	engine := deploy.New(cfg, log.New(os.Stderr, "", 0), nil)
	fmt.Print(caddy.Render(caddyInput(cfg, engine.Apps(), engine.LiveDir)))
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
