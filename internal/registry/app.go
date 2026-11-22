// Package registry reads app manifests from the repo: apps/<name>/app.yaml.
// The folder name is the app's name and its address (<name>.<domain>).
package registry

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Kind string

const (
	KindStatic  Kind = "static"  // files from the repo, optionally built, served by Caddy
	KindHybrid  Kind = "hybrid"  // static files + an API prefix proxied to a backend you run
	KindProxied Kind = "proxied" // reverse proxy to a backend you run
	KindLink    Kind = "link"    // portal card; <name>.<domain> redirects to the URL
)

const ManifestFile = "app.yaml"

const (
	// CapBuilder lets an app call the builder API (/_api/builder).
	CapBuilder = "builder"
	// CapLLM lets an app send prompts to the platform's model (/_api/llm).
	CapLLM = "llm"
)

type App struct {
	Name        string   `yaml:"-" json:"name"`
	Title       string   `yaml:"title" json:"title"`
	Description string   `yaml:"description,omitempty" json:"description,omitempty"`
	Kind        Kind     `yaml:"kind" json:"kind"`
	Tags        []string `yaml:"tags,omitempty" json:"tags,omitempty"`
	// A path on the app's own host ("/icon.svg") or an absolute http(s) URL.
	Icon   string `yaml:"icon,omitempty" json:"icon,omitempty"`
	Hidden bool   `yaml:"hidden,omitempty" json:"hidden,omitempty"`
	// Private apps require the admin password.
	Private bool `yaml:"private,omitempty" json:"private,omitempty"`

	// static and hybrid
	Build  string `yaml:"build,omitempty" json:"build,omitempty"`   // shell command run in a copy of the app folder
	Output string `yaml:"output,omitempty" json:"output,omitempty"` // folder with index.html, relative to the app folder

	// proxied and hybrid
	Upstream         string `yaml:"upstream,omitempty" json:"upstream,omitempty"`
	UpstreamInsecure bool   `yaml:"upstream_insecure,omitempty" json:"upstream_insecure,omitempty"`
	APIPrefix        string `yaml:"api_prefix,omitempty" json:"api_prefix,omitempty"`
	HealthPath       string `yaml:"health_path,omitempty" json:"health_path,omitempty"`

	// link
	URL string `yaml:"url,omitempty" json:"url,omitempty"`

	// Generated apps were written by the builder: no build step, strict CSP.
	Generated    bool     `yaml:"generated,omitempty" json:"generated,omitempty"`
	Capabilities []string `yaml:"capabilities,omitempty" json:"capabilities,omitempty"`

	// From git history, not the manifest.
	Created time.Time `yaml:"-" json:"created"`
	Updated time.Time `yaml:"-" json:"updated"`
}

