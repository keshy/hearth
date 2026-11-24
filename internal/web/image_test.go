package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

type fakePainter struct {
	fakeModel
	prompts []string
	refs    []int
	limited map[string]bool // models that answer 429
}

func (f *fakePainter) Paint(_ context.Context, model, prompt string, refs []builder.Image, aspect string) (builder.Image, error) {
	f.prompts = append(f.prompts, model+"|"+aspect+"|"+prompt)
	if f.limited[model] {
		return builder.Image{}, errors.New("Error 429, Message: Resource exhausted. Status: RESOURCE_EXHAUSTED")
	}
	f.refs = append(f.refs, len(refs))
	img := image.NewRGBA(image.Rect(0, 0, 16, 9))
	img.Set(1, 1, color.RGBA{200, 100, 0, 255})
	var b bytes.Buffer
	png.Encode(&b, img)
	return builder.Image{Data: b.Bytes(), MIME: "image/png"}, nil
}

func imageServer(t *testing.T) (*Server, *fakePainter) {
	t.Helper()
	cfg := config.Defaults(t.TempDir())
	hash, _ := bcrypt.GenerateFromPassword([]byte("secret-pw"), bcrypt.MinCost)
	cfg.AdminPasswordHash = string(hash)
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	state := deploy.State{Apps: map[string]deploy.AppState{
		"story":     {App: registry.App{Name: "story", Kind: registry.KindLink, Capabilities: []string{registry.CapImage}}},
		"groceries": {App: registry.App{Name: "groceries", Kind: registry.KindLink}},
	}}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(cfg.StatePath(), b, 0o644); err != nil {
		t.Fatal(err)
	}
	logger := log.New(io.Discard, "", 0)
	engine := deploy.New(cfg, logger, nil)
	p := &fakePainter{}
	s, err := New(context.Background(), cfg, engine, nil, builder.New(cfg, engine, logger).WithGenerator(p), nil, logger)
	if err != nil {
		t.Fatal(err)
	}
	return s, p
}

func imageReq(s *Server, method, app, path, body, password string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set(caddy.AppHeader, app)
	if password != "" {
		r.SetBasicAuth("admin", password)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func waitImage(t *testing.T, s *Server, key string) imageState {
	t.Helper()
	for end := time.Now().Add(3 * time.Second); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
		if st := s.imageStatus("story", key); st.State != "queued" && st.State != "painting" {
			return st
		}
	}
	t.Fatalf("%s never finished", key)
	return imageState{}
}

func TestImagePaintFlow(t *testing.T) {
	s, p := imageServer(t)
	job := `{"jobs":[{"key":"kalki-sheet","prompt":"a boy hero","aspect":"16:9","high":true}]}`
	if w := imageReq(s, "POST", "groceries", "/_api/image/jobs", job, "secret-pw"); w.Code != http.StatusForbidden {
		t.Fatalf("no capability: %d", w.Code)
	}
	if w := imageReq(s, "POST", "story", "/_api/image/jobs", job, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("no password: %d", w.Code)
	}
	if w := imageReq(s, "POST", "story", "/_api/image/jobs", job, "wrong"); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", w.Code)
	}
	if w := imageReq(s, "GET", "story", "/_api/editor", "", "secret-pw"); w.Code != http.StatusOK || w.Header().Get("WWW-Authenticate") != "" {
		t.Fatalf("editor check: %d", w.Code)
	}
	if w := imageReq(s, "POST", "story", "/_api/image/jobs", job, "secret-pw"); w.Code != http.StatusAccepted {
		t.Fatalf("paint: %d %s", w.Code, w.Body)
	}
	if st := waitImage(t, s, "kalki-sheet"); st.State != "done" || st.Version == 0 {
		t.Fatalf("state %+v", st)
	}
	if !strings.HasPrefix(p.prompts[0], "gemini-3-pro-image|16:9|") {
		t.Fatalf("prompt %q", p.prompts[0])
	}

	// A panel that uses the sheet as a reference, with the cheaper model.
	panel := `{"jobs":[{"key":"kalki-c1-p01","prompt":"Kalki at the ghat","refs":["kalki-sheet"]}]}`
	if w := imageReq(s, "POST", "story", "/_api/image/jobs", panel, "secret-pw"); w.Code != http.StatusAccepted {
		t.Fatalf("panel: %d %s", w.Code, w.Body)
	}
	waitImage(t, s, "kalki-c1-p01")
	if !strings.HasPrefix(p.prompts[1], "gemini-3.1-flash-image|16:9|") || p.refs[1] != 1 {
		t.Fatalf("panel call %q refs %d", p.prompts[1], p.refs[1])
	}

	w := imageReq(s, "GET", "story", "/_api/image/jobs?keys=kalki-sheet,kalki-c1-p01,nope", "", "")
	var got struct{ Images map[string]imageState }
	json.Unmarshal(w.Body.Bytes(), &got)
	if got.Images["kalki-c1-p01"].State != "done" || got.Images["nope"].State != "missing" {
		t.Fatalf("status %s", w.Body)
	}
	w = imageReq(s, "GET", "story", "/_api/image/files/kalki-c1-p01.jpg?v=1", "", "")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/jpeg" || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("file: %d %v", w.Code, w.Header())
	}
	if w := imageReq(s, "DELETE", "story", "/_api/image/files/kalki-c1-p01", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("delete without password: %d", w.Code)
	}
	if w := imageReq(s, "DELETE", "story", "/_api/image/files/kalki-c1-p01", "", "secret-pw"); w.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", w.Code)
	}
}

