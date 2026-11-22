// Package config holds the on-disk settings for one apps-home install.
// Anything left empty is discovered at runtime, so the same config works
// after the host changes IP or moves to another Mac.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

const FileName = "config.json"

type Config struct {
	Domain string `json:"domain"`

	// Empty means auto-detect.
	Interface   string   `json:"interface,omitempty"`
	LANIP       string   `json:"lan_ip,omitempty"`
	UpstreamDNS []string `json:"upstream_dns,omitempty"`
	DNSListen   string   `json:"dns_listen,omitempty"`

	HTTPPort   int    `json:"http_port"`
	HTTPSPort  int    `json:"https_port"`
	AppListen  string `json:"app_listen"`
	CaddyAdmin string `json:"caddy_admin"`

	// Where apps come from. With RepoURL set, the host keeps a clone in
	// RepoDir (default <data>/repo) and deploys new commits on Branch.
	// Without it, RepoDir is used as-is (local development).
	RepoURL     string `json:"repo_url,omitempty"`
	RepoDir     string `json:"repo_dir,omitempty"`
	Branch      string `json:"branch"`
	PollSeconds int    `json:"poll_seconds"`

	// Builder app. Empty project means GOOGLE_CLOUD_PROJECT or the gcloud default.
	GCPProject  string `json:"gcp_project,omitempty"`
	GCPLocation string `json:"gcp_location"`
	GeminiModel string `json:"gemini_model"`

	AdminPasswordHash string `json:"admin_password_hash,omitempty"`

	DataDir string `json:"-"`
}

var domainRE = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

func Defaults(dataDir string) Config {
	return Config{
		Domain:      "apps.home",
		HTTPPort:    80,
		HTTPSPort:   443,
		AppListen:   "127.0.0.1:7070",
		CaddyAdmin:  "localhost:2019",
		Branch:      "main",
		PollSeconds: 60,
		GCPLocation: "global",
		GeminiModel: "gemini-4-argon",
		DataDir:     dataDir,
	}
}

// DefaultDataDir picks APPS_HOME_DATA, then Homebrew's var dir, then ~/.apps-home.
func DefaultDataDir() string {
	if v := os.Getenv("APPS_HOME_DATA"); v != "" {
		return v
	}
	for _, p := range []string{"/opt/homebrew/var", "/usr/local/var"} {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return filepath.Join(p, "apps-home")
		}
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".apps-home")
}

// Load reads config.json from dataDir. A missing file returns defaults and an
// error satisfying errors.Is(err, fs.ErrNotExist).
func Load(dataDir string) (Config, error) {
	c := Defaults(dataDir)
	b, err := os.ReadFile(filepath.Join(dataDir, FileName))
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("parse %s: %w", filepath.Join(dataDir, FileName), err)
	}
	c.DataDir = dataDir
	d := Defaults(dataDir)
	if c.Domain == "" {
		c.Domain = d.Domain
	}
	if c.HTTPPort == 0 {
		c.HTTPPort = d.HTTPPort
	}
	if c.HTTPSPort == 0 {
		c.HTTPSPort = d.HTTPSPort
	}
	if c.AppListen == "" {
		c.AppListen = d.AppListen
	}
	if c.CaddyAdmin == "" {
		c.CaddyAdmin = d.CaddyAdmin
	}
	if c.Branch == "" {
		c.Branch = d.Branch
	}
	if c.PollSeconds <= 0 {
		c.PollSeconds = d.PollSeconds
	}
	if c.GCPLocation == "" {
		c.GCPLocation = d.GCPLocation
	}
	if c.GeminiModel == "" {
		c.GeminiModel = d.GeminiModel
	}
	return c, c.Validate()
}

func (c Config) Validate() error {
	if !domainRE.MatchString(c.Domain) {
		return fmt.Errorf("domain %q is not a valid lowercase hostname", c.Domain)
	}
	return nil
}

func (c Config) Save() error {
	if err := os.MkdirAll(c.DataDir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(filepath.Join(c.DataDir, FileName), append(b, '\n'), 0o600)
}

func (c Config) Path() string            { return filepath.Join(c.DataDir, FileName) }
func (c Config) LogsDir() string         { return filepath.Join(c.DataDir, "logs") }
func (c Config) BuildLogsDir() string    { return filepath.Join(c.DataDir, "logs", "builds") }
func (c Config) CaddyfilePath() string   { return filepath.Join(c.DataDir, "Caddyfile") }
func (c Config) CaddyStorageDir() string { return filepath.Join(c.DataDir, "caddy") }
func (c Config) LiveDir() string         { return filepath.Join(c.DataDir, "live") }
func (c Config) ReleasesDir() string     { return filepath.Join(c.DataDir, "releases") }
func (c Config) BuildsDir() string       { return filepath.Join(c.DataDir, "builds") }
func (c Config) AppDataDir() string      { return filepath.Join(c.DataDir, "appdata") }
func (c Config) StatePath() string       { return filepath.Join(c.DataDir, "state.json") }
func (c Config) BuilderRepoDir() string  { return filepath.Join(c.DataDir, "builder-repo") }

// GitMode reports whether apps are deployed from a remote repository.
func (c Config) GitMode() bool { return c.RepoURL != "" }

func (c Config) RepoPath() string {
	if c.RepoDir != "" {
		return c.RepoDir
	}
	return filepath.Join(c.DataDir, "repo")
}
func (c Config) RootCertPath() string {
	return filepath.Join(c.CaddyStorageDir(), "pki", "authorities", "local", "root.crt")
}

func (c Config) HTTPSSuffix() string {
	if c.HTTPSPort == 443 {
		return ""
	}
	return ":" + strconv.Itoa(c.HTTPSPort)
}

func (c Config) httpSuffix() string {
	if c.HTTPPort == 80 {
		return ""
	}
	return ":" + strconv.Itoa(c.HTTPPort)
}

func (c Config) AdminHost() string          { return "admin." + c.Domain }
func (c Config) AppHost(name string) string { return name + "." + c.Domain }
func (c Config) PortalURL() string          { return "https://" + c.Domain + c.HTTPSSuffix() }
func (c Config) AdminURL() string           { return "https://" + c.AdminHost() + c.HTTPSSuffix() }
func (c Config) AppURL(name string) string  { return "https://" + c.AppHost(name) + c.HTTPSSuffix() }

// TrustURL is plain HTTP so devices can fetch the root cert before trusting it.
func (c Config) TrustURL() string { return "http://" + c.Domain + c.httpSuffix() + "/trust" }

func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
