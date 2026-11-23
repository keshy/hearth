package web

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"appshome/internal/caddy"
	"appshome/internal/config"
)

// Feedback is a note someone sent from an app (or the home page) through the
// house Feedback button. It lives in <data>/feedback, never in the repo.
const (
	nameCookie          = "hearth_name"
	homeApp             = "home"
	maxFeedback         = 500
	maxFeedbackBody     = 3 << 20
	maxFeedbackImage    = 2 << 20
	feedbackWindow      = time.Minute
	feedbackPerWindow   = 8
	maxFeedbackMessage  = 2000
	maxRememberedNames  = 12
	feedbackListFile    = "feedback.json"
	feedbackImageSubdir = "images"
)

var imageExt = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

type Feedback struct {
	ID       string    `json:"id"`
	App      string    `json:"app"`
	AppTitle string    `json:"appTitle"`
	Name     string    `json:"name,omitempty"`
	Message  string    `json:"message"`
	Page     string    `json:"page,omitempty"`
	Theme    string    `json:"theme,omitempty"`
	Viewport string    `json:"viewport,omitempty"`
	Agent    string    `json:"agent,omitempty"`
	Image    string    `json:"image,omitempty"`
	At       time.Time `json:"at"`
	Seen     bool      `json:"seen,omitempty"`
	Done     bool      `json:"done,omitempty"`
}

type feedbackStore struct {
	mu     sync.Mutex
	dir    string
	recent []time.Time
}

func (f *feedbackStore) load() []Feedback {
	var list []Feedback
	if b, err := os.ReadFile(filepath.Join(f.dir, feedbackListFile)); err == nil {
		json.Unmarshal(b, &list)
	}
	return list
}

func (f *feedbackStore) save(list []Feedback) error {
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(f.dir, 0o700); err != nil {
		return err
	}
	return config.WriteFileAtomic(filepath.Join(f.dir, feedbackListFile), b, 0o600)
}

func (f *feedbackStore) imagePath(name string) string {
	return filepath.Join(f.dir, feedbackImageSubdir, filepath.Base(name))
}

// allow is a house-wide rate limit; feedback comes from people, not loops.
func (f *feedbackStore) allow(now time.Time) bool {
	keep := f.recent[:0]
	for _, t := range f.recent {
		if now.Sub(t) < feedbackWindow {
			keep = append(keep, t)
		}
	}
	f.recent = keep
	if len(keep) >= feedbackPerWindow {
		return false
	}
	f.recent = append(f.recent, now)
	return true
}

func (f *feedbackStore) add(fb Feedback, img []byte, ext string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.allow(fb.At) {
		return errTooMany
	}
	if img != nil {
		if err := os.MkdirAll(filepath.Join(f.dir, feedbackImageSubdir), 0o700); err != nil {
			return err
		}
		fb.Image = fb.ID + ext
		if err := config.WriteFileAtomic(f.imagePath(fb.Image), img, 0o600); err != nil {
			return err
		}
	}
	list := append(f.load(), fb)
	if len(list) > maxFeedback {
		for _, old := range list[:len(list)-maxFeedback] {
			if old.Image != "" {
				os.Remove(f.imagePath(old.Image))
			}
		}
		list = list[len(list)-maxFeedback:]
	}
	return f.save(list)
}

// update changes one item; change returns false to delete it.
func (f *feedbackStore) update(id string, change func(*Feedback) bool) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	list := f.load()
	for i := range list {
		if list[i].ID != id {
			continue
		}
		if !change(&list[i]) {
			if list[i].Image != "" {
				os.Remove(f.imagePath(list[i].Image))
			}
			list = append(list[:i], list[i+1:]...)
		}
		return f.save(list) == nil
	}
	return false
}

// newest returns every item, newest first, and marks them all seen.
func (f *feedbackStore) newest(markSeen bool) []Feedback {
	f.mu.Lock()
	defer f.mu.Unlock()
	list := f.load()
	out := make([]Feedback, len(list))
	for i := range list {
		out[len(list)-1-i] = list[i]
	}
	if markSeen {
		changed := false
		for i := range list {
			if !list[i].Seen {
				list[i].Seen, changed = true, true
			}
		}
		if changed {
			f.save(list)
		}
	}
	return out
}

func (f *feedbackStore) unread() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, fb := range f.load() {
		if !fb.Seen {
			n++
		}
	}
	return n
}

// names are the names people have signed with, most recent first.
func (f *feedbackStore) names() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	list := f.load()
	seen := map[string]bool{}
	out := []string{}
	for i := len(list) - 1; i >= 0 && len(out) < maxRememberedNames; i-- {
		n := list[i].Name
		if n != "" && !seen[strings.ToLower(n)] {
			seen[strings.ToLower(n)] = true
			out = append(out, n)
		}
	}
	return out
}

var errTooMany = errors.New("too much feedback at once; try again in a minute")

// feedbackSource says which app a request comes from: the app Caddy named,
// or the home page. It also rejects cross-site posts.
func (s *Server) feedbackSource(w http.ResponseWriter, r *http.Request) (name, title string, ok bool) {
	if sfs := r.Header.Get("Sec-Fetch-Site"); sfs != "" && sfs != "same-origin" {
		writeErr(w, http.StatusForbidden, "cross-site request blocked")
		return "", "", false
	}
	if o := r.Header.Get("Origin"); o != "" {
		if u, err := url.Parse(o); err != nil || hostOnly(u.Host) != hostOnly(r.Host) {
			writeErr(w, http.StatusForbidden, "cross-origin request blocked")
			return "", "", false
		}
	}
	if app := r.Header.Get(caddy.AppHeader); app != "" {
		a, ok := s.callingApp(w, r)
		if !ok {
			return "", "", false
		}
		return a.Name, a.Title, true
	}
	if hostOnly(r.Host) == s.cfg.Domain {
		return homeApp, "Home page", true
	}
	writeErr(w, http.StatusNotFound, "feedback is sent from an app or the home page")
	return "", "", false
}

