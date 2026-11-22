// Package deploy turns the apps in the repo into live sites: it pulls the
// configured branch, builds static apps whose files changed into immutable
// release folders, and atomically repoints live/<name> at the new release.
package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"appshome/internal/config"
	"appshome/internal/registry"
)

type AppState struct {
	App        registry.App `json:"app"`
	Hash       string       `json:"hash,omitempty"`
	Release    string       `json:"release,omitempty"`
	Status     string       `json:"status"` // live, failed
	Error      string       `json:"error,omitempty"`
	DeployedAt time.Time    `json:"deployed_at"`
}

// Serving reports whether Caddy should route to this app.
func (s AppState) Serving() bool { return !s.App.NeedsSite() || s.Release != "" }

type State struct {
	Commit     Commit              `json:"commit"`
	DeployedAt time.Time           `json:"deployed_at"`
	CheckedAt  time.Time           `json:"checked_at"`
	Apps       map[string]AppState `json:"apps"`
	Problems   map[string]string   `json:"problems,omitempty"`
	LastError  string              `json:"last_error,omitempty"`
}

type Engine struct {
	cfg      config.Config
	log      *log.Logger
	onChange func([]registry.App) error

	mu      sync.Mutex // one sync at a time
	stateMu sync.RWMutex
	state   State
}

const buildTimeout = 15 * time.Minute

func New(cfg config.Config, logger *log.Logger, onChange func([]registry.App) error) *Engine {
	e := &Engine{cfg: cfg, log: logger, onChange: onChange, state: State{Apps: map[string]AppState{}}}
	if b, err := os.ReadFile(cfg.StatePath()); err == nil {
		var s State
		if json.Unmarshal(b, &s) == nil && s.Apps != nil {
			e.state = s
		}
	}
	return e
}

func (e *Engine) State() State {
	e.stateMu.RLock()
	defer e.stateMu.RUnlock()
	return e.state
}

