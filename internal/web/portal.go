package web

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"appshome/internal/registry"
)

func (s *Server) visible() []appView {
	var out []appView
	for _, a := range s.engine.Apps() {
		if !a.Hidden {
			out = append(out, s.view(a))
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out
}

func (s *Server) portal(w http.ResponseWriter, r *http.Request) {
	apps := s.visible()

	var recent []appView
	tagSet := map[string]bool{}
	for _, a := range apps {
		if a.IsNew {
			recent = append(recent, a)
		}
		for _, t := range a.Tags {
			tagSet[t] = true
		}
	}
	sort.Slice(recent, func(i, j int) bool { return recent[i].Created.After(recent[j].Created) })
	if len(recent) == len(apps) {
		recent = nil // everything is new; the section would just duplicate the grid
	}
	tags := make([]string, 0, len(tagSet))
	for t := range tagSet {
		tags = append(tags, t)
	}
	sort.Strings(tags)

	missing := r.URL.Query().Get("missing")
	if registry.ValidateName(missing) != nil {
		missing = ""
	}
	s.render(w, http.StatusOK, "portal.html", map[string]any{
		"PageTitle": s.cfg.Domain,
		"Apps":      apps,
		"Recent":    recent,
		"Tags":      tags,
		"Missing":   missing,
		"Unread":    s.feedback().unread(),
	})
}

type apiApp struct {
	Name        string    `json:"name"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	Kind        string    `json:"kind"`
	URL         string    `json:"url"`
	Icon        string    `json:"icon,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	Status      string    `json:"status"`
	Generated   bool      `json:"generated,omitempty"`
	Created     time.Time `json:"created"`
	Updated     time.Time `json:"updated"`
}

func (s *Server) apiApps(w http.ResponseWriter, r *http.Request) {
	out := []apiApp{}
	for _, v := range s.visible() {
		out = append(out, apiApp{
			Name: v.Name, Title: v.Title, Description: v.Description, Kind: string(v.Kind),
			URL: v.URL, Icon: v.IconURL, Tags: v.Tags, Status: v.Status, Generated: v.Generated,
			Created: v.Created, Updated: v.Updated,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) apiStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.health.Snapshot())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) trust(w http.ResponseWriter, r *http.Request) {
	fp, err := rootFingerprint(s.cfg.RootCertPath())
	s.render(w, http.StatusOK, "trust.html", map[string]any{
		"PageTitle":   "Trust " + s.cfg.Domain,
		"HasCert":     err == nil,
		"Fingerprint": fp,
	})
}

func (s *Server) rootCert(w http.ResponseWriter, r *http.Request) {
	b, err := os.ReadFile(s.cfg.RootCertPath())
	if err != nil {
		http.Error(w, "The certificate authority hasn't been created yet. Open "+s.cfg.PortalURL()+" once, then retry.", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="`+s.cfg.Domain+`-root.crt"`)
	w.Write(b)
}

func rootFingerprint(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	blk, _ := pem.Decode(b)
	if blk == nil {
		return "", fmt.Errorf("no PEM block in %s", path)
	}
	if _, err := x509.ParseCertificate(blk.Bytes); err != nil {
		return "", err
	}
	sum := sha256.Sum256(blk.Bytes)
	parts := make([]string, len(sum))
	for i, c := range sum {
		parts[i] = fmt.Sprintf("%02X", c)
	}
	return strings.Join(parts, ":"), nil
}
