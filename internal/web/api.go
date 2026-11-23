package web

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/registry"
)

const (
	maxValueBytes = 256 << 10
	maxKeysPerApp = 200
)

var keyRE = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// callingApp resolves the app named by Caddy's header and rejects
// cross-origin writes, so one app (or any other site) can't write another
// app's data from a visitor's browser.
func (s *Server) callingApp(w http.ResponseWriter, r *http.Request) (registry.App, bool) {
	name := r.Header.Get(caddy.AppHeader)
	for _, a := range s.engine.Apps() {
		if a.Name != name {
			continue
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if o := r.Header.Get("Origin"); o != "" {
				u, err := url.Parse(o)
				if err != nil || hostOnly(u.Host) != s.cfg.AppHost(name) {
					writeErr(w, http.StatusForbidden, "cross-origin request blocked")
					return a, false
				}
			}
			if sfs := r.Header.Get("Sec-Fetch-Site"); sfs != "" && sfs != "same-origin" {
				writeErr(w, http.StatusForbidden, "cross-site request blocked")
				return a, false
			}
		}
		return a, true
	}
	writeErr(w, http.StatusNotFound, "unknown app")
	return registry.App{}, false
}

func (s *Server) dataPath(app, key string) string {
	return filepath.Join(s.cfg.AppDataDir(), app, key+".json")
}

func (s *Server) dataList(w http.ResponseWriter, r *http.Request) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return
	}
	entries, _ := os.ReadDir(filepath.Join(s.cfg.AppDataDir(), a.Name))
	keys := []string{}
	for _, e := range entries {
		if k, ok := strings.CutSuffix(e.Name(), ".json"); ok && keyRE.MatchString(k) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}

func (s *Server) dataGet(w http.ResponseWriter, r *http.Request) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return
	}
	key := r.PathValue("key")
	if !keyRE.MatchString(key) {
		writeErr(w, http.StatusBadRequest, "keys are 1-64 letters, digits, _ or -")
		return
	}
	b, err := os.ReadFile(s.dataPath(a.Name, key))
	if errors.Is(err, os.ErrNotExist) {
		writeErr(w, http.StatusNotFound, "no value for "+key)
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func (s *Server) dataPut(w http.ResponseWriter, r *http.Request) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return
	}
	key := r.PathValue("key")
	if !keyRE.MatchString(key) {
		writeErr(w, http.StatusBadRequest, "keys are 1-64 letters, digits, _ or -")
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maxValueBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(b) > maxValueBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "values are limited to 256 KB")
		return
	}
	if !json.Valid(b) {
		writeErr(w, http.StatusBadRequest, "body must be JSON")
		return
	}
	dir := filepath.Join(s.cfg.AppDataDir(), a.Name)
	if _, err := os.Stat(s.dataPath(a.Name, key)); errors.Is(err, os.ErrNotExist) {
		if entries, _ := os.ReadDir(dir); len(entries) >= maxKeysPerApp {
			writeErr(w, http.StatusInsufficientStorage, "this app already has the maximum number of keys")
			return
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := config.WriteFileAtomic(s.dataPath(a.Name, key), b, 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"saved": key})
}

func (s *Server) dataDelete(w http.ResponseWriter, r *http.Request) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return
	}
	key := r.PathValue("key")
	if !keyRE.MatchString(key) {
		writeErr(w, http.StatusBadRequest, "bad key")
		return
	}
	os.Remove(s.dataPath(a.Name, key))
	writeJSON(w, http.StatusOK, map[string]string{"deleted": key})
}

// builderApp admits only apps with the builder capability. Those are private
// apps, so Caddy has already required the admin password.
func (s *Server) builderApp(w http.ResponseWriter, r *http.Request) bool {
	a, ok := s.callingApp(w, r)
	if !ok {
		return false
	}
	if !a.Has(registry.CapBuilder) || !a.Private {
		writeErr(w, http.StatusForbidden, "this app can't use the builder")
		return false
	}
	return true
}

func (s *Server) builderInfo(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	mode := "local folder " + s.cfg.RepoPath()
	if s.cfg.GitMode() {
		mode = s.cfg.RepoURL + " @ " + s.cfg.Branch
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"model":  s.builder.Model(),
		"repo":   mode,
		"domain": s.cfg.Domain,
	})
}

func (s *Server) builderStart(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	var req builder.Request
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "send JSON: {name, prompt, revise}")
		return
	}
	job, err := s.builder.Start(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) builderJob(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	job, ok := s.builder.Job(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	writeJSON(w, http.StatusOK, job)
}