// Apps returns everything Caddy should currently serve.
func (e *Engine) Apps() []registry.App {
	s := e.State()
	var out []registry.App
	for _, st := range s.Apps {
		if st.Serving() {
			out = append(out, st.App)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (e *Engine) LiveDir(name string) string { return filepath.Join(e.cfg.LiveDir(), name) }

func (e *Engine) BuildLog(name string) string {
	return filepath.Join(e.cfg.BuildLogsDir(), name+".log")
}

// Sync pulls the latest commit (in git mode) and deploys it if anything
// changed. force redeploys even when the commit is unchanged; unchanged apps
// still reuse their existing release.
func (e *Engine) Sync(ctx context.Context, force bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	commit, err := e.update(ctx)
	prev := e.State()
	if err != nil {
		e.setError(prev, err)
		return err
	}
	// Local folders can change without a new commit, so they always re-scan;
	// unchanged apps are cheap because their release is reused.
	if e.cfg.GitMode() && !force && commit.SHA == prev.Commit.SHA {
		e.touch()
		return nil
	}
	if e.cfg.GitMode() || force {
		e.log.Printf("deploying %s", strings.TrimSpace(commit.Short()+" "+strconv.Quote(commit.Subject)))
	}
	next := e.deploy(ctx, prev, commit)
	if err := e.save(next); err != nil {
		e.log.Printf("save state: %v", err)
	}
	e.prune(next)
	if e.onChange != nil {
		if err := e.onChange(e.Apps()); err != nil {
			e.log.Printf("caddy reload failed: %v", err)
			next.LastError = "caddy reload failed: " + err.Error()
			e.save(next)
			return err
		}
	}
	return nil
}

func (e *Engine) update(ctx context.Context) (Commit, error) {
	repo := e.cfg.RepoPath()
	if !e.cfg.GitMode() {
		if !IsGitRepo(repo) {
			return Commit{SHA: "", Subject: "local folder", Time: time.Now()}, nil
		}
		c, err := commitInfo(ctx, repo, "HEAD")
		if err == nil {
			if dirty, _ := Git(ctx, repo, "status", "--porcelain", "--", "apps"); dirty != "" {
				c.SHA += "-dirty"
			}
		}
		return c, err
	}
	if err := EnsureClone(ctx, e.cfg.RepoURL, e.cfg.Branch, repo); err != nil {
		return Commit{}, err
	}
	if _, err := Git(ctx, repo, "fetch", "--prune", "origin", e.cfg.Branch); err != nil {
		return Commit{}, err
	}
	target := "origin/" + e.cfg.Branch
	if _, err := Git(ctx, repo, "checkout", "--force", "--detach", target); err != nil {
		return Commit{}, err
	}
	if _, err := Git(ctx, repo, "clean", "-ffdx"); err != nil {
		return Commit{}, err
	}
	return commitInfo(ctx, repo, "HEAD")
}

func (e *Engine) deploy(ctx context.Context, prev State, commit Commit) State {
	repo := e.cfg.RepoPath()
	apps, problems := registry.Discover(repo)
	now := time.Now()
	next := State{Commit: commit, DeployedAt: now, CheckedAt: now, Apps: map[string]AppState{}, Problems: problems}

	for _, a := range apps {
		if IsGitRepo(repo) {
			a.Created, a.Updated = pathTimes(ctx, repo, "apps/"+a.Name)
		}
		if a.Created.IsZero() {
			a.Created, a.Updated = now, now
		}
		old, hadOld := prev.Apps[a.Name]

		if !a.NeedsSite() {
			next.Apps[a.Name] = AppState{App: a, Status: "live", DeployedAt: now}
			continue
		}
		src := filepath.Join(repo, "apps", a.Name)
		hash, err := HashDir(src)
		if err != nil {
			next.Apps[a.Name] = e.failed(a, old, hadOld, err)
			continue
		}
		if hadOld && old.Hash == hash && dirExists(old.Release) {
			old.App = a
			old.Status, old.Error = "live", ""
			next.Apps[a.Name] = old
			e.swapLive(a.Name, old.Release)
			continue
		}
		rel, err := e.build(ctx, a, src, hash)
		if err != nil {
			e.log.Printf("%s: build failed: %v", a.Name, err)
			next.Apps[a.Name] = e.failed(a, old, hadOld, err)
			continue
		}
		if err := e.swapLive(a.Name, rel); err != nil {
			next.Apps[a.Name] = e.failed(a, old, hadOld, err)
			continue
		}
		e.log.Printf("%s: live (%s)", a.Name, hash[:12])
		next.Apps[a.Name] = AppState{App: a, Hash: hash, Release: rel, Status: "live", DeployedAt: now}
	}

	for name := range prev.Apps {
		if _, ok := next.Apps[name]; !ok {
			if _, broken := problems[name]; broken && prev.Apps[name].Serving() {
				// Keep serving the last good version while the manifest is broken.
				st := prev.Apps[name]
				st.Status, st.Error = "failed", "app.yaml: "+problems[name]
				next.Apps[name] = st
				continue
			}
			os.Remove(e.LiveDir(name))
			e.log.Printf("%s: removed", name)
		}
	}
	return next
}

// failed keeps the previous release online (with its previous manifest) when
// a new version can't be built.
func (e *Engine) failed(a registry.App, old AppState, hadOld bool, err error) AppState {
	if hadOld && old.Release != "" && dirExists(old.Release) {
		old.Status, old.Error = "failed", err.Error()+" (still serving the previous version)"
		return old
	}
	return AppState{App: a, Status: "failed", Error: err.Error(), DeployedAt: time.Now()}
}

func (e *Engine) build(ctx context.Context, a registry.App, src, hash string) (string, error) {
	rel := filepath.Join(e.cfg.ReleasesDir(), a.Name, hash[:16])
	if dirExists(rel) {
		return rel, nil
	}
	for _, d := range []string{filepath.Dir(rel), e.cfg.BuildLogsDir(), e.cfg.BuildsDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return "", err
		}
	}
	tmp := rel + ".tmp"
	os.RemoveAll(tmp)
	defer os.RemoveAll(tmp)

	logf, err := os.Create(e.BuildLog(a.Name))
	if err != nil {
		return "", err
	}
	defer logf.Close()
	fmt.Fprintf(logf, "== %s build %s at %s\n", a.Name, hash[:12], time.Now().Format(time.RFC3339))

	outDir := filepath.Join(src, a.Output)
	if a.Build != "" {
		work := filepath.Join(e.cfg.BuildsDir(), a.Name+"-"+hash[:12])
		os.RemoveAll(work)
		defer os.RemoveAll(work)
		if err := CopyDir(src, work, nil); err != nil {
			return "", err
		}
		fmt.Fprintf(logf, "$ %s\n", a.Build)
		bctx, cancel := context.WithTimeout(ctx, buildTimeout)
		defer cancel()
		cmd := exec.CommandContext(bctx, "/bin/sh", "-c", a.Build)
		cmd.Dir = work
		cmd.Env = append(os.Environ(), "CI=1", "APPS_HOME_APP="+a.Name)
		cmd.Stdout, cmd.Stderr = logf, logf
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("build command failed (%v); see build log", err)
		}
		outDir = filepath.Join(work, a.Output)
	}

	skip := map[string]bool{}
	if a.Output == "." {
		skip[registry.ManifestFile] = true
	}
	if err := CopyDir(outDir, tmp, skip); err != nil {
		return "", fmt.Errorf("collect output %q: %w", a.Output, err)
	}
	if _, err := os.Stat(filepath.Join(tmp, "index.html")); err != nil {
		return "", fmt.Errorf("no index.html in output folder %q", a.Output)
	}
	if err := os.Rename(tmp, rel); err != nil {
		return "", err
	}
	fmt.Fprintf(logf, "== release %s\n", rel)
	return rel, nil
}

func (e *Engine) swapLive(name, rel string) error {
	if err := os.MkdirAll(e.cfg.LiveDir(), 0o755); err != nil {
		return err
	}
	if cur, err := os.Readlink(e.LiveDir(name)); err == nil && cur == rel {
		return nil
	}
	return swapSymlink(rel, e.LiveDir(name))
}

// prune keeps the live release plus the two newest others per app.
func (e *Engine) prune(s State) {
	dirs, _ := os.ReadDir(e.cfg.ReleasesDir())
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		appDir := filepath.Join(e.cfg.ReleasesDir(), d.Name())
		st, active := s.Apps[d.Name()]
		if !active {
			os.RemoveAll(appDir)
			continue
		}
		rels, _ := os.ReadDir(appDir)
		type relInfo struct {
			path string
			mod  time.Time
		}
		var list []relInfo
		for _, r := range rels {
			p := filepath.Join(appDir, r.Name())
			if p == st.Release {
				continue
			}
			if info, err := r.Info(); err == nil {
				list = append(list, relInfo{p, info.ModTime()})
			}
		}
		sort.Slice(list, func(i, j int) bool { return list[i].mod.After(list[j].mod) })
		for i, r := range list {
			if i >= 2 || strings.HasSuffix(r.path, ".tmp") {
				os.RemoveAll(r.path)
			}
		}
	}
}

func (e *Engine) save(s State) error {
	e.stateMu.Lock()
	e.state = s
	e.stateMu.Unlock()
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return config.WriteFileAtomic(e.cfg.StatePath(), append(b, '\n'), 0o644)
}

func (e *Engine) touch() {
	e.stateMu.Lock()
	e.state.CheckedAt = time.Now()
	e.state.LastError = ""
	e.stateMu.Unlock()
}

func (e *Engine) setError(prev State, err error) {
	e.log.Printf("sync failed: %v", err)
	prev.CheckedAt = time.Now()
	prev.LastError = err.Error()
	e.save(prev)
}

// Poll syncs every PollSeconds until ctx ends.
func (e *Engine) Poll(ctx context.Context) {
	t := time.NewTicker(time.Duration(e.cfg.PollSeconds) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			e.Sync(ctx, false)
		}
	}
}

func dirExists(p string) bool {
	if p == "" {
		return false
	}
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
