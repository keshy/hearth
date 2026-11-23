package builder

import (
	"context"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"appshome/internal/config"
	"appshome/internal/deploy"
)

func TestRequestFromCommitBody(t *testing.T) {
	body := "Request:\nA chore chart\nwith two kids\n\nModel: gemini-x\n"
	if got := requestFromBody(body); got != "A chore chart\nwith two kids" {
		t.Errorf("got %q", got)
	}
	if got := requestFromBody("just a hand-written commit"); got != "" {
		t.Errorf("got %q", got)
	}
	log := "aaa\x1fa1\x1fapps-home builder\x1f2026-01-02T03:04:05Z\x1fbuilder: create x (X)\x1fRequest:\nmake x\n\nModel: m\n\x1e\n" +
		"bbb\x1fb1\x1fKrishnan\x1f2026-01-01T00:00:00Z\x1fseed\x1f\x1e\n"
	ch := parseLog(log)
	if len(ch) != 2 || !ch[0].Builder || ch[0].Prompt != "make x" || ch[1].Builder || ch[1].Short != "b1" || ch[0].Date.Year() != 2026 {
		t.Errorf("parseLog: %+v", ch)
	}
}

// A builder app's whole life: create, change, look at it, roll it back.
func TestHistoryDiagnoseAndRestore(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	seed := filepath.Join(root, "seed")
	copyTree(t, filepath.Join("..", "..", "guardrails"), filepath.Join(seed, "guardrails"))
	copyTree(t, filepath.Join("..", "..", "templates"), filepath.Join(seed, "templates"))
	hand := filepath.Join(seed, "apps", "handmade")
	os.MkdirAll(filepath.Join(hand, "site"), 0o755)
	os.WriteFile(filepath.Join(hand, "app.yaml"), []byte("title: Handmade\nkind: static\noutput: site\n"), 0o644)
	os.WriteFile(filepath.Join(hand, "site", "index.html"), []byte(`<script src="/_hearth/hearth.js"></script><link rel="stylesheet" href="/_hearth/theme.css"><script type="module" src="/app.js"></script>`), 0o644)
	os.WriteFile(filepath.Join(hand, "site", "app.js"), []byte(`import "./missing.js";`), 0o644)
	run(t, seed, "git", "init", "-q", "-b", "main")
	run(t, seed, "git", "add", ".")
	run(t, seed, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed")
	remote := filepath.Join(root, "remote.git")
	run(t, root, "git", "clone", "-q", "--bare", seed, remote)

	cfg := config.Defaults(filepath.Join(root, "data"))
	cfg.RepoURL = remote
	quiet := log.New(io.Discard, "", 0)
	engine := deploy.New(cfg, quiet, nil)
	if err := engine.Sync(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	index := func(title string) File {
		return File{Path: "index.html", Content: `<!doctype html><title>` + title + `</title><script src="/_hearth/hearth.js"></script>` +
			`<link rel="stylesheet" href="/_hearth/theme.css"><script type="module" src="app.js"></script>`}
	}
	v1 := reply(t, index("One"), File{Path: "app.js", Content: `import { load } from "./lib/data.js"; load("x", []);`})
	v2 := reply(t, index("Two"), File{Path: "app.js", Content: `import { load } from "./lib/data.js"; import "./gone.js";`})
	gen := &fakeGen{replies: []string{v1}}
	b := New(cfg, engine, quiet).WithGenerator(gen)
	ctx := context.Background()

	job, _ := b.Start(Request{Name: "chores", Prompt: "first version"})
	if j := waitJob(t, b, job.ID); j.Status != "done" {
		t.Fatalf("create: %s", j.Error)
	}
	gen.replies = []string{v2}
	job, _ = b.Start(Request{Name: "chores", Prompt: "second version", Revise: true})
	if j := waitJob(t, b, job.ID); j.Status != "done" || j.Kind != "revise" {
		t.Fatalf("revise: %s %s", j.Kind, j.Error)
	}

	hist, err := b.History(ctx, "chores")
	if err != nil || len(hist) != 2 {
		t.Fatalf("history: %v %+v", err, hist)
	}
	if hist[0].Prompt != "second version" || hist[1].Prompt != "first version" || !hist[0].Builder {
		t.Errorf("history prompts: %+v", hist)
	}

	d, err := b.Diagnose(ctx, "chores", Symptoms{Status: "live", ClientErrors: []string{"TypeError: x is undefined"}}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !hasCheck(d, "error", "Missing files", "gone.js") || !hasCheck(d, "error", "reported from browsers", "x is undefined") {
		t.Errorf("checks: %+v", d.Checks)
	}
	if !strings.Contains(d.FixPrompt, "gone.js") || !strings.Contains(d.FixPrompt, "x is undefined") {
		t.Errorf("fix prompt: %q", d.FixPrompt)
	}

	hd, _ := b.Diagnose(ctx, "handmade", Symptoms{Status: "live"}, false)
	if !hasCheck(hd, "error", "Missing files", "site/app.js refers to ./missing.js") || !hasCheck(hd, "ok", "house theme", "") {
		t.Errorf("hand-written checks (output: site): %+v", hd.Checks)
	}
	if hd.FixPrompt != "" {
		t.Errorf("hand-written apps aren't fixable by the builder: %q", hd.FixPrompt)
	}

	files, _ := b.Files("chores")
	if len(files) < 3 {
		t.Errorf("files: %+v", files)
	}
	if txt, err := b.ReadFile("chores", "index.html"); err != nil || !strings.Contains(txt, "Two") {
		t.Errorf("read: %v %q", err, txt)
	}
	for _, bad := range []string{"../../config.json", "/etc/passwd", ".git/config", ""} {
		if _, err := b.ReadFile("chores", bad); err == nil && bad != "/etc/passwd" {
			t.Errorf("ReadFile(%q) should fail", bad)
		}
	}
	if _, err := b.ReadFile("chores", "/etc/passwd"); err == nil {
		t.Error("absolute paths must stay inside the app")
	}

	if _, err := b.StartRestore("chores", "not-a-sha"); err == nil {
		t.Error("restore should reject a bad commit id")
	}
	job, err = b.StartRestore("chores", hist[1].SHA)
	if err != nil {
		t.Fatal(err)
	}
	if j := waitJob(t, b, job.ID); j.Status != "done" || j.Kind != "restore" {
		t.Fatalf("restore: %s\n%s", j.Error, strings.Join(j.Log, "\n"))
	}
	served, _ := os.ReadFile(filepath.Join(engine.LiveDir("chores"), "index.html"))
	if !strings.Contains(string(served), "One") {
		t.Errorf("restore didn't deploy the old version: %s", served)
	}
	hist, _ = b.History(ctx, "chores")
	if len(hist) != 3 || !strings.HasPrefix(hist[0].Subject, "builder: restore chores to "+hist[2].Short) {
		t.Errorf("restore should be a new commit: %+v", hist)
	}
	job, _ = b.StartRestore("handmade", hist[0].SHA)
	if j := waitJob(t, b, job.ID); j.Status != "failed" || !strings.Contains(j.Error, "wasn't made by the builder") {
		t.Errorf("restoring a hand-written app: %s %q", j.Status, j.Error)
	}
	if jobs := b.Jobs("chores"); len(jobs) != 3 || jobs[0].Kind != "restore" {
		t.Errorf("jobs: %+v", jobs)
	}
}

func hasCheck(d Diagnosis, level, title, detail string) bool {
	for _, c := range d.Checks {
		if c.Level == level && strings.Contains(c.Title, title) && strings.Contains(c.Detail, detail) {
			return true
		}
	}
	return false
}