func (s *Server) feedbackSend(w http.ResponseWriter, r *http.Request) {
	app, title, ok := s.feedbackSource(w, r)
	if !ok {
		return
	}
	var body struct {
		Message  string `json:"message"`
		Name     string `json:"name"`
		Page     string `json:"page"`
		Theme    string `json:"theme"`
		Viewport string `json:"viewport"`
		Image    string `json:"image"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxFeedbackBody)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "send {message, name, page, theme, viewport, image}")
		return
	}
	msg := clip(body.Message, maxFeedbackMessage)
	if msg == "" {
		writeErr(w, http.StatusBadRequest, "write a few words first")
		return
	}
	var img []byte
	var ext string
	if body.Image != "" {
		var err error
		img, ext, err = decodeImage(body.Image)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	page := clip(body.Page, 500)
	if u, err := url.Parse(page); err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		page = ""
	}
	fb := Feedback{
		ID: newFeedbackID(), App: app, AppTitle: title, Message: msg,
		Name: clip(body.Name, 40), Page: page, Theme: clip(body.Theme, 10),
		Viewport: clip(body.Viewport, 20), Agent: clip(r.UserAgent(), 200), At: time.Now().UTC(),
	}
	if err := s.feedback().add(fb, img, ext); errors.Is(err, errTooMany) {
		writeErr(w, http.StatusTooManyRequests, err.Error())
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if fb.Name != "" {
		http.SetCookie(w, &http.Cookie{Name: nameCookie, Value: url.QueryEscape(fb.Name), Domain: s.cfg.Domain, Path: "/",
			MaxAge: 5 * 365 * 24 * 3600, SameSite: http.SameSiteLaxMode, HttpOnly: true})
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": fb.ID})
}

// feedbackMe tells the form who's on this device and which names the
// family has used, so signing is one tap.
func (s *Server) feedbackMe(w http.ResponseWriter, r *http.Request) {
	_, title, ok := s.feedbackSource(w, r)
	if !ok {
		return
	}
	name := ""
	if c, err := r.Cookie(nameCookie); err == nil {
		if v, err := url.QueryUnescape(c.Value); err == nil {
			name = clip(v, 40)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"app": title, "name": name, "names": s.feedback().names()})
}

func decodeImage(dataURL string) ([]byte, string, error) {
	_, b64, found := strings.Cut(dataURL, ";base64,")
	if !strings.HasPrefix(dataURL, "data:image/") || !found {
		return nil, "", errors.New("the picture must be a data: URL")
	}
	img, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, "", errors.New("the picture didn't decode")
	}
	if len(img) > maxFeedbackImage {
		return nil, "", errors.New("the picture is over 2 MB")
	}
	ext, ok := imageExt[http.DetectContentType(img)]
	if !ok {
		return nil, "", errors.New("pictures can be JPEG, PNG or WebP")
	}
	return img, ext, nil
}

func newFeedbackID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return time.Now().UTC().Format("20060102") + "-" + hex.EncodeToString(b)
}

func (s *Server) feedback() *feedbackStore {
	s.fbOnce.Do(func() { s.fb = &feedbackStore{dir: filepath.Join(s.cfg.DataDir, "feedback")} })
	return s.fb
}

// ---------- admin inbox ----------

type feedbackGroup struct {
	Title string
	Items []Feedback
}

func (s *Server) feedbackInbox(w http.ResponseWriter, r *http.Request) {
	items := s.feedback().newest(true)
	var open, done []Feedback
	for _, fb := range items {
		if fb.Done {
			done = append(done, fb)
		} else {
			open = append(open, fb)
		}
	}
	count := map[string]int{}
	for _, fb := range open {
		count[fb.AppTitle]++
	}
	apps := make([]string, 0, len(count))
	for a := range count {
		apps = append(apps, a)
	}
	sort.Strings(apps)
	s.render(w, http.StatusOK, "feedback.html", map[string]any{
		"PageTitle":  "Feedback · " + s.cfg.Domain,
		"NoFeedback": true,
		"Open":       open,
		"Done":       done,
		"Apps":       apps,
		"Count":      count,
	})
}

func (s *Server) feedbackImage(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("file"))
	for _, fb := range s.feedback().newest(false) {
		if fb.Image == name {
			b, err := os.ReadFile(s.feedback().imagePath(name))
			if err != nil {
				break
			}
			w.Header().Set("Content-Type", http.DetectContentType(b))
			w.Header().Set("Cache-Control", "private, max-age=86400")
			w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
			io.Copy(w, bytes.NewReader(b))
			return
		}
	}
	http.NotFound(w, r)
}

func (s *Server) feedbackChange(w http.ResponseWriter, r *http.Request) {
	id, action := r.PathValue("id"), r.PathValue("action")
	ok := (action == "done" || action == "delete") && s.feedback().update(id, func(fb *Feedback) bool {
		fb.Done = !fb.Done
		return action == "done"
	})
	if !ok {
		http.Error(w, "no such feedback", http.StatusNotFound)
		return
	}
	http.Redirect(w, r, "/feedback", http.StatusSeeOther)
}
