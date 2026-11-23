package web

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"appshome/internal/caddy"
	"appshome/internal/registry"
)

// The house theme is one cookie on the apps domain, so choosing dark mode in
// any app (or the portal) applies everywhere. hearth.js never reads cookies
// itself: the server bakes the saved choice into the script it serves.
const (
	themeCookie      = "hearth_theme"
	maxErrorsPerApp  = 50
	errorWindow      = time.Minute
	errorsPerWindow  = 30
	maxErrorBodySize = 8 << 10
)

func (s *Server) hearthHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /_hearth/theme.css", s.hearthAsset("hearth/theme.css", "text/css; charset=utf-8"))
	mux.HandleFunc("GET /_hearth/kit.css", s.hearthAsset("hearth/kit.css", "text/css; charset=utf-8"))
	mux.HandleFunc("GET /_hearth/hearth.js", s.hearthScript)
	mux.HandleFunc("GET /_hearth/theme", s.themeGet)
	mux.HandleFunc("POST /_hearth/theme", s.themeSet)
	mux.HandleFunc("POST /_hearth/errors", s.errorReport)
	mux.HandleFunc("GET /_hearth/manifest.webmanifest", s.webManifest)
	mux.HandleFunc("GET /_hearth/icons/{file}", s.manifestIcon)
	return mux
}

func (s *Server) hearthAsset(name, ctype string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b, err := assets.ReadFile("static/" + name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", ctype)
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Write(b)
	}
}

func themePref(r *http.Request) string {
	if c, err := r.Cookie(themeCookie); err == nil && (c.Value == "light" || c.Value == "dark") {
		return c.Value
	}
	return "system"
}

func (s *Server) hearthScript(w http.ResponseWriter, r *http.Request) {
	b, err := assets.ReadFile("static/hearth/hearth.js")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	b = bytes.Replace(b, []byte(`"__PREF__"`), []byte(`"`+themePref(r)+`"`), 1)
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Vary", "Cookie")
	w.Write(b)
}

func (s *Server) themeGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"theme": themePref(r)})
}

func (s *Server) themeSet(w http.ResponseWriter, r *http.Request) {
	if sfs := r.Header.Get("Sec-Fetch-Site"); sfs != "" && sfs != "same-origin" && sfs != "same-site" {
		writeErr(w, http.StatusForbidden, "cross-site request blocked")
		return
	}
	var body struct {
		Theme string `json:"theme"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, `send {"theme": "system" | "light" | "dark"}`)
		return
	}
	c := &http.Cookie{Name: themeCookie, Domain: s.cfg.Domain, Path: "/", SameSite: http.SameSiteLaxMode}
	switch body.Theme {
	case "light", "dark":
		c.Value, c.MaxAge = body.Theme, 5*365*24*3600
	case "system":
		c.MaxAge = -1
	default:
		writeErr(w, http.StatusBadRequest, `theme is "system", "light" or "dark"`)
		return
	}
	http.SetCookie(w, c)
	writeJSON(w, http.StatusOK, map[string]string{"theme": body.Theme})
}

// ClientError is something that went wrong in a visitor's browser.
type ClientError struct {
	Kind    string    `json:"kind"`
	Message string    `json:"message"`
	Source  string    `json:"source,omitempty"`
	Line    int       `json:"line,omitempty"`
	Col     int       `json:"col,omitempty"`
	Stack   string    `json:"stack,omitempty"`
	Page    string    `json:"page,omitempty"`
	Agent   string    `json:"agent,omitempty"`
	At      time.Time `json:"at"`
	Count   int       `json:"count"`
}

type errorStore struct {
	mu     sync.Mutex
	byApp  map[string][]ClientError
	recent map[string][]time.Time
	now    func() time.Time
}

func (e *errorStore) add(app string, ce ClientError) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.byApp == nil {
		e.byApp, e.recent = map[string][]ClientError{}, map[string][]time.Time{}
	}
	now := time.Now()
	if e.now != nil {
		now = e.now()
	}
	keep := e.recent[app][:0]
	for _, t := range e.recent[app] {
		if now.Sub(t) < errorWindow {
			keep = append(keep, t)
		}
	}
	if len(keep) >= errorsPerWindow {
		e.recent[app] = keep
		return false
	}
	e.recent[app] = append(keep, now)
	ce.At, ce.Count = now, 1
	list := e.byApp[app]
	for i := range list {
		if list[i].Kind == ce.Kind && list[i].Message == ce.Message && list[i].Source == ce.Source && list[i].Line == ce.Line {
			list[i].Count++
			list[i].At, list[i].Page, list[i].Agent = now, ce.Page, ce.Agent
			return true
		}
	}
	list = append(list, ce)
	if len(list) > maxErrorsPerApp {
		list = list[len(list)-maxErrorsPerApp:]
	}
	e.byApp[app] = list
	return true
}

// list returns the newest first.
func (e *errorStore) list(app string) []ClientError {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := append([]ClientError{}, e.byApp[app]...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out
}

func (e *errorStore) clear(app string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.byApp, app)
}

func (s *Server) errorReport(w http.ResponseWriter, r *http.Request) {
	name := r.Header.Get(caddy.AppHeader)
	if name == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, ok := s.callingApp(w, r); !ok {
		return
	}
	var ce ClientError
	if err := json.NewDecoder(io.LimitReader(r.Body, maxErrorBodySize)).Decode(&ce); err != nil || strings.TrimSpace(ce.Message) == "" {
		writeErr(w, http.StatusBadRequest, "send {kind, message, ...}")
		return
	}
	ce.Kind = clip(ce.Kind, 20)
	ce.Message, ce.Source, ce.Stack = clip(ce.Message, 500), clip(ce.Source, 300), clip(ce.Stack, 2000)
	ce.Page, ce.Agent = clip(ce.Page, 300), clip(ce.Agent, 200)
	if !s.errs.add(name, ce) {
		writeErr(w, http.StatusTooManyRequests, "too many error reports")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// appIcon serves an app's own icon from its live release, so the portal can
// show icons of private apps (whose hosts need the admin password).
func (s *Server) appIcon(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var app registry.App
	found := false
	for _, a := range s.engine.Apps() {
		if a.Name == name {
			app, found = a, true
		}
	}
	p, ok := s.iconFile(app)
	if !found || !ok {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(strings.ToLower(p), ".svg") {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	http.ServeFile(w, r, p)
}

// iconFile is the app's local icon inside its live release, if it has one.
func (s *Server) iconFile(app registry.App) (string, bool) {
	if !strings.HasPrefix(app.Icon, "/") || !app.NeedsSite() {
		return "", false
	}
	root := s.engine.LiveDir(app.Name)
	p := filepath.Join(root, filepath.FromSlash(filepath.Clean("/"+strings.TrimPrefix(app.Icon, "/"))))
	if rel, err := filepath.Rel(root, p); err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	if fi, err := os.Stat(p); err != nil || fi.IsDir() || fi.Size() > 512<<10 {
		return "", false
	}
	return p, true
}