var (
	nameRE = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`)
	pathRE = regexp.MustCompile(`^/[A-Za-z0-9._~/-]*$`)
	hostRE = regexp.MustCompile(`^[A-Za-z0-9.-]+(:[0-9]{1,5})?$`)
	tagRE  = regexp.MustCompile(`^[a-z0-9][a-z0-9 -]{0,23}$`)
)

// Reserved names collide with the portal, admin UI or common conventions.
var reserved = map[string]bool{"admin": true, "www": true, "api": true, "trust": true, "static": true}

func ValidateName(name string) error {
	if !nameRE.MatchString(name) {
		return errors.New("name must be 1-40 lowercase letters, digits or dashes, not starting or ending with a dash")
	}
	if reserved[name] {
		return fmt.Errorf("%q is reserved", name)
	}
	return nil
}

func (a App) NeedsSite() bool { return a.Kind == KindStatic || a.Kind == KindHybrid }

func (a App) Has(capability string) bool {
	for _, c := range a.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

// Discover parses every apps/<name>/app.yaml under repoDir. Invalid manifests
// are reported per app and skipped, so one bad app never blocks the others.
func Discover(repoDir string) ([]App, map[string]string) {
	problems := map[string]string{}
	entries, err := os.ReadDir(filepath.Join(repoDir, "apps"))
	if err != nil {
		problems["apps/"] = err.Error()
		return nil, problems
	}
	var apps []App
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || strings.HasPrefix(e.Name(), "_") {
			continue
		}
		a, err := Load(filepath.Join(repoDir, "apps", e.Name()))
		if err != nil {
			problems[e.Name()] = err.Error()
			continue
		}
		apps = append(apps, a)
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].Name < apps[j].Name })
	return apps, problems
}

// Load reads and validates one app folder's manifest.
func Load(dir string) (App, error) {
	var a App
	b, err := os.ReadFile(filepath.Join(dir, ManifestFile))
	if err != nil {
		return a, fmt.Errorf("missing %s", ManifestFile)
	}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	if err := dec.Decode(&a); err != nil {
		return a, fmt.Errorf("%s: %w", ManifestFile, err)
	}
	a.Name = filepath.Base(dir)
	return a, a.Clean()
}

func (a *App) Clean() error {
	if err := ValidateName(a.Name); err != nil {
		return err
	}
	a.Title = strings.TrimSpace(a.Title)
	if a.Title == "" {
		a.Title = a.Name
	}
	if len(a.Title) > 80 {
		return errors.New("title must be 80 characters or fewer")
	}
	a.Description = strings.TrimSpace(a.Description)
	if len(a.Description) > 500 {
		return errors.New("description must be 500 characters or fewer")
	}
	tags, err := cleanTags(a.Tags)
	if err != nil {
		return err
	}
	a.Tags = tags

	if !a.NeedsSite() && (a.Build != "" || a.Output != "") {
		return fmt.Errorf("build/output only apply to static and hybrid apps")
	}
	if a.NeedsSite() {
		out, err := cleanRel(a.Output)
		if err != nil {
			return fmt.Errorf("output: %w", err)
		}
		a.Output = out
		if a.Generated && a.Build != "" {
			return errors.New("generated apps can't have a build step")
		}
	}

	switch a.Kind {
	case KindStatic:
		if a.Upstream != "" || a.URL != "" {
			return errors.New("static apps don't take upstream or url")
		}
	case KindProxied, KindHybrid:
		u, err := normalizeUpstream(a.Upstream)
		if err != nil {
			return err
		}
		a.Upstream = u
		if a.HealthPath != "" && !pathRE.MatchString(a.HealthPath) {
			return errors.New("health_path must start with / and contain only URL-safe characters")
		}
		if a.Kind == KindHybrid {
			a.APIPrefix = strings.TrimRight(strings.TrimSpace(a.APIPrefix), "/")
			if a.APIPrefix == "" {
				a.APIPrefix = "/api"
			}
			if !pathRE.MatchString(a.APIPrefix) || strings.HasPrefix(a.APIPrefix, "/_api") {
				return errors.New("api_prefix must start with /, use URL-safe characters, and not be /_api")
			}
		} else if a.APIPrefix != "" {
			return errors.New("api_prefix only applies to hybrid apps")
		}
	case KindLink:
		l, err := normalizeLink(a.URL)
		if err != nil {
			return err
		}
		a.URL = l
	case "":
		return errors.New("kind is required: static, hybrid, proxied or link")
	default:
		return fmt.Errorf("unknown kind %q (use static, hybrid, proxied or link)", a.Kind)
	}

	if a.Generated && a.Kind != KindStatic {
		return errors.New("generated apps must be static")
	}
	if a.Generated && len(a.Capabilities) > 0 {
		return errors.New("generated apps can't request capabilities")
	}
	for _, c := range a.Capabilities {
		if c != CapBuilder && c != CapLLM {
			return fmt.Errorf("unknown capability %q", c)
		}
	}
	if a.Icon != "" && !validIcon(a.Icon) {
		return errors.New("icon must be a path like /icon.svg or an http(s) URL")
	}
	return nil
}

func cleanRel(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" || p == "." {
		return ".", nil
	}
	if strings.HasPrefix(p, "/") || strings.Contains(p, `\`) {
		return "", errors.New("must be a relative folder")
	}
	c := path.Clean(p)
	if c == ".." || strings.HasPrefix(c, "../") {
		return "", errors.New("must stay inside the app folder")
	}
	return c, nil
}

func cleanTags(in []string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		if !tagRE.MatchString(t) {
			return nil, fmt.Errorf("tag %q must be up to 24 letters, digits, spaces or dashes", t)
		}
		seen[t] = true
		out = append(out, t)
	}
	if len(out) > 10 {
		return nil, errors.New("use at most 10 tags")
	}
	return out, nil
}

func normalizeUpstream(s string) (string, error) {
	s = strings.TrimSpace(s)
	u, err := url.Parse(s)
	if s == "" || err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("upstream must look like http://192.168.0.60:8080")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("upstream must not include a path, query or credentials")
	}
	if !hostRE.MatchString(u.Host) {
		return "", errors.New("upstream host must be a hostname or IPv4 address with an optional port")
	}
	return u.Scheme + "://" + u.Host, nil
}

func normalizeLink(s string) (string, error) {
	s = strings.TrimSpace(s)
	u, err := url.Parse(s)
	if s == "" || err != nil || u.Scheme == "" || strings.ContainsAny(s, " \"'<>`") {
		return "", errors.New("url must be a full URL like http://192.168.0.20:32400/web")
	}
	switch strings.ToLower(u.Scheme) {
	case "javascript", "data", "vbscript", "file":
		return "", fmt.Errorf("%s: links are not allowed", u.Scheme)
	}
	return s, nil
}

func validIcon(s string) bool {
	if pathRE.MatchString(s) {
		return true
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" &&
		!strings.ContainsAny(s, " \"'<>`")
}

func ParseTags(s string) []string {
	var out []string
	for _, t := range strings.Split(s, ",") {
		if t = strings.ToLower(strings.TrimSpace(t)); t != "" {
			out = append(out, t)
		}
	}
	return out
}
