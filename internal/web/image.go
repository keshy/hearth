package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"appshome/internal/builder"
	"appshome/internal/registry"
)

// Apps with the image capability have pictures painted by the house's image
// model. Painting costs money, so asking for pictures needs the admin
// password; looking at them doesn't. Jobs run on the server, so a picture
// finishes even if the page that asked for it is closed.
const (
	imageWorkers     = 3
	imagePerDay      = 400
	imageBatch       = 40
	imageMaxPrompt   = 8 << 10
	imageMaxRefs     = 6
	imageTimeout     = 3 * time.Minute
	imageJPEGQuality = 88
)

var (
	imageBackoff = []time.Duration{20 * time.Second, 40 * time.Second, 60 * time.Second, 90 * time.Second}
	imageKeyRE   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)
	imageAspect = map[string]bool{"1:1": true, "2:3": true, "3:2": true, "3:4": true, "4:3": true, "9:16": true, "16:9": true, "21:9": true}
)

type imageJob struct {
	Key    string   `json:"key"`
	Prompt string   `json:"prompt"`
	Refs   []string `json:"refs"`
	Aspect string   `json:"aspect"`
	High   bool     `json:"high"`
}

type imageState struct {
	State   string `json:"state"` // missing, queued, painting, done, error
	Error   string `json:"error,omitempty"`
	Version int64  `json:"version,omitempty"` // changes when the picture does
}

type imageQueue struct {
	once  sync.Once
	slots chan struct{}

	mu   sync.Mutex
	jobs map[string]*imageState // app/key -> latest job
	day  string
	used map[string]int
}

func (q *imageQueue) init() {
	q.once.Do(func() {
		q.slots = make(chan struct{}, imageWorkers)
		q.jobs = map[string]*imageState{}
		q.used = map[string]int{}
	})
}

// take reserves n paintings from app's daily allowance.
func (q *imageQueue) take(app string, n int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if d := time.Now().Format("2006-01-02"); d != q.day {
		q.day, q.used = d, map[string]int{}
	}
	if q.used[app]+n > imagePerDay {
		return false
	}
	q.used[app] += n
	return true
}

func (s *Server) imageDir(app string) string {
	return filepath.Join(s.cfg.AppDataDir(), app, "images")
}

func (s *Server) imagePath(app, key string) string {
	return filepath.Join(s.imageDir(app), key+".jpg")
}

func (s *Server) imageApp(w http.ResponseWriter, r *http.Request) (registry.App, bool) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return a, false
	}
	if !a.Has(registry.CapImage) {
		writeErr(w, http.StatusForbidden, "this app doesn't have the image capability")
		return a, false
	}
	return a, true
}

// isEditor checks the admin password, sent by apps as basic auth (user admin).
func (s *Server) isEditor(r *http.Request) bool {
	user, pass, ok := r.BasicAuth()
	hash := s.passwordHash()
	return ok && user == "admin" && hash != "" && bcrypt.CompareHashAndPassword([]byte(hash), []byte(pass)) == nil
}

