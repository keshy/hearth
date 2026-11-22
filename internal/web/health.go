package web

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"appshome/internal/registry"
)

type Status struct {
	State   string    `json:"state"` // up, down, unknown
	Detail  string    `json:"detail,omitempty"`
	Checked time.Time `json:"checked"`
}

type Health struct {
	apps    func() []registry.App
	liveDir func(string) string
	client  *http.Client
	mu      sync.RWMutex
	state   map[string]Status
}

func NewHealth(apps func() []registry.App, liveDir func(string) string) *Health {
	return &Health{
		apps:    apps,
		liveDir: liveDir,
		state:   map[string]Status{},
		client: &http.Client{
			Timeout: 4 * time.Second,
			// Home services often use self-signed certs; reachability is all we report.
			Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (h *Health) Run(ctx context.Context, every time.Duration) {
	h.CheckAll()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.CheckAll()
		}
	}
}

func (h *Health) CheckAll() {
	apps := h.apps()
	seen := map[string]bool{}
	var wg sync.WaitGroup
	for _, a := range apps {
		seen[a.Name] = true
		wg.Add(1)
		go func(a registry.App) {
			defer wg.Done()
			st := h.probe(a)
			st.Checked = time.Now()
			h.mu.Lock()
			h.state[a.Name] = st
			h.mu.Unlock()
		}(a)
	}
	wg.Wait()
	h.mu.Lock()
	for name := range h.state {
		if !seen[name] {
			delete(h.state, name)
		}
	}
	h.mu.Unlock()
}

func (h *Health) probe(a registry.App) Status {
	switch a.Kind {
	case registry.KindStatic:
		if _, err := os.Stat(filepath.Join(h.liveDir(a.Name), "index.html")); err != nil {
			return Status{State: "down", Detail: "no live release"}
		}
		return Status{State: "up"}
	case registry.KindProxied, registry.KindHybrid:
		p := a.HealthPath
		if p == "" {
			p = "/"
		}
		return h.get(a.Upstream + p)
	case registry.KindLink:
		if strings.HasPrefix(a.URL, "http://") || strings.HasPrefix(a.URL, "https://") {
			return h.get(a.URL)
		}
	}
	return Status{State: "unknown"}
}

func (h *Health) get(url string) Status {
	resp, err := h.client.Get(url)
	if err != nil {
		return Status{State: "down", Detail: shortErr(err)}
	}
	resp.Body.Close()
	if resp.StatusCode >= 500 {
		return Status{State: "down", Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	return Status{State: "up", Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)}
}

func shortErr(err error) string {
	s := err.Error()
	if i := strings.LastIndex(s, ": "); i >= 0 {
		s = s[i+2:]
	}
	return s
}

func (h *Health) Get(name string) Status {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if st, ok := h.state[name]; ok {
		return st
	}
	return Status{State: "unknown"}
}

func (h *Health) Snapshot() map[string]Status {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make(map[string]Status, len(h.state))
	for k, v := range h.state {
		out[k] = v
	}
	return out
}
