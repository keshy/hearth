// Package web serves the portal (apps domain), the deploy dashboard
// (admin.<domain>), the certificate trust page, and the platform API that
// apps reach at /_api on their own host.
package web

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/connect"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

//go:embed templates/*.html static/*
var assets embed.FS

type Server struct {
	cfg     config.Config
	engine  *deploy.Engine
	health  *Health
	builder *builder.Builder
	reload  func() error
	tmpl    *template.Template
	log     *log.Logger
	ctx     context.Context

	llmLimit llmLimiter
	errs     errorStore
	pngs     pngCache
	fb       *feedbackStore
	fbOnce   sync.Once
	connect  *connect.Hub
}

func New(ctx context.Context, cfg config.Config, engine *deploy.Engine, health *Health, b *builder.Builder, reload func() error, logger *log.Logger) (*Server, error) {
	funcs := template.FuncMap{
		"join":  strings.Join,
		"lower": strings.ToLower,
		"ago":   ago,
	}
	t, err := template.New("").Funcs(funcs).ParseFS(assets, "templates/*.html")
	if err != nil {
		return nil, err
	}
	return &Server{ctx: ctx, cfg: cfg, engine: engine, health: health, builder: b, reload: reload, tmpl: t, log: logger}, nil
}

func (s *Server) Handler() http.Handler {
	staticFS, _ := fs.Sub(assets, "static")
	static := http.StripPrefix("/static/", http.FileServerFS(staticFS))

	portal := http.NewServeMux()
	portal.Handle("GET /static/", static)
	portal.HandleFunc("GET /{$}", s.portal)
	portal.HandleFunc("GET /api/apps", s.apiApps)
	portal.HandleFunc("GET /api/status", s.apiStatus)
	portal.HandleFunc("GET /trust", s.trust)
	portal.HandleFunc("GET /trust/root.crt", s.rootCert)
	portal.HandleFunc("GET /icons/{name}", s.appIcon)

	admin := http.NewServeMux()
	admin.Handle("GET /static/", static)
	admin.HandleFunc("GET /{$}", s.dashboard)
	admin.HandleFunc("POST /deploy", s.deployNow)
	admin.HandleFunc("GET /logs/{name}", s.buildLog)
	admin.HandleFunc("GET /feedback", s.feedbackInbox)
	admin.HandleFunc("GET /feedback/images/{file}", s.feedbackImage)
	admin.HandleFunc("POST /feedback/{id}/{action}", s.feedbackChange)
	adminH := s.requireAdmin(sameOrigin(admin))

	// Reached only through Caddy's per-app /_api/* route, which sets the app header.
	api := http.NewServeMux()
	api.HandleFunc("GET /_api/data", s.dataList)
	api.HandleFunc("GET /_api/data/{key}", s.dataGet)
	api.HandleFunc("PUT /_api/data/{key}", s.dataPut)
	api.HandleFunc("DELETE /_api/data/{key}", s.dataDelete)
	api.HandleFunc("GET /_api/builder/info", s.builderInfo)
	api.HandleFunc("GET /_api/builder/apps", s.builderApps)
	api.HandleFunc("POST /_api/builder/jobs", s.builderStart)
	api.HandleFunc("GET /_api/builder/jobs/{id}", s.builderJob)
	api.HandleFunc("GET /_api/builder/apps/{name}", s.builderAppDetail)
	api.HandleFunc("GET /_api/builder/apps/{name}/file", s.builderAppFile)
	api.HandleFunc("POST /_api/builder/apps/{name}/diagnose", s.builderDiagnose)
	api.HandleFunc("POST /_api/builder/apps/{name}/restore", s.builderRestore)
	api.HandleFunc("DELETE /_api/builder/apps/{name}/errors", s.builderClearErrors)
	api.HandleFunc("POST /_api/llm", s.llmAsk)
	api.HandleFunc("GET /_api/connect/devices", s.connectDevices)
	api.HandleFunc("GET /_api/connect/devices/{id}", s.connectStatus)
	api.HandleFunc("POST /_api/connect/devices/{id}/{action}", s.connectAction)

	// Plain localhost calls from the appshome CLI.
	internal := http.NewServeMux()
	internal.HandleFunc("POST /_internal/deploy", s.internalDeploy)
	internal.HandleFunc("POST /_internal/reload", s.internalReload)
	internal.HandleFunc("GET /api/status", s.apiStatus)

	// Theme and error reports, on every app host, the portal and the admin page.
	hearth := s.hearthHandler()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		switch {
		case r.Host == s.cfg.AppListen:
			internal.ServeHTTP(w, r)
		case strings.HasPrefix(r.URL.Path, "/_hearth/"):
			hearth.ServeHTTP(w, r)
		case r.Header.Get(caddy.AppHeader) != "":
			api.ServeHTTP(w, r)
		case hostOnly(r.Host) == s.cfg.AdminHost():
			w.Header().Set("X-Frame-Options", "DENY")
			adminH.ServeHTTP(w, r)
		default:
			portal.ServeHTTP(w, r)
		}
	})
}

