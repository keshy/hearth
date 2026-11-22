package web

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

type fakeModel struct{ prompts []string }

func (f *fakeModel) Generate(context.Context, string, []builder.Turn) (string, error) {
	return "{}", nil
}
func (f *fakeModel) Complete(_ context.Context, system, prompt string) (string, error) {
	f.prompts = append(f.prompts, prompt)
	return `{"ok":true}`, nil
}

func llmServer(t *testing.T) (*Server, *fakeModel) {
	t.Helper()
	cfg := config.Defaults(t.TempDir())
	state := deploy.State{Apps: map[string]deploy.AppState{
		"astro":     {App: registry.App{Name: "astro", Kind: registry.KindLink, Capabilities: []string{registry.CapLLM}}},
		"groceries": {App: registry.App{Name: "groceries", Kind: registry.KindLink}},
	}}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(cfg.StatePath(), b, 0o644); err != nil {
		t.Fatal(err)
	}
	logger := log.New(io.Discard, "", 0)
	engine := deploy.New(cfg, logger, nil)
	model := &fakeModel{}
	bld := builder.New(cfg, engine, logger).WithGenerator(model)
	s, err := New(context.Background(), cfg, engine, nil, bld, nil, logger)
	if err != nil {
		t.Fatal(err)
	}
	return s, model
}

func ask(s *Server, app, body string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/_api/llm", strings.NewReader(body))
	r.Header.Set(caddy.AppHeader, app)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestLLMNeedsCapability(t *testing.T) {
	s, model := llmServer(t)
	if w := ask(s, "groceries", `{"prompt":"hi"}`, nil); w.Code != http.StatusForbidden {
		t.Fatalf("groceries: got %d, want 403", w.Code)
	}
	w := ask(s, "astro", `{"system":"answer in JSON","prompt":"hi"}`, nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `{\"ok\":true}`) {
		t.Fatalf("astro: got %d %s", w.Code, w.Body)
	}
	if len(model.prompts) != 1 || model.prompts[0] != "hi" {
		t.Fatalf("model saw %v", model.prompts)
	}
}

func TestLLMRejectsCrossSiteAndBadInput(t *testing.T) {
	s, _ := llmServer(t)
	if w := ask(s, "astro", `{"prompt":"hi"}`, map[string]string{"Sec-Fetch-Site": "cross-site"}); w.Code != http.StatusForbidden {
		t.Fatalf("cross-site: got %d", w.Code)
	}
	if w := ask(s, "astro", `{"prompt":"   "}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("empty prompt: got %d", w.Code)
	}
	big := `{"prompt":"` + strings.Repeat("x", llmMaxPrompt+1) + `"}`
	if w := ask(s, "astro", big, nil); w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("big prompt: got %d", w.Code)
	}
}

func TestLLMRateLimit(t *testing.T) {
	s, _ := llmServer(t)
	now := time.Unix(1_800_000_000, 0)
	s.llmLimit.now = func() time.Time { return now }
	for i := 0; i < llmPerWindow; i++ {
		if w := ask(s, "astro", `{"prompt":"hi"}`, nil); w.Code != http.StatusOK {
			t.Fatalf("call %d: got %d", i, w.Code)
		}
	}
	if w := ask(s, "astro", `{"prompt":"hi"}`, nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("over limit: got %d", w.Code)
	}
	now = now.Add(llmWindow)
	if w := ask(s, "astro", `{"prompt":"hi"}`, nil); w.Code != http.StatusOK {
		t.Fatalf("after window: got %d", w.Code)
	}
}
