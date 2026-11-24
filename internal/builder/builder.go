// Package builder turns a plain-language request into a static app in the
// repo: it prompts Gemini with the repo's guardrails and template, enforces
// the guardrails in code, commits the result to the deploy branch, and
// deploys it.
package builder

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

const (
	RulesFile    = "guardrails/BUILDER_RULES.md"
	TemplateDir  = "templates/static-web"
	maxAttempts  = 3
	maxPromptLen = 4000
	jobTimeout   = 10 * time.Minute
)

// platformFiles are copied from the template over whatever the model wrote,
// so apps always talk to the platform through the reviewed client.
var platformFiles = []string{"lib/data.js"}

type Request struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
	Revise bool   `json:"revise"`
}

type Job struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Revise   bool      `json:"revise"`
	Kind     string    `json:"kind"`   // create, revise, restore
	Status   string    `json:"status"` // running, done, failed
	Log      []string  `json:"log"`
	URL      string    `json:"url,omitempty"`
	Error    string    `json:"error,omitempty"`
	Started  time.Time `json:"started"`
	Finished time.Time `json:"finished,omitempty"`
}

type Builder struct {
	cfg    config.Config
	engine *deploy.Engine
	log    *log.Logger

	genMu sync.Mutex
	gen   Generator // created on first use so the platform runs without GCP set up

	runMu  sync.Mutex // one build at a time: they share a git checkout
	jobsMu sync.Mutex
	jobs   map[string]*Job
}

func New(cfg config.Config, engine *deploy.Engine, logger *log.Logger) *Builder {
	return &Builder{cfg: cfg, engine: engine, log: logger, jobs: map[string]*Job{}}
}

// WithGenerator swaps the model client (tests, alternative providers).
func (b *Builder) WithGenerator(g Generator) *Builder { b.gen = g; return b }

func (b *Builder) Model() string { return b.cfg.GeminiModel }

func (b *Builder) generator(ctx context.Context) (Generator, error) {
	b.genMu.Lock()
	defer b.genMu.Unlock()
	if b.gen != nil {
		return b.gen, nil
	}
	g, err := NewGemini(ctx, b.cfg)
	if err != nil {
		return nil, err
	}
	b.gen = g
	return g, nil
}

// Complete runs one JSON prompt on the builder's model client.
func (b *Builder) Complete(ctx context.Context, system, prompt string) (string, error) {
	return b.CompleteWith(ctx, system, prompt, Options{})
}

func (b *Builder) CompleteWith(ctx context.Context, system, prompt string, opt Options) (string, error) {
	g, err := b.generator(ctx)
	if err != nil {
		return "", err
	}
	c, ok := g.(Completer)
	if !ok {
		return "", errors.New("the configured model client can't answer prompts")
	}
	return c.Complete(ctx, system, prompt, opt)
}

// Paint draws a picture with the configured image model; high picks the
// better (dearer) one.
func (b *Builder) Paint(ctx context.Context, high bool, prompt string, refs []Image, aspect string) (Image, error) {
	g, err := b.generator(ctx)
	if err != nil {
		return Image{}, err
	}
	p, ok := g.(Painter)
	if !ok {
		return Image{}, errors.New("the configured model client can't draw")
	}
	model := b.cfg.ImageModel
	if high {
		model = b.cfg.ImageModelHigh
	}
	return p.Paint(ctx, model, prompt, refs, aspect)
}

func (b *Builder) Start(req Request) (Job, error) {
	req.Name = strings.ToLower(strings.TrimSpace(req.Name))
	req.Prompt = strings.TrimSpace(req.Prompt)
	if err := registry.ValidateName(req.Name); err != nil {
		return Job{}, err
	}
	if req.Prompt == "" {
		return Job{}, errors.New("describe the app you want")
	}
	if len(req.Prompt) > maxPromptLen {
		return Job{}, fmt.Errorf("keep the description under %d characters", maxPromptLen)
	}
	kind := "create"
	if req.Revise {
		kind = "revise"
	}
	return b.startJob(req.Name, kind, func(ctx context.Context, j *Job) (string, error) {
		return b.build(ctx, j, req)
	})
}

