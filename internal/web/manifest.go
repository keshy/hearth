package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"

	"appshome/internal/caddy"
)

// PNG sizes the web app manifest offers. Android installs need 192 and 512;
// 180 is the apple-touch-icon size for iOS home screens.
var iconSizes = map[string]int{"180.png": 180, "192.png": 192, "512.png": 512}

type manifestIconEntry struct {
	Src     string `json:"src"`
	Sizes   string `json:"sizes,omitempty"`
	Type    string `json:"type,omitempty"`
	Purpose string `json:"purpose,omitempty"`
}

type webAppManifest struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	ShortName   string              `json:"short_name"`
	Description string              `json:"description,omitempty"`
	StartURL    string              `json:"start_url"`
	Scope       string              `json:"scope"`
	Display     string              `json:"display"`
	Icons       []manifestIconEntry `json:"icons"`
}

// webManifest makes every app (and the portal) installable as a home-screen
// app. hearth.js links it, so apps don't have to.
func (s *Server) webManifest(w http.ResponseWriter, r *http.Request) {
	m := webAppManifest{ID: "/", StartURL: "/", Scope: "/", Display: "standalone"}
	switch {
	case r.Header.Get(caddy.AppHeader) != "":
		a, ok := s.callingApp(w, r)
		if !ok {
			return
		}
		m.Name, m.ShortName, m.Description = a.Title, a.Title, a.Description
		if p, ok := s.iconFile(a); ok && strings.HasSuffix(strings.ToLower(p), ".svg") {
			m.Icons = append(pngIcons(), manifestIconEntry{Src: a.Icon, Sizes: "any", Type: "image/svg+xml"})
		} else if a.Icon != "" {
			m.Icons = []manifestIconEntry{{Src: a.Icon}}
		}
	case hostOnly(r.Host) == s.cfg.Domain:
		m.Name, m.ShortName = "Hearth", "Hearth"
		m.Description = "Every app in the house."
		m.Icons = append(pngIcons(), manifestIconEntry{Src: "/static/icon.svg", Sizes: "any", Type: "image/svg+xml"})
	default:
		http.NotFound(w, r)
		return
	}
	if m.Icons == nil {
		m.Icons = []manifestIconEntry{}
	}
	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(m)
}

// The rasterizer ignores rounded corners, so the PNGs are full-bleed squares:
// exactly what Android's maskable icons and iOS's own corner mask expect.
func pngIcons() []manifestIconEntry {
	var out []manifestIconEntry
	for _, purpose := range []string{"any", "maskable"} {
		out = append(out,
			manifestIconEntry{Src: "/_hearth/icons/192.png", Sizes: "192x192", Type: "image/png", Purpose: purpose},
			manifestIconEntry{Src: "/_hearth/icons/512.png", Sizes: "512x512", Type: "image/png", Purpose: purpose},
		)
	}
	return out
}

// manifestIcon renders the app's SVG icon (or the portal's) as a PNG, since
// Android's installer and iOS home screens want bitmaps.
func (s *Server) manifestIcon(w http.ResponseWriter, r *http.Request) {
	size, ok := iconSizes[r.PathValue("file")]
	if !ok {
		http.NotFound(w, r)
		return
	}
	var svg []byte
	var key string
	switch {
	case r.Header.Get(caddy.AppHeader) != "":
		a, ok := s.callingApp(w, r)
		if !ok {
			return
		}
		p, ok := s.iconFile(a)
		if !ok || !strings.HasSuffix(strings.ToLower(p), ".svg") {
			http.NotFound(w, r)
			return
		}
		fi, err := os.Stat(p)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		key = fmt.Sprintf("%s|%s|%d|%d", a.Name, p, fi.ModTime().UnixNano(), size)
		if b, ok := s.pngs.get(key); ok {
			writePNG(w, b)
			return
		}
		if svg, err = os.ReadFile(p); err != nil {
			http.NotFound(w, r)
			return
		}
	case hostOnly(r.Host) == s.cfg.Domain:
		key = fmt.Sprintf("portal|%d", size)
		if b, ok := s.pngs.get(key); ok {
			writePNG(w, b)
			return
		}
		svg, _ = assets.ReadFile("static/icon.svg")
	default:
		http.NotFound(w, r)
		return
	}
	b, err := rasterize(svg, size)
	if err != nil {
		s.log.Printf("icon %s: %v", key, err)
		http.NotFound(w, r)
		return
	}
	s.pngs.put(key, b)
	writePNG(w, b)
}

func rasterize(svg []byte, size int) ([]byte, error) {
	icon, err := oksvg.ReadIconStream(bytes.NewReader(svg), oksvg.IgnoreErrorMode)
	if err != nil {
		return nil, err
	}
	icon.SetTarget(0, 0, float64(size), float64(size))
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	scanner := rasterx.NewScannerGV(size, size, img, img.Bounds())
	icon.Draw(rasterx.NewDasher(size, size, scanner), 1)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writePNG(w http.ResponseWriter, b []byte) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Write(b)
}

// pngCache keeps rendered icons; keys include the SVG's mtime, so a deploy
// with a new icon renders afresh.
type pngCache struct {
	mu sync.Mutex
	m  map[string][]byte
	at time.Time
}

func (c *pngCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b, ok := c.m[key]
	return b, ok
}

func (c *pngCache) put(key string, b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil || len(c.m) > 200 || time.Since(c.at) > 24*time.Hour {
		c.m, c.at = map[string][]byte{}, time.Now()
	}
	c.m[key] = b
}
