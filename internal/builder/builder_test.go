package builder

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

type fakeGen struct {
	mu      sync.Mutex
	replies []string
	calls   [][]Turn
}

func (f *fakeGen) Generate(_ context.Context, system string, turns []Turn) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, append([]Turn(nil), turns...))
	r := f.replies[0]
	if len(f.replies) > 1 {
		f.replies = f.replies[1:]
	}
	return r, nil
}

func reply(t *testing.T, files ...File) string {
	b, err := json.Marshal(modelOutput{Title: "Chore Chart", Description: "Weekly chores for the kids.", Tags: []string{"Family"}, Files: files})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func run(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %v\n%s", args, err, out)
	}
}

func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	if err := deploy.CopyDir(src, dst, nil); err != nil {
		t.Fatal(err)
	}
}

func waitJob(t *testing.T, b *Builder, id string) Job {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		j, _ := b.Job(id)
		if j.Status != "running" {
			return j
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("job didn't finish")
	return Job{}
}

func TestTemplatePassesGuardrails(t *testing.T) {
	files, err := readFiles(filepath.Join("..", "..", TemplateDir), nil)
	if err != nil {
		t.Fatal(err)
	}
	if p := Validate(files); len(p) != 0 {
		t.Fatalf("the template itself breaks the guardrails: %v", p)
	}
}

func TestBuildCommitsPushesAndDeploys(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	seed := filepath.Join(root, "seed")
	copyTree(t, filepath.Join("..", "..", "guardrails"), filepath.Join(seed, "guardrails"))
	copyTree(t, filepath.Join("..", "..", "templates"), filepath.Join(seed, "templates"))
	os.MkdirAll(filepath.Join(seed, "apps", "handmade"), 0o755)
	os.WriteFile(filepath.Join(seed, "apps", "handmade", "app.yaml"), []byte("title: Handmade\nkind: static\n"), 0o644)
	os.WriteFile(filepath.Join(seed, "apps", "handmade", "index.html"), []byte("<p>hi</p>"), 0o644)
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
	if engine.State().Apps["handmade"].Status != "live" {
		t.Fatalf("seed app not live: %+v", engine.State().Apps)
	}

	bad := reply(t, File{Path: "index.html", Content: `<script src="https://cdn.example.com/x.js"></script>`})
	good := reply(t,
		File{Path: "index.html", Content: `<!doctype html><title>Chores</title><script type="module" src="app.js"></script>`},
		File{Path: "app.js", Content: `import { load } from "./lib/data.js"; load("chores", []);`},
		File{Path: "lib/data.js", Content: `// model tried to rewrite the platform client`},
		File{Path: "icon.svg", Content: `<svg xmlns="http://www.w3.org/2000/svg"/>`},
	)
	gen := &fakeGen{replies: []string{bad, good}}
	b := New(cfg, engine, quiet).WithGenerator(gen)

	job, err := b.Start(Request{Name: "chores", Prompt: "a chore chart"})
	if err != nil {
		t.Fatal(err)
	}
	if job.Log == nil {
		t.Fatal("new job's log must encode as [], not null; the builder page maps over it")
	}
	j := waitJob(t, b, job.ID)
	if j.Status != "done" {
		t.Fatalf("job failed: %s\n%s", j.Error, strings.Join(j.Log, "\n"))
	}
	if len(gen.calls) != 2 || !strings.Contains(gen.calls[1][2].Text, "another host") {
		t.Fatalf("expected one guardrail retry, got %d calls", len(gen.calls))
	}

	live := engine.LiveDir("chores")
	tmplData, _ := os.ReadFile(filepath.Join("..", "..", TemplateDir, "lib", "data.js"))
	gotData, _ := os.ReadFile(filepath.Join(live, "lib", "data.js"))
	if string(gotData) != string(tmplData) {
		t.Error("lib/data.js should be the platform's copy, not the model's")
	}
	if _, err := os.Stat(filepath.Join(live, "app.yaml")); err == nil {
		t.Error("app.yaml should not be served")
	}
	st := engine.State().Apps["chores"]
	if !st.App.Generated || st.App.Icon != "/icon.svg" || st.App.Title != "Chore Chart" || st.App.Tags[0] != "family" {
		t.Errorf("manifest: %+v", st.App)
	}
	logOut, _ := deploy.Git(context.Background(), remote, "log", "-1", "--format=%s")
	if !strings.HasPrefix(logOut, "builder: create chores") {
		t.Errorf("remote head is %q", logOut)
	}

	for _, tc := range []struct {
		req  Request
		want string
	}{
		{Request{Name: "chores", Prompt: "again"}, "already exists"},
		{Request{Name: "handmade", Prompt: "change it", Revise: true}, "wasn't made by the builder"},
		{Request{Name: "ghost", Prompt: "change it", Revise: true}, "no app called"},
	} {
		job, err := b.Start(tc.req)
		if err != nil {
			t.Fatal(err)
		}
		if j := waitJob(t, b, job.ID); j.Status != "failed" || !strings.Contains(j.Error, tc.want) {
			t.Errorf("%+v: got %s %q, want error containing %q", tc.req, j.Status, j.Error, tc.want)
		}
	}

	checkout := cfg.BuilderRepoDir()
	if _, err := registry.Load(filepath.Join(checkout, "apps", "chores")); err != nil {
		t.Errorf("committed manifest invalid: %v", err)
	}
	if p := CheckRepo(checkout); len(p) != 0 {
		t.Errorf("CheckRepo on the builder's own output: %v", p)
	}
	os.WriteFile(filepath.Join(checkout, "apps", "chores", "lib", "data.js"), []byte("// edited"), 0o644)
	os.WriteFile(filepath.Join(checkout, "apps", "chores", "x.html"), []byte(`<script>alert(1)</script>`), 0o644)
	if p := CheckRepo(checkout)["chores"]; len(p) != 2 {
		t.Errorf("CheckRepo should flag the edited platform file and the inline script, got %v", p)
	}
}
