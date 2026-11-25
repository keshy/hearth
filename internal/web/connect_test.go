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

	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/connect"
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

func TestConnectAudioRelay(t *testing.T) {
	song := strings.Repeat("aac-frames-", 1000)
	refused := false
	yt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/expired" {
			refused = true
			w.WriteHeader(http.StatusForbidden)
			return
		}
		http.ServeContent(w, r, "song", time.Time{}, strings.NewReader(song))
	}))
	defer yt.Close()

	s := connectServer(t)
	tools := connect.NewTools(t.TempDir())
	s.SetConnect(&connect.Hub{Tools: tools})
	tools.Remember("AzTnnAfiqMg", yt.URL+"/song", "audio/mp4", time.Now().Add(time.Hour))

	if w := connectReq(s, http.MethodGet, "groceries", "/_api/connect/audio/AzTnnAfiqMg", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("no capability: %d", w.Code)
	}
	if w := connectReq(s, http.MethodGet, "naal", "/_api/connect/audio/not-an-id", "", nil); w.Code != http.StatusBadRequest {
		t.Fatalf("bad id: %d", w.Code)
	}
	w := connectReq(s, http.MethodGet, "naal", "/_api/connect/audio/AzTnnAfiqMg", "", nil)
	if w.Code != http.StatusOK || w.Body.String() != song || w.Header().Get("Content-Type") != "audio/mp4" {
		t.Fatalf("whole song: %d %q", w.Code, w.Header())
	}
	w = connectReq(s, http.MethodGet, "naal", "/_api/connect/audio/AzTnnAfiqMg", "", map[string]string{"Range": "bytes=11-21"})
	if w.Code != http.StatusPartialContent || w.Body.String() != "aac-frames-" || !strings.HasPrefix(w.Header().Get("Content-Range"), "bytes 11-21/") {
		t.Fatalf("range: %d %q %q", w.Code, w.Body.String(), w.Header().Get("Content-Range"))
	}

	// An expired link is dropped and looked up again (which fails here: no yt-dlp).
	tools.Remember("-nYayP5B5U0", yt.URL+"/expired", "audio/mp4", time.Now().Add(time.Hour))
	if w := connectReq(s, http.MethodGet, "naal", "/_api/connect/audio/-nYayP5B5U0", "", nil); w.Code != http.StatusBadGateway || !refused {
		t.Fatalf("expired: %d", w.Code)
	}
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