func (b *Builder) startJob(name, kind string, fn func(context.Context, *Job) (string, error)) (Job, error) {
	b.jobsMu.Lock()
	for _, j := range b.jobs {
		if j.Name == name && j.Status == "running" {
			b.jobsMu.Unlock()
			return Job{}, fmt.Errorf("a job for %q is already running", name)
		}
	}
	idb := make([]byte, 6)
	rand.Read(idb)
	job := &Job{ID: hex.EncodeToString(idb), Name: name, Kind: kind, Revise: kind == "revise", Status: "running", Started: time.Now()}
	b.jobs[job.ID] = job
	b.jobsMu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
		defer cancel()
		b.runMu.Lock()
		defer b.runMu.Unlock()
		url, err := fn(ctx, job)
		b.finish(job, url, err)
	}()
	return b.snapshot(job), nil
}

func (b *Builder) Job(id string) (Job, bool) {
	b.jobsMu.Lock()
	defer b.jobsMu.Unlock()
	j, ok := b.jobs[id]
	if !ok {
		return Job{}, false
	}
	return b.snapshotLocked(j), true
}

func (b *Builder) snapshot(j *Job) Job {
	b.jobsMu.Lock()
	defer b.jobsMu.Unlock()
	return b.snapshotLocked(j)
}

func (b *Builder) snapshotLocked(j *Job) Job {
	c := *j
	c.Log = append([]string{}, j.Log...)
	return c
}

func (b *Builder) logf(j *Job, format string, a ...any) {
	msg := fmt.Sprintf(format, a...)
	b.log.Printf("builder %s: %s", j.Name, msg)
	b.jobsMu.Lock()
	j.Log = append(j.Log, time.Now().Format("15:04:05")+"  "+msg)
	b.jobsMu.Unlock()
}

func (b *Builder) finish(j *Job, url string, err error) {
	b.jobsMu.Lock()
	defer b.jobsMu.Unlock()
	j.Finished = time.Now()
	if err != nil {
		j.Status, j.Error = "failed", err.Error()
		j.Log = append(j.Log, time.Now().Format("15:04:05")+"  failed: "+err.Error())
		return
	}
	j.Status, j.URL = "done", url
	j.Log = append(j.Log, time.Now().Format("15:04:05")+"  live at "+url)
}

type modelOutput struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Notes       string   `json:"notes"`
	Files       []File   `json:"files"`
}

