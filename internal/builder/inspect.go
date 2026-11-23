package builder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"

	"appshome/internal/deploy"
	"appshome/internal/registry"
)

const (
	maxListedFiles = 500
	maxViewBytes   = 256 << 10
	maxReviewBytes = 96 << 10
	historyLimit   = 30
	builderAuthor  = "apps-home builder"
)

// Change is one commit that touched an app.
type Change struct {
	SHA     string    `json:"sha"`
	Short   string    `json:"short"`
	Author  string    `json:"author"`
	Date    time.Time `json:"date"`
	Subject string    `json:"subject"`
	Prompt  string    `json:"prompt,omitempty"`
	Builder bool      `json:"builder"`
}

type FileInfo struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// Check is one finding from Diagnose. Level is error, warn or ok.
type Check struct {
	Level   string `json:"level"`
	Title   string `json:"title"`
	Detail  string `json:"detail,omitempty"`
	File    string `json:"file,omitempty"`
	Fixable bool   `json:"fixable,omitempty"`
}

type ReviewIssue struct {
	Severity string `json:"severity"`
	File     string `json:"file"`
	Problem  string `json:"problem"`
	Fix      string `json:"fix"`
}

type Review struct {
	Summary   string        `json:"summary"`
	Issues    []ReviewIssue `json:"issues"`
	FixPrompt string        `json:"fix_prompt"`
	Model     string        `json:"model"`
}

type Diagnosis struct {
	Checks    []Check `json:"checks"`
	Review    *Review `json:"review,omitempty"`
	ReviewErr string  `json:"review_error,omitempty"`
	FixPrompt string  `json:"fix_prompt,omitempty"`
}

// Symptoms are the runtime facts the web layer knows about an app.
type Symptoms struct {
	Status       string   `json:"status"`
	DeployError  string   `json:"deploy_error,omitempty"`
	Health       string   `json:"health,omitempty"` // proxied apps: up, down, unknown
	HealthDetail string   `json:"health_detail,omitempty"`
	ClientErrors []string `json:"client_errors,omitempty"`
}

// AppDir is the app's source in the checkout that's deployed.
func (b *Builder) AppDir(name string) (string, error) {
	if err := registry.ValidateName(name); err != nil {
		return "", err
	}
	dir := filepath.Join(b.cfg.RepoPath(), "apps", name)
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return "", fmt.Errorf("no app called %q in the repo", name)
	}
	return dir, nil
}

// History lists the commits that touched apps/<name>, newest first, with the
// request text the builder records in its commit messages.
func (b *Builder) History(ctx context.Context, name string) ([]Change, error) {
	if _, err := b.AppDir(name); err != nil {
		return nil, err
	}
	repo := b.cfg.RepoPath()
	if !deploy.IsGitRepo(repo) {
		return []Change{}, nil
	}
	out, err := deploy.Git(ctx, repo, "log", fmt.Sprintf("-%d", historyLimit),
		"--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e", "--", "apps/"+name)
	if err != nil {
		return nil, err
	}
	return parseLog(out), nil
}

func parseLog(out string) []Change {
	changes := []Change{}
	for _, rec := range strings.Split(out, "\x1e") {
		f := strings.Split(strings.TrimLeft(rec, "\n"), "\x1f")
		if len(f) < 6 {
			continue
		}
		at, _ := time.Parse(time.RFC3339, f[3])
		changes = append(changes, Change{
			SHA: f[0], Short: f[1], Author: f[2], Date: at, Subject: f[4],
			Prompt: requestFromBody(f[5]), Builder: f[2] == builderAuthor,
		})
	}
	return changes
}

func requestFromBody(body string) string {
	_, after, ok := strings.Cut(body, "Request:\n")
	if !ok {
		return ""
	}
	if i := strings.LastIndex(after, "\n\nModel:"); i >= 0 {
		after = after[:i]
	}
	return strings.TrimSpace(after)
}

