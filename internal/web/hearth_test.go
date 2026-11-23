package web

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

func hearthServer(t *testing.T) (*Server, config.Config) {
	t.Helper()
	cfg := config.Defaults(t.TempDir())
	live := filepath.Join(cfg.LiveDir(), "notes")
	os.MkdirAll(live, 0o755)
	os.WriteFile(filepath.Join(live, "icon.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0o644)
	os.WriteFile(cfg.Path(), []byte(`{"secret":"x"}`), 0o600)
	state := deploy.State{
		Apps: map[string]deploy.AppState{
			"notes":   {App: registry.App{Name: "notes", Title: "Notes", Kind: registry.KindStatic, Icon: "/icon.svg", Generated: true}, Status: "live", Release: live},
			"sneaky":  {App: registry.App{Name: "sneaky", Kind: registry.KindStatic, Icon: "/../../config.json"}, Status: "live", Release: live},
			"builder": {App: registry.App{Name: "builder", Kind: registry.KindLink, Private: true, Capabilities: []string{registry.CapBuilder}}, Status: "live"},
		},
		Problems: map[string]string{"broken": "app.yaml: kind is required"},
	}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(cfg.StatePath(), b, 0o644); err != nil {
		t.Fatal(err)
	}
	logger := log.New(io.Discard, "", 0)
	engine := deploy.New(cfg, logger, nil)
	bld := builder.New(cfg, engine, logger).WithGenerator(&fakeModel{})
	s, err := New(context.Background(), cfg, engine, nil, bld, nil, logger)
	if err != nil {
		t.Fatal(err)
	}
	return s, cfg
}

func do(s *Server, method, target, app, body string, header map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if app != "" {
		r.Header.Set(caddy.AppHeader, app)
	}
	for k, v := range header {
		r.Header.Set(k, v)
	}
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestThemeScriptBakesTheSavedChoice(t *testing.T) {
	s, _ := hearthServer(t)
	w := do(s, "GET", "/_hearth/hearth.js", "notes", "", nil, &http.Cookie{Name: themeCookie, Value: "dark"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"dark"`) || strings.Contains(w.Body.String(), "__PREF__") {
		t.Fatalf("dark: %d %.200s", w.Code, w.Body)
	}
	if w.Header().Get("Vary") != "Cookie" {
		t.Error("the script varies by cookie; caches must know")
	}
	w = do(s, "GET", "/_hearth/hearth.js", "", "", nil, &http.Cookie{Name: themeCookie, Value: `x";alert(1);"`})
	if strings.Contains(w.Body.String(), "alert(1)") || !strings.Contains(w.Body.String(), `"system"`) {
		t.Fatal("an unexpected cookie value must fall back to system, never reach the script")
	}
	for _, p := range []string{"/_hearth/theme.css", "/_hearth/kit.css"} {
		if w := do(s, "GET", p, "", "", nil); w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/css") {
			t.Errorf("%s: %d %s", p, w.Code, w.Header().Get("Content-Type"))
		}
	}
}

func TestThemeSetCookie(t *testing.T) {
	s, cfg := hearthServer(t)
	if w := do(s, "POST", "/_hearth/theme", "notes", `{"theme":"dark"}`, map[string]string{"Sec-Fetch-Site": "cross-site"}); w.Code != http.StatusForbidden {
		t.Fatalf("cross-site: %d", w.Code)
	}
	if w := do(s, "POST", "/_hearth/theme", "notes", `{"theme":"purple"}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("bad theme: %d", w.Code)
	}
	w := do(s, "POST", "/_hearth/theme", "notes", `{"theme":"dark"}`, map[string]string{"Sec-Fetch-Site": "same-site"})
	c := w.Result().Cookies()
	if w.Code != 200 || len(c) != 1 || c[0].Value != "dark" || c[0].Domain != cfg.Domain || c[0].MaxAge <= 0 {
		t.Fatalf("set dark: %d %+v", w.Code, c)
	}
	w = do(s, "POST", "/_hearth/theme", "", `{"theme":"system"}`, nil)
	if c := w.Result().Cookies(); len(c) != 1 || c[0].MaxAge >= 0 {
		t.Fatalf("system should delete the cookie: %+v", c)
	}
	w = do(s, "GET", "/_hearth/theme", "", "", nil, &http.Cookie{Name: themeCookie, Value: "light"})
	if !strings.Contains(w.Body.String(), `"light"`) {
		t.Fatalf("get: %s", w.Body)
	}
}

func TestErrorReportsAreStoredDedupedAndLimited(t *testing.T) {
	s, _ := hearthServer(t)
	now := time.Unix(1_800_000_000, 0)
	s.errs.now = func() time.Time { return now }
	report := `{"kind":"error","message":"x is undefined","source":"https://notes/app.js","line":3}`
	if w := do(s, "POST", "/_hearth/errors", "", report, nil); w.Code != http.StatusNoContent {
		t.Fatalf("portal reports are dropped quietly: %d", w.Code)
	}
	if w := do(s, "POST", "/_hearth/errors", "ghost", report, nil); w.Code != http.StatusNotFound {
		t.Fatalf("unknown app: %d", w.Code)
	}
	if w := do(s, "POST", "/_hearth/errors", "notes", report, map[string]string{"Sec-Fetch-Site": "cross-site"}); w.Code != http.StatusForbidden {
		t.Fatalf("cross-site: %d", w.Code)
	}
	if w := do(s, "POST", "/_hearth/errors", "notes", `{"message":"  "}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("empty: %d", w.Code)
	}
	for i := 0; i < 3; i++ {
		if w := do(s, "POST", "/_hearth/errors", "notes", report, nil); w.Code != http.StatusNoContent {
			t.Fatalf("report %d: %d", i, w.Code)
		}
	}
	if l := s.errs.list("notes"); len(l) != 1 || l[0].Count != 3 {
		t.Fatalf("same error should be counted, not repeated: %+v", l)
	}
	for i := 3; i < errorsPerWindow; i++ {
		do(s, "POST", "/_hearth/errors", "notes", `{"message":"m`+strings.Repeat("x", i)+`"}`, nil)
	}
	if w := do(s, "POST", "/_hearth/errors", "notes", report, nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("over the limit: %d", w.Code)
	}
	now = now.Add(errorWindow)
	if w := do(s, "POST", "/_hearth/errors", "notes", `{"message":"later"}`, nil); w.Code != http.StatusNoContent {
		t.Fatalf("after the window: %d", w.Code)
	}
	if l := s.errs.list("notes"); l[0].Message != "later" {
		t.Errorf("newest first: %+v", l[0])
	}
}

func TestAppIconStaysInsideTheRelease(t *testing.T) {
	s, _ := hearthServer(t)
	w := do(s, "GET", "/icons/notes", "", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "<svg") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("notes icon: %d %q", w.Code, w.Header().Get("Content-Security-Policy"))
	}
	if w := do(s, "GET", "/icons/sneaky", "", "", nil); w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("traversal: %d %s", w.Code, w.Body)
	}
	if w := do(s, "GET", "/icons/builder", "", "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("link app: %d", w.Code)
	}
}

func TestBuilderSeesEveryAppAndItsErrors(t *testing.T) {
	s, _ := hearthServer(t)
	if w := do(s, "GET", "/_api/builder/apps", "notes", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("a normal app must not read the builder API: %d", w.Code)
	}
	do(s, "POST", "/_hearth/errors", "notes", `{"message":"boom"}`, nil)
	w := do(s, "GET", "/_api/builder/apps", "builder", "", nil)
	var apps []builderAppView
	if err := json.Unmarshal(w.Body.Bytes(), &apps); err != nil || w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	byName := map[string]builderAppView{}
	for _, a := range apps {
		byName[a.Name] = a
	}
	if n := byName["notes"]; n.Errors != 1 || !n.Generated || !n.Editable || !strings.HasSuffix(n.IconURL, "/icons/notes") {
		t.Errorf("notes: %+v", n)
	}
	if b := byName["broken"]; b.Status != "invalid" || !strings.Contains(b.Error, "kind is required") {
		t.Errorf("apps with a bad manifest should be listed: %+v", b)
	}
	w = do(s, "DELETE", "/_api/builder/apps/notes/errors", "builder", "", nil)
	if w.Code != 200 || len(s.errs.list("notes")) != 0 {
		t.Fatalf("clear: %d", w.Code)
	}
}