func (s *Server) render(w http.ResponseWriter, status int, name string, data map[string]any) {
	data["Domain"] = s.cfg.Domain
	data["PortalURL"] = s.cfg.PortalURL()
	data["AdminURL"] = s.cfg.AdminURL()
	data["TrustURL"] = s.cfg.TrustURL()
	var buf bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&buf, name, data); err != nil {
		s.log.Printf("template %s: %v", name, err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	w.Write(buf.Bytes())
}

// appView is an app plus everything the templates need to show it.
type appView struct {
	registry.App
	URL     string
	IconURL string
	Initial string
	Status  string
	Detail  string
	IsNew   bool
}

const newFor = 7 * 24 * time.Hour

func (s *Server) view(a registry.App) appView {
	v := appView{App: a, URL: s.cfg.AppURL(a.Name)}
	if a.Kind == registry.KindLink {
		v.URL = a.URL
	}
	switch {
	case strings.HasPrefix(a.Icon, "/"):
		if a.Kind != registry.KindLink && a.Kind != registry.KindProxied {
			v.IconURL = "/icons/" + a.Name
		}
	case a.Icon != "":
		v.IconURL = a.Icon
	}
	if r := []rune(a.Title); len(r) > 0 {
		v.Initial = strings.ToUpper(string(r[0]))
	}
	st := s.health.Get(a.Name)
	v.Status, v.Detail = st.State, st.Detail
	v.IsNew = !a.Created.IsZero() && time.Since(a.Created) < newFor
	return v
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hash := s.passwordHash()
		if hash == "" {
			http.Error(w, "Admin password not set. On the host, run: appshome set-password", http.StatusServiceUnavailable)
			return
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(pass)) != nil {
			w.Header().Set("WWW-Authenticate", `Basic realm="`+s.cfg.Domain+` admin (user: admin)", charset="UTF-8"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// passwordHash re-reads config.json so `appshome set-password` takes effect
// without restarting the service.
func (s *Server) passwordHash() string {
	if c, err := config.Load(s.cfg.DataDir); err == nil {
		return c.AdminPasswordHash
	}
	return s.cfg.AdminPasswordHash
}

// sameOrigin blocks cross-site writes. Browsers resend cached basic-auth
// credentials, so a page elsewhere could otherwise post to the admin UI.
func sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !sameOriginRequest(r) {
			http.Error(w, "cross-site request blocked", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameOriginRequest(r *http.Request) bool {
	if sfs := r.Header.Get("Sec-Fetch-Site"); sfs != "" && sfs != "same-origin" && sfs != "none" {
		return false
	}
	if o := r.Header.Get("Origin"); o != "" {
		u, err := url.Parse(o)
		if err != nil || hostOnly(u.Host) != hostOnly(r.Host) {
			return false
		}
	}
	return true
}

func hostOnly(h string) string {
	if host, _, err := net.SplitHostPort(h); err == nil {
		h = host
	}
	return strings.ToLower(strings.TrimSuffix(h, "."))
}

func ago(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	case d < 30*24*time.Hour:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
	return t.Format("Jan 2, 2006")
}