func (b *Builder) build(ctx context.Context, j *Job, req Request) (string, error) {
	repo, err := b.prepareRepo(ctx, j)
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(repo, "apps", req.Name)
	existing, loadErr := registry.Load(appDir)
	_, statErr := os.Stat(appDir)
	exists := statErr == nil
	switch {
	case !req.Revise && exists:
		return "", fmt.Errorf("an app called %q already exists; pick another name or revise it", req.Name)
	case req.Revise && !exists:
		return "", fmt.Errorf("there's no app called %q to revise", req.Name)
	case req.Revise && (loadErr != nil || !existing.Generated):
		return "", fmt.Errorf("%q wasn't made by the builder, so the builder won't change it", req.Name)
	}

	rules, err := os.ReadFile(filepath.Join(repo, RulesFile))
	if err != nil {
		return "", fmt.Errorf("missing %s in the repo", RulesFile)
	}
	tmpl, err := readFiles(filepath.Join(repo, TemplateDir), nil)
	if err != nil {
		return "", fmt.Errorf("read template: %w", err)
	}
	system := string(rules) + "\n\n## Template files (start from these)\n\n" + formatFiles(tmpl)

	user := fmt.Sprintf("App name (folder and address): %s\n\nRequest:\n%s", req.Name, req.Prompt)
	if req.Revise {
		current, err := readFiles(appDir, map[string]bool{registry.ManifestFile: true})
		if err != nil {
			return "", err
		}
		user += "\n\nThis is a change to an existing app. Return the complete new file set (unchanged files too).\n\nCurrent title: " +
			existing.Title + "\nCurrent files:\n\n" + formatFiles(current)
	}

	gen, err := b.generator(ctx)
	if err != nil {
		return "", err
	}
	turns := []Turn{{Role: "user", Text: user}}
	var out modelOutput
	for attempt := 1; ; attempt++ {
		b.logf(j, "asking %s (attempt %d of %d)", b.cfg.GeminiModel, attempt, maxAttempts)
		raw, err := gen.Generate(ctx, system, turns)
		if err != nil {
			return "", fmt.Errorf("gemini: %w", err)
		}
		out = modelOutput{}
		var problems []string
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			problems = []string{"the reply was not valid JSON matching the schema: " + err.Error()}
		} else {
			out.Files = normalizePaths(out.Files, req.Name)
			problems = Validate(out.Files)
		}
		if len(problems) == 0 {
			break
		}
		b.logf(j, "guardrails rejected %d issue(s): %s", len(problems), strings.Join(problems, "; "))
		if attempt == maxAttempts {
			return "", fmt.Errorf("the generated app still broke the guardrails after %d attempts", maxAttempts)
		}
		turns = append(turns,
			Turn{Role: "model", Text: raw},
			Turn{Role: "user", Text: "The platform rejected that output:\n- " + strings.Join(problems, "\n- ") +
				"\n\nFix every problem and return the complete file set again."})
	}
	if out.Notes != "" {
		b.logf(j, "model notes: %s", out.Notes)
	}

	app := registry.App{
		Name:        req.Name,
		Title:       truncate(strings.TrimSpace(out.Title), 60),
		Description: truncate(strings.TrimSpace(out.Description), 300),
		Tags:        sanitizeTags(out.Tags),
		Kind:        registry.KindStatic,
		Generated:   true,
	}
	if err := b.writeApp(appDir, app, out.Files, filepath.Join(repo, TemplateDir)); err != nil {
		return "", err
	}
	if _, err := registry.Load(appDir); err != nil {
		return "", fmt.Errorf("generated manifest is invalid: %w", err)
	}
	b.logf(j, "wrote %d files to apps/%s", len(out.Files), req.Name)

	verb := "create"
	if req.Revise {
		verb = "revise"
	}
	if err := b.commit(ctx, j, repo, req.Name, fmt.Sprintf("builder: %s %s (%s)", verb, req.Name, app.Title), req.Prompt); err != nil {
		return "", err
	}
	return b.deployAndCheck(ctx, j, req.Name)
}

func (b *Builder) deployAndCheck(ctx context.Context, j *Job, name string) (string, error) {
	b.logf(j, "deploying")
	if err := b.engine.Sync(ctx, true); err != nil {
		return "", fmt.Errorf("deploy: %w", err)
	}
	st, ok := b.engine.State().Apps[name]
	if !ok || st.Status != "live" {
		msg := "the app didn't go live"
		if ok && st.Error != "" {
			msg += ": " + st.Error
		}
		return "", errors.New(msg)
	}
	return b.cfg.AppURL(name), nil
}

// prepareRepo returns a checkout at the tip of the deploy branch. In git
// mode that's a dedicated clone, so builds never touch the deploy checkout.
func (b *Builder) prepareRepo(ctx context.Context, j *Job) (string, error) {
	if !b.cfg.GitMode() {
		return b.cfg.RepoPath(), nil
	}
	dir := b.cfg.BuilderRepoDir()
	b.logf(j, "syncing builder checkout with %s", b.cfg.Branch)
	if err := deploy.EnsureClone(ctx, b.cfg.RepoURL, b.cfg.Branch, dir); err != nil {
		return "", err
	}
	for _, args := range [][]string{
		{"fetch", "origin", b.cfg.Branch},
		{"checkout", "--force", "-B", b.cfg.Branch, "origin/" + b.cfg.Branch},
		{"clean", "-ffdx"},
	} {
		if _, err := deploy.Git(ctx, dir, args...); err != nil {
			return "", err
		}
	}
	return dir, nil
}

