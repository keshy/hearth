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

	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

func connectServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.Defaults(t.TempDir())
	state := deploy.State{Apps: map[string]deploy.AppState{
		"naal":      {App: registry.App{Name: "naal", Kind: registry.KindLink, Capabilities: []string{registry.CapConnect}}},
		"groceries": {App: registry.App{Name: "groceries", Kind: registry.KindLink}},
	}}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(cfg.StatePath(), b, 0o644); err != nil {
		t.Fatal(err)
	}
	logger := log.New(io.Discard, "", 0)
	s, err := New(context.Background(), cfg, deploy.New(cfg, logger, nil), nil, nil, nil, logger)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func connectReq(s *Server, method, app, path, body string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set(caddy.AppHeader, app)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestConnectNeedsCapability(t *testing.T) {
	s := connectServer(t)
	if w := connectReq(s, http.MethodGet, "groceries", "/_api/connect/devices", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("groceries: got %d, want 403", w.Code)
	}
	// Naal may ask, but this server has no Connect hub.
	if w := connectReq(s, http.MethodGet, "naal", "/_api/connect/devices", "", nil); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("naal without a hub: got %d, want 503", w.Code)
	}
	w := connectReq(s, http.MethodPost, "naal", "/_api/connect/devices/x/play", `{"queue":[]}`, map[string]string{"Sec-Fetch-Site": "cross-site"})
	if w.Code != http.StatusForbidden {
		t.Fatalf("cross-site play: got %d, want 403", w.Code)
	}
}