// editorCheck lets an app ask whether a password is the admin's, so it can
// show its editing tools. No WWW-Authenticate header: the app asks, not the
// browser.
func (s *Server) editorCheck(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.callingApp(w, r); !ok {
		return
	}
	if !s.isEditor(r) {
		writeErr(w, http.StatusUnauthorized, "that isn't the admin password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"editor": true})
}

func (s *Server) imageStatus(app, key string) imageState {
	s.images.init()
	s.images.mu.Lock()
	j := s.images.jobs[app+"/"+key]
	var st imageState
	if j != nil {
		st = *j
	}
	s.images.mu.Unlock()
	if st.State == "queued" || st.State == "painting" {
		return st
	}
	if fi, err := os.Stat(s.imagePath(app, key)); err == nil {
		return imageState{State: "done", Version: fi.ModTime().UnixMilli()}
	}
	if st.State == "error" {
		return st
	}
	return imageState{State: "missing"}
}

func (s *Server) imageJobs(w http.ResponseWriter, r *http.Request) {
	a, ok := s.imageApp(w, r)
	if !ok {
		return
	}
	out := map[string]imageState{}
	for _, k := range strings.Split(r.URL.Query().Get("keys"), ",") {
		if imageKeyRE.MatchString(k) && len(out) < 300 {
			out[k] = s.imageStatus(a.Name, k)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": out})
}

func (s *Server) imagePaint(w http.ResponseWriter, r *http.Request) {
	a, ok := s.imageApp(w, r)
	if !ok {
		return
	}
	if !s.isEditor(r) {
		writeErr(w, http.StatusUnauthorized, "painting pictures needs the admin password")
		return
	}
	if s.builder == nil {
		writeErr(w, http.StatusServiceUnavailable, "no image model is configured on this host")
		return
	}
	var req struct {
		Jobs []imageJob `json:"jobs"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, imageBatch*(imageMaxPrompt+2048))).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "send JSON: {jobs: [{key, prompt, refs, aspect, high}]}")
		return
	}
	if len(req.Jobs) == 0 || len(req.Jobs) > imageBatch {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("send 1 to %d jobs", imageBatch))
		return
	}
	for _, j := range req.Jobs {
		if err := s.checkImageJob(a.Name, j); err != nil {
			writeErr(w, http.StatusBadRequest, j.Key+": "+err.Error())
			return
		}
	}
	s.images.init()
	if !s.images.take(a.Name, len(req.Jobs)) {
		writeErr(w, http.StatusTooManyRequests, fmt.Sprintf("this app has painted its %d pictures for today", imagePerDay))
		return
	}
	out := map[string]imageState{}
	for _, j := range req.Jobs {
		id := a.Name + "/" + j.Key
		s.images.mu.Lock()
		if cur := s.images.jobs[id]; cur != nil && (cur.State == "queued" || cur.State == "painting") {
			out[j.Key] = *cur
			s.images.mu.Unlock()
			continue
		}
		st := &imageState{State: "queued"}
		s.images.jobs[id] = st
		out[j.Key] = *st
		s.images.mu.Unlock()
		go s.paint(a.Name, j, st)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"images": out})
}

func (s *Server) checkImageJob(app string, j imageJob) error {
	switch {
	case !imageKeyRE.MatchString(j.Key):
		return errors.New("keys are lowercase letters, digits and dashes")
	case strings.TrimSpace(j.Prompt) == "":
		return errors.New("prompt is empty")
	case len(j.Prompt) > imageMaxPrompt:
		return errors.New("prompt is limited to 8 KB")
	case j.Aspect != "" && !imageAspect[j.Aspect]:
		return errors.New("aspect is one of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9")
	case len(j.Refs) > imageMaxRefs:
		return fmt.Errorf("at most %d reference pictures", imageMaxRefs)
	}
	for _, ref := range j.Refs {
		if !imageKeyRE.MatchString(ref) {
			return fmt.Errorf("bad reference %q", ref)
		}
		if _, err := os.Stat(s.imagePath(app, ref)); err != nil {
			return fmt.Errorf("reference %q hasn't been painted yet", ref)
		}
	}
	return nil
}

func (s *Server) paint(app string, j imageJob, st *imageState) {
	set := func(state, msg string) {
		s.images.mu.Lock()
		st.State, st.Error = state, msg
		s.images.mu.Unlock()
	}
	select {
	case s.images.slots <- struct{}{}:
	case <-s.ctx.Done():
		set("error", "the server is shutting down")
		return
	}
	defer func() { <-s.images.slots }()
	set("painting", "")

	var refs []builder.Image
	for _, k := range j.Refs {
		b, err := os.ReadFile(s.imagePath(app, k))
		if err != nil {
			set("error", "reference "+k+" is gone")
			return
		}
		refs = append(refs, builder.Image{Data: b, MIME: "image/jpeg"})
	}
	aspect := j.Aspect
	if aspect == "" {
		aspect = "16:9"
	}
	var (
		img builder.Image
		err error
	)
	// Image models fail now and then (a picture blocked by a filter that a
	// second try gets past). Rate limits are per minute, so those wait and
	// retry; a high-quality picture that stays limited drops to the regular
	// model rather than failing.
	high, failures, limited := j.High, 0, 0
	for failures < 2 {
		ctx, cancel := context.WithTimeout(s.ctx, imageTimeout)
		img, err = s.builder.Paint(ctx, high, j.Prompt, refs, aspect)
		cancel()
		if err == nil {
			break
		}
		if !rateLimited(err) {
			failures++
			continue
		}
		if limited == len(imageBackoff) {
			if !high {
				break
			}
			high, limited = false, 0
			continue
		}
		select {
		case <-time.After(imageBackoff[limited]):
		case <-s.ctx.Done():
			set("error", "the server is shutting down")
			return
		}
		limited++
	}
	if err != nil {
		s.log.Printf("image %s/%s: %v", app, j.Key, err)
		set("error", err.Error())
		return
	}
	data, err := toJPEG(img.Data)
	if err == nil {
		err = os.MkdirAll(s.imageDir(app), 0o755)
	}
	if err == nil {
		tmp := s.imagePath(app, j.Key) + ".tmp"
		if err = os.WriteFile(tmp, data, 0o644); err == nil {
			err = os.Rename(tmp, s.imagePath(app, j.Key))
		}
	}
	if err != nil {
		set("error", err.Error())
		return
	}
	set("done", "")
}

func rateLimited(err error) bool {
	m := err.Error()
	return strings.Contains(m, "429") || strings.Contains(m, "RESOURCE_EXHAUSTED")
}

func toJPEG(b []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("the model sent a picture we can't read: %w", err)
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: imageJPEGQuality}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (s *Server) imageFile(w http.ResponseWriter, r *http.Request) {
	a, ok := s.imageApp(w, r)
	if !ok {
		return
	}
	key := strings.TrimSuffix(r.PathValue("key"), ".jpg")
	if !imageKeyRE.MatchString(key) {
		http.NotFound(w, r)
		return
	}
	// Pages ask for ?v=<version>, so a URL always means the same picture.
	if r.URL.Query().Get("v") != "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, s.imagePath(a.Name, key))
}

func (s *Server) imageDelete(w http.ResponseWriter, r *http.Request) {
	a, ok := s.imageApp(w, r)
	if !ok {
		return
	}
	if !s.isEditor(r) {
		writeErr(w, http.StatusUnauthorized, "deleting pictures needs the admin password")
		return
	}
	key := r.PathValue("key")
	if !imageKeyRE.MatchString(key) {
		writeErr(w, http.StatusBadRequest, "bad key")
		return
	}
	if err := os.Remove(s.imagePath(a.Name, key)); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