func (b *Builder) writeApp(appDir string, app registry.App, files []File, tmplDir string) error {
	tmp := appDir + ".building"
	os.RemoveAll(tmp)
	defer os.RemoveAll(tmp)
	for _, f := range files {
		p := filepath.Join(tmp, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, []byte(f.Content), 0o644); err != nil {
			return err
		}
	}
	for _, pf := range platformFiles {
		src := filepath.Join(tmplDir, filepath.FromSlash(pf))
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		dst := filepath.Join(tmp, filepath.FromSlash(pf))
		os.MkdirAll(filepath.Dir(dst), 0o755)
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(tmp, "icon.svg")); err == nil {
		app.Icon = "/icon.svg"
	}
	manifest, err := yaml.Marshal(app)
	if err != nil {
		return err
	}
	header := "# Written by the apps-home builder. Edit freely; revisions through the builder replace this folder.\n"
	if err := os.WriteFile(filepath.Join(tmp, registry.ManifestFile), append([]byte(header), manifest...), 0o644); err != nil {
		return err
	}
	if err := os.RemoveAll(appDir); err != nil {
		return err
	}
	return os.Rename(tmp, appDir)
}

func (b *Builder) commit(ctx context.Context, j *Job, repo, name, subject, prompt string) error {
	if !deploy.IsGitRepo(repo) {
		b.logf(j, "repo isn't a git checkout; skipping commit")
		return nil
	}
	path := "apps/" + name
	if _, err := deploy.Git(ctx, repo, "add", "-A", "--", path); err != nil {
		return err
	}
	if out, _ := deploy.Git(ctx, repo, "status", "--porcelain", "--", path); out == "" {
		b.logf(j, "no file changes to commit")
		return nil
	}
	msg := subject + "\n\nRequest:\n" + prompt + "\n\nModel: " + b.cfg.GeminiModel
	if _, err := deploy.Git(ctx, repo, "-c", "user.name=apps-home builder", "-c", "user.email=builder@"+b.cfg.Domain,
		"commit", "--quiet", "-m", msg, "--", path); err != nil {
		return err
	}
	sha, _ := deploy.Git(ctx, repo, "rev-parse", "--short", "HEAD")
	b.logf(j, "committed %s", sha)
	if !b.cfg.GitMode() {
		return nil
	}
	push := func() error {
		_, err := deploy.Git(ctx, repo, "push", "origin", "HEAD:"+b.cfg.Branch)
		return err
	}
	if err := push(); err != nil {
		b.logf(j, "push rejected, rebasing on the latest %s", b.cfg.Branch)
		if _, rerr := deploy.Git(ctx, repo, "-c", "user.name=apps-home builder", "-c", "user.email=builder@"+b.cfg.Domain,
			"pull", "--rebase", "origin", b.cfg.Branch); rerr != nil {
			return fmt.Errorf("push failed and rebase failed: %v / %v", err, rerr)
		}
		if err := push(); err != nil {
			return fmt.Errorf("push to %s failed: %w", b.cfg.Branch, err)
		}
	}
	b.logf(j, "pushed to %s", b.cfg.Branch)
	return nil
}

func readFiles(dir string, skip map[string]bool) ([]File, error) {
	var files []File
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if strings.HasPrefix(d.Name(), ".") && p != dir {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		rel = filepath.ToSlash(rel)
		if skip[rel] {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		files = append(files, File{Path: rel, Content: string(b)})
		return nil
	})
	sort.Slice(files, func(i, k int) bool { return files[i].Path < files[k].Path })
	return files, err
}

func formatFiles(files []File) string {
	var sb strings.Builder
	for _, f := range files {
		fmt.Fprintf(&sb, "### %s\n```\n%s\n```\n\n", f.Path, strings.TrimRight(f.Content, "\n"))
	}
	return sb.String()
}

func normalizePaths(files []File, name string) []File {
	for i := range files {
		p := strings.TrimSpace(files[i].Path)
		p = strings.TrimPrefix(p, "./")
		p = strings.TrimPrefix(p, "apps/"+name+"/")
		files[i].Path = p
	}
	return files
}

func sanitizeTags(in []string) []string {
	var out []string
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		var sb strings.Builder
		for _, r := range t {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == ' ' {
				sb.WriteRune(r)
			}
		}
		if t = truncate(strings.TrimSpace(sb.String()), 24); t != "" && len(out) < 4 {
			out = append(out, t)
		}
	}
	return out
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