func TestImageRateLimitFallsBack(t *testing.T) {
	old := imageBackoff
	imageBackoff = []time.Duration{time.Millisecond, time.Millisecond}
	t.Cleanup(func() { imageBackoff = old })
	s, p := imageServer(t)
	p.limited = map[string]bool{"gemini-3-pro-image": true}
	job := `{"jobs":[{"key":"sheet","prompt":"a hero","high":true}]}`
	if w := imageReq(s, "POST", "story", "/_api/image/jobs", job, "secret-pw"); w.Code != http.StatusAccepted {
		t.Fatalf("paint: %d %s", w.Code, w.Body)
	}
	if st := waitImage(t, s, "sheet"); st.State != "done" {
		t.Fatalf("state %+v", st)
	}
	// Three tries on the limited model (two waits), then the regular one.
	if len(p.prompts) != 4 || !strings.HasPrefix(p.prompts[3], "gemini-3.1-flash-image|") {
		t.Fatalf("calls %q", p.prompts)
	}

	p.limited["gemini-3.1-flash-image"] = true
	imageReq(s, "POST", "story", "/_api/image/jobs", `{"jobs":[{"key":"panel","prompt":"x"}]}`, "secret-pw")
	if st := waitImage(t, s, "panel"); st.State != "error" || !strings.Contains(st.Error, "429") {
		t.Fatalf("state %+v", st)
	}
}

func TestImageRejects(t *testing.T) {
	s, _ := imageServer(t)
	for name, body := range map[string]string{
		"bad key":     `{"jobs":[{"key":"../x","prompt":"p"}]}`,
		"no prompt":   `{"jobs":[{"key":"a","prompt":" "}]}`,
		"bad aspect":  `{"jobs":[{"key":"a","prompt":"p","aspect":"5:1"}]}`,
		"missing ref": `{"jobs":[{"key":"a","prompt":"p","refs":["ghost"]}]}`,
		"empty":       `{"jobs":[]}`,
	} {
		if w := imageReq(s, "POST", "story", "/_api/image/jobs", body, "secret-pw"); w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d", name, w.Code)
		}
	}
	s.images.init()
	s.images.take("story", imagePerDay)
	if w := imageReq(s, "POST", "story", "/_api/image/jobs", `{"jobs":[{"key":"a","prompt":"p"}]}`, "secret-pw"); w.Code != http.StatusTooManyRequests {
		t.Errorf("over the daily cap: got %d", w.Code)
	}
}
