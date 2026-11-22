package web

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"sort"
	"time"

	"appshome/internal/deploy"
	"appshome/internal/registry"
)

type dashRow struct {
	appView
	State deploy.AppState
	Short string
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	st := s.engine.State()
	var rows []dashRow
	for _, as := range st.Apps {
		row := dashRow{appView: s.view(as.App), State: as}
		if len(as.Hash) >= 12 {
			row.Short = as.Hash[:12]
		}
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })

	var problems []string
	for name, p := range st.Problems {
		problems = append(problems, "apps/"+name+": "+p)
	}
	sort.Strings(problems)

	source := s.cfg.RepoPath() + " (local folder, rescanned every poll)"
	if s.cfg.GitMode() {
		source = s.cfg.RepoURL + " @ " + s.cfg.Branch
	}
	s.render(w, http.StatusOK, "admin.html", map[string]any{
		"PageTitle": "Deploys · " + s.cfg.Domain,
		"State":     st,
		"Rows":      rows,
		"Problems":  problems,
		"Source":    source,
		"Poll":      s.cfg.PollSeconds,
		"Msg":       r.URL.Query().Get("msg"),
	})
}

func (s *Server) deployNow(w http.ResponseWriter, r *http.Request) {
	msg := "Deployed"
	if err := s.sync(true); err != nil {
		msg = "Deploy failed: " + err.Error()
	}
	http.Redirect(w, r, "/?msg="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (s *Server) sync(force bool) error {
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Minute)
	defer cancel()
	return s.engine.Sync(ctx, force)
}

func (s *Server) buildLog(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if registry.ValidateName(name) != nil {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(s.engine.BuildLog(name))
	if err != nil {
		http.Error(w, "no build log for "+name+" (buildless apps only log on failure)", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(b)
}

func (s *Server) internalDeploy(w http.ResponseWriter, r *http.Request) {
	err := s.sync(r.URL.Query().Get("force") == "1")
	st := s.engine.State()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "state": st})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) internalReload(w http.ResponseWriter, r *http.Request) {
	if err := s.reload(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "reloaded"})
}