// Files lists the app's source files.
func (b *Builder) Files(name string) ([]FileInfo, error) {
	dir, err := b.AppDir(name)
	if err != nil {
		return nil, err
	}
	files := []FileInfo{}
	err = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != dir && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		if len(files) >= maxListedFiles {
			return fs.SkipAll
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		files = append(files, FileInfo{Path: filepath.ToSlash(rel), Size: info.Size()})
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, err
}

// ReadFile returns one text file from the app's source.
func (b *Builder) ReadFile(name, rel string) (string, error) {
	dir, err := b.AppDir(name)
	if err != nil {
		return "", err
	}
	clean := path.Clean("/" + rel)[1:]
	if clean == "" || strings.HasPrefix(path.Base(clean), ".") {
		return "", errors.New("bad path")
	}
	p := filepath.Join(dir, filepath.FromSlash(clean))
	if r, err := filepath.Rel(dir, p); err != nil || strings.HasPrefix(r, "..") {
		return "", errors.New("bad path")
	}
	fi, err := os.Lstat(p)
	if err != nil || !fi.Mode().IsRegular() {
		return "", fmt.Errorf("no file %s", clean)
	}
	if fi.Size() > maxViewBytes {
		return "", fmt.Errorf("%s is %d KB; only files up to %d KB are shown", clean, fi.Size()>>10, maxViewBytes>>10)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("%s isn't a text file", clean)
	}
	return string(data), nil
}

var (
	localRefRE  = regexp.MustCompile(`(?i)<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"'#?]+)`)
	jsImportRE  = regexp.MustCompile(`(?m)(?:^|[;\s])(?:import|export)\b[^"'\n;]*?from\s*["'](\.{1,2}/[^"']+)["']|(?:^|[;\s])import\s*\(?\s*["'](\.{1,2}/[^"']+)["']`)
	themeLinkRE = regexp.MustCompile(`/_hearth/theme\.css`)
	hearthJSRE  = regexp.MustCompile(`/_hearth/hearth\.js`)
)

// Diagnose runs static checks over an app and, with ai, asks the model to
// review the code against the symptoms. Checks never need the model.
func (b *Builder) Diagnose(ctx context.Context, name string, sym Symptoms, ai bool) (Diagnosis, error) {
	dir, err := b.AppDir(name)
	if err != nil {
		return Diagnosis{}, err
	}
	app, loadErr := registry.Load(dir)
	var d Diagnosis
	add := func(c Check) { d.Checks = append(d.Checks, c) }

	switch {
	case loadErr != nil:
		add(Check{Level: "error", Title: "app.yaml is invalid", Detail: loadErr.Error(), File: registry.ManifestFile})
	case sym.Status == "failed" || sym.DeployError != "":
		add(Check{Level: "error", Title: "The last deploy failed", Detail: sym.DeployError, Fixable: app.Generated})
	case sym.Status != "":
		add(Check{Level: "ok", Title: "Deployed and " + sym.Status})
	}
	switch sym.Health {
	case "down":
		add(Check{Level: "error", Title: "Its server isn't answering", Detail: strings.TrimSpace("The upstream " + app.Upstream + " is down. " + sym.HealthDetail)})
	case "up":
		add(Check{Level: "ok", Title: "Its server answers health checks"})
	}
	if len(sym.ClientErrors) > 0 {
		add(Check{Level: "error", Title: fmt.Sprintf("%d error(s) reported from browsers", len(sym.ClientErrors)),
			Detail: strings.Join(sym.ClientErrors, "\n"), Fixable: app.Generated})
	} else {
		add(Check{Level: "ok", Title: "No errors reported from browsers", Detail: "Errors appear here once someone opens the app and something breaks."})
	}

	files, err := readFiles(dir, map[string]bool{registry.ManifestFile: true})
	if err != nil {
		return d, err
	}
	have := map[string]bool{}
	for _, f := range files {
		have[f.Path] = true
	}
	// Apps with a build step serve a subfolder; "/x" means that folder's x.
	site := ""
	if app.Output != "" && app.Build == "" {
		site = path.Clean(app.Output)
	}

	if app.Generated {
		if probs := Validate(files); len(probs) > 0 {
			add(Check{Level: "error", Title: "Breaks the builder guardrails", Detail: strings.Join(probs, "\n"), Fixable: true})
		} else {
			add(Check{Level: "ok", Title: "Passes the builder guardrails"})
		}
	}

	missing := []string{}
	for _, f := range files {
		ext := strings.ToLower(path.Ext(f.Path))
		var refs []string
		switch ext {
		case ".html":
			for _, m := range localRefRE.FindAllStringSubmatch(f.Content, -1) {
				refs = append(refs, m[1])
			}
		case ".js", ".mjs":
			for _, m := range jsImportRE.FindAllStringSubmatch(f.Content, -1) {
				refs = append(refs, m[1]+m[2])
			}
		}
		for _, ref := range refs {
			if ref == "" || strings.Contains(ref, "//") || strings.HasPrefix(ref, "/_") || strings.HasPrefix(ref, "data:") {
				continue
			}
			target := path.Clean(path.Join(path.Dir(f.Path), ref))
			if strings.HasPrefix(ref, "/") {
				target = path.Clean(path.Join(site, ref))
			}
			if !have[target] && app.Build == "" && (app.Kind == registry.KindStatic || app.Generated) {
				missing = append(missing, fmt.Sprintf("%s refers to %s, which doesn't exist", f.Path, ref))
			}
		}
	}
	if len(missing) > 0 {
		add(Check{Level: "error", Title: "Missing files", Detail: strings.Join(missing, "\n"), Fixable: app.Generated})
	} else if app.NeedsSite() {
		add(Check{Level: "ok", Title: "Every linked file exists"})
	}

	if index, ok := fileContent(files, path.Join(site, "index.html")); ok {
		if !themeLinkRE.MatchString(index) || !hearthJSRE.MatchString(index) {
			add(Check{Level: "warn", Title: "Doesn't use the house theme",
				Detail: "index.html should load /_hearth/hearth.js and /_hearth/theme.css so the app follows light/dark mode and reports errors.", Fixable: app.Generated, File: "index.html"})
		} else {
			add(Check{Level: "ok", Title: "Uses the house theme and error reporting"})
		}
	} else if app.NeedsSite() && app.Kind == registry.KindStatic && app.Build == "" {
		add(Check{Level: "error", Title: "No index.html", Detail: "A static app needs index.html at its root."})
	}

	d.FixPrompt = fixPrompt(d.Checks)
	if !ai {
		return d, nil
	}
	rev, err := b.review(ctx, app, files, d.Checks, sym)
	if err != nil {
		d.ReviewErr = err.Error()
		return d, nil
	}
	d.Review = rev
	if rev.FixPrompt != "" {
		d.FixPrompt = rev.FixPrompt
	}
	return d, nil
}

func fileContent(files []File, p string) (string, bool) {
	for _, f := range files {
		if f.Path == p {
			return f.Content, true
		}
	}
	return "", false
}

// fixPrompt turns failing checks into a change request for the builder.
func fixPrompt(checks []Check) string {
	var lines []string
	for _, c := range checks {
		if c.Fixable && c.Level != "ok" {
			line := "- " + c.Title
			if c.Detail != "" {
				line += ":\n  " + strings.ReplaceAll(truncate(c.Detail, 900), "\n", "\n  ")
			}
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return truncate("Fix these problems without changing what the app does:\n"+strings.Join(lines, "\n"), maxPromptLen)
}

const reviewSystem = `You review small web apps that run on a home server (static HTML, CSS and JavaScript, ES modules, no build step). You get the app's files, automatic check results and errors seen in visitors' browsers.

Find the real causes of the reported problems first, then other bugs that would break the app for a family member using it on a phone. Ignore style nits.

Reply with JSON only:
{"summary": "one or two plain sentences on the app's health", "issues": [{"severity": "high|medium|low", "file": "path", "problem": "what's wrong, plainly", "fix": "what to change"}], "fix_prompt": "a change request, written to the app builder, that fixes the high and medium issues without changing what the app does; empty if nothing needs fixing"}

At most 8 issues, most important first. Keep fix_prompt under 1500 characters.`

func (b *Builder) review(ctx context.Context, app registry.App, files []File, checks []Check, sym Symptoms) (*Review, error) {
	var sb strings.Builder
	fmt.Fprintf(&sb, "App: %s (%s), kind %s\nDescription: %s\nStatus: %s\n", app.Name, app.Title, app.Kind, app.Description, sym.Status)
	if sym.DeployError != "" {
		fmt.Fprintf(&sb, "Deploy error: %s\n", sym.DeployError)
	}
	sb.WriteString("\n## Checks\n")
	for _, c := range checks {
		fmt.Fprintf(&sb, "- [%s] %s", c.Level, c.Title)
		if c.Detail != "" && c.Level != "ok" {
			fmt.Fprintf(&sb, ": %s", truncate(c.Detail, 1500))
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\n## Files\n\n")
	budget := maxReviewBytes
	for _, f := range files {
		ext := strings.ToLower(path.Ext(f.Path))
		if ext == ".svg" || ext == ".png" || !utf8.ValidString(f.Content) {
			continue
		}
		content := f.Content
		if len(content) > budget {
			content = content[:max(budget, 0)] + "\n…(truncated)"
		}
		fmt.Fprintf(&sb, "### %s\n```\n%s\n```\n\n", f.Path, content)
		budget -= len(content)
		if budget <= 0 {
			sb.WriteString("(more files omitted)\n")
			break
		}
	}
	raw, err := b.Complete(ctx, reviewSystem, sb.String())
	if err != nil {
		return nil, err
	}
	var rev Review
	if err := json.Unmarshal([]byte(raw), &rev); err != nil {
		return nil, fmt.Errorf("the review wasn't valid JSON: %w", err)
	}
	if len(rev.Issues) > 8 {
		rev.Issues = rev.Issues[:8]
	}
	rev.FixPrompt = truncate(strings.TrimSpace(rev.FixPrompt), maxPromptLen)
	rev.Model = b.Model()
	return &rev, nil
}

// Jobs returns the app's recent builder jobs, newest first.
func (b *Builder) Jobs(name string) []Job {
	b.jobsMu.Lock()
	defer b.jobsMu.Unlock()
	out := []Job{}
	for _, j := range b.jobs {
		if j.Name == name {
			out = append(out, b.snapshotLocked(j))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Started.After(out[j].Started) })
	if len(out) > 10 {
		out = out[:10]
	}
	return out
}

var shaRE = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// StartRestore puts a builder-made app back to how it was at commit, as a
// new commit, and deploys it.
func (b *Builder) StartRestore(name, commit string) (Job, error) {
	if err := registry.ValidateName(name); err != nil {
		return Job{}, err
	}
	if !shaRE.MatchString(commit) {
		return Job{}, errors.New("pick a version from the history")
	}
	return b.startJob(name, "restore", func(ctx context.Context, j *Job) (string, error) {
		return b.restore(ctx, j, name, commit)
	})
}

func (b *Builder) restore(ctx context.Context, j *Job, name, commit string) (string, error) {
	repo, err := b.prepareRepo(ctx, j)
	if err != nil {
		return "", err
	}
	if !deploy.IsGitRepo(repo) {
		return "", errors.New("the apps folder isn't a git checkout, so there's no history to restore from")
	}
	appDir := filepath.Join(repo, "apps", name)
	cur, err := registry.Load(appDir)
	if err != nil || !cur.Generated {
		return "", fmt.Errorf("%q wasn't made by the builder, so the builder won't change it", name)
	}
	full, err := deploy.Git(ctx, repo, "rev-parse", "--verify", commit+"^{commit}")
	if err != nil {
		return "", fmt.Errorf("version %s isn't in the history", commit)
	}
	full = strings.TrimSpace(full)
	old, err := deploy.Git(ctx, repo, "show", full+":apps/"+name+"/"+registry.ManifestFile)
	if err != nil {
		return "", fmt.Errorf("apps/%s didn't exist at %s", name, commit[:7])
	}
	var then registry.App
	if err := yaml.Unmarshal([]byte(old), &then); err != nil || !then.Generated {
		return "", fmt.Errorf("at %s, %q wasn't a builder app", commit[:7], name)
	}
	b.logf(j, "restoring apps/%s to %s", name, full[:7])
	if err := os.RemoveAll(appDir); err != nil {
		return "", err
	}
	if _, err := deploy.Git(ctx, repo, "checkout", full, "--", "apps/"+name); err != nil {
		return "", err
	}
	subject, _ := deploy.Git(ctx, repo, "log", "-1", "--format=%s", full)
	if err := b.commit(ctx, j, repo, name, fmt.Sprintf("builder: restore %s to %s", name, full[:7]),
		"Restore to "+full[:7]+" ("+strings.TrimSpace(subject)+")"); err != nil {
		return "", err
	}
	return b.deployAndCheck(ctx, j, name)
}
