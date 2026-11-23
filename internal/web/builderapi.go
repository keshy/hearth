package web

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"appshome/internal/builder"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

const buildLogTail = 64 << 10

// builderAppView is one app as the builder's troubleshooting view sees it.
type builderAppView struct {
	Name        string        `json:"name"`
	Title       string        `json:"title"`
	Description string        `json:"description,omitempty"`
	Kind        registry.Kind `json:"kind"`
	URL         string        `json:"url"`
	IconURL     string        `json:"icon_url,omitempty"`
	Status      string        `json:"status"` // live, failed, invalid
	Error       string        `json:"error,omitempty"`
	Health      *Status       `json:"health,omitempty"`
	Private     bool          `json:"private,omitempty"`
	Hidden      bool          `json:"hidden,omitempty"`
	Generated   bool          `json:"generated"`
	Editable    bool          `json:"editable"`
	Errors      int           `json:"errors"`
	Updated     time.Time     `json:"updated"`
	DeployedAt  time.Time     `json:"deployed_at"`
	Release     string        `json:"release,omitempty"`
}

func (s *Server) builderView(st deploy.AppState) builderAppView {
	a := st.App
	v := builderAppView{
		Name: a.Name, Title: a.Title, Description: a.Description, Kind: a.Kind, URL: s.cfg.AppURL(a.Name),
		Status: st.Status, Error: st.Error, Private: a.Private, Hidden: a.Hidden, Generated: a.Generated,
		Editable: a.Generated && s.builder != nil, Errors: len(s.errs.list(a.Name)),
		Updated: a.Updated, DeployedAt: st.DeployedAt,
	}
	if st.Release != "" {
		v.Release = st.Release[strings.LastIndex(st.Release, string(os.PathSeparator))+1:]
	}
	if a.Kind == registry.KindLink {
		v.URL = a.URL
	}
	if strings.HasPrefix(a.Icon, "/") && (a.Kind == registry.KindStatic || a.Kind == registry.KindHybrid) {
		v.IconURL = s.cfg.PortalURL() + "/icons/" + a.Name
	}
	if s.health != nil && (a.Kind == registry.KindProxied || a.Kind == registry.KindHybrid) {
		h := s.health.Get(a.Name)
		v.Health = &h
	}
	return v
}

func (s *Server) builderApps(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	state := s.engine.State()
	out := []builderAppView{}
	for _, st := range state.Apps {
		out = append(out, s.builderView(st))
	}
	for name, problem := range state.Problems {
		if _, ok := state.Apps[name]; !ok {
			out = append(out, builderAppView{Name: name, Title: name, Status: "invalid", Error: problem, URL: s.cfg.AppURL(name)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) builderAppDetail(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	name := r.PathValue("name")
	state := s.engine.State()
	st, ok := state.Apps[name]
	var view builderAppView
	switch {
	case ok:
		view = s.builderView(st)
	case state.Problems[name] != "":
		view = builderAppView{Name: name, Title: name, Status: "invalid", Error: state.Problems[name], URL: s.cfg.AppURL(name)}
	default:
		writeErr(w, http.StatusNotFound, "no app called "+name)
		return
	}
	resp := map[string]any{"app": view, "errors": s.errs.list(name)}
	if files, err := s.builder.Files(name); err == nil {
		resp["files"] = files
	} else {
		resp["files_error"] = err.Error()
	}
	if hist, err := s.builder.History(r.Context(), name); err == nil {
		resp["history"] = hist
	} else {
		resp["history_error"] = err.Error()
	}
	if manifest, err := s.builder.ReadFile(name, registry.ManifestFile); err == nil {
		resp["manifest"] = manifest
	}
	resp["jobs"] = s.builder.Jobs(name)
	resp["build_log"] = tailFile(s.engine.BuildLog(name), buildLogTail)
	writeJSON(w, http.StatusOK, resp)
}

func tailFile(p string, n int64) string {
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()
	if fi, err := f.Stat(); err == nil && fi.Size() > n {
		f.Seek(-n, io.SeekEnd)
	}
	b, _ := io.ReadAll(f)
	return string(b)
}

func (s *Server) builderAppFile(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	text, err := s.builder.ReadFile(r.PathValue("name"), r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": r.URL.Query().Get("path"), "content": text})
}

func (s *Server) builderDiagnose(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	name := r.PathValue("name")
	var req struct {
		AI bool `json:"ai"`
	}
	json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req)
	sym := builder.Symptoms{}
	state := s.engine.State()
	if st, ok := state.Apps[name]; ok {
		sym.Status, sym.DeployError = st.Status, st.Error
	} else if p := state.Problems[name]; p != "" {
		sym.Status, sym.DeployError = "invalid", p
	}
	if st, ok := state.Apps[name]; ok && s.health != nil && (st.App.Kind == registry.KindProxied || st.App.Kind == registry.KindHybrid) {
		h := s.health.Get(name)
		sym.Health, sym.HealthDetail = h.State, h.Detail
	}
	for i, ce := range s.errs.list(name) {
		if i == 10 {
			break
		}
		line := fmt.Sprintf("%s: %s", ce.Kind, ce.Message)
		if ce.Source != "" {
			line += fmt.Sprintf(" (%s:%d:%d)", ce.Source, ce.Line, ce.Col)
		}
		if ce.Count > 1 {
			line += fmt.Sprintf(" ×%d", ce.Count)
		}
		if ce.Stack != "" {
			line += "\n    " + strings.ReplaceAll(clip(ce.Stack, 600), "\n", "\n    ")
		}
		sym.ClientErrors = append(sym.ClientErrors, line)
	}
	d, err := s.builder.Diagnose(r.Context(), name, sym, req.AI)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) builderRestore(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	var req struct {
		Commit string `json:"commit"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "send JSON: {commit}")
		return
	}
	job, err := s.builder.StartRestore(r.PathValue("name"), req.Commit)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) builderClearErrors(w http.ResponseWriter, r *http.Request) {
	if !s.builderApp(w, r) {
		return
	}
	s.errs.clear(r.PathValue("name"))
	writeJSON(w, http.StatusOK, map[string]string{"cleared": r.PathValue("name")})
}
