package web

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"

	"appshome/internal/connect"
	"appshome/internal/registry"
)

// SetConnect turns on /_api/connect, which plays songs on speakers and TVs.
func (s *Server) SetConnect(h *connect.Hub) { s.connect = h }

func (s *Server) connectApp(w http.ResponseWriter, r *http.Request) bool {
	a, ok := s.callingApp(w, r)
	if !ok {
		return false
	}
	if !a.Has(registry.CapConnect) {
		writeErr(w, http.StatusForbidden, "this app doesn't have the connect capability")
		return false
	}
	if s.connect == nil {
		writeErr(w, http.StatusServiceUnavailable, "playing on speakers isn't available on this host")
		return false
	}
	return true
}

var videoIDRE = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

var audioHeaders = []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"}

// connectAudio relays a song's audio to the browser, so the page can play
// it in a plain <audio> element. Phones keep those going with the screen
// locked or another app open (over Bluetooth too), which they don't do for
// embedded YouTube videos. Range requests pass through, so seeking works.
func (s *Server) connectAudio(w http.ResponseWriter, r *http.Request) {
	if !s.connectApp(w, r) {
		return
	}
	id := r.PathValue("video")
	if !videoIDRE.MatchString(id) {
		writeErr(w, http.StatusBadRequest, "not a YouTube video id")
		return
	}
	for try := 0; try < 2; try++ {
		u, ct, err := s.connect.Tools.Resolve(r.Context(), id)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		if rg := r.Header.Get("Range"); rg != "" {
			req.Header.Set("Range", rg)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		// An expired or refused link: look the song up again once.
		if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusGone || res.StatusCode == http.StatusNotFound {
			res.Body.Close()
			s.connect.Tools.Forget(id)
			continue
		}
		defer res.Body.Close()
		for _, h := range audioHeaders {
			if v := res.Header.Get(h); v != "" {
				w.Header().Set(h, v)
			}
		}
		if res.StatusCode < 300 {
			w.Header().Set("Content-Type", ct)
		}
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.WriteHeader(res.StatusCode)
		io.Copy(w, res.Body)
		return
	}
	writeErr(w, http.StatusBadGateway, "YouTube wouldn't hand over this song")
}

// connectDevices lists speakers and TVs; ?fresh=1 looks around again.
func (s *Server) connectDevices(w http.ResponseWriter, r *http.Request) {
	if !s.connectApp(w, r) {
		return
	}
	ready, problem := s.connect.Tools.Status()
	writeJSON(w, http.StatusOK, map[string]any{
		"devices": s.connect.Devices(r.Context(), r.URL.Query().Get("fresh") != ""),
		"ready":   ready,
		"problem": problem,
	})
}

func (s *Server) connectStatus(w http.ResponseWriter, r *http.Request) {
	if !s.connectApp(w, r) {
		return
	}
	st, _ := s.connect.Status(r.PathValue("id"))
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) connectAction(w http.ResponseWriter, r *http.Request) {
	if !s.connectApp(w, r) {
		return
	}
	id, action := r.PathValue("id"), r.PathValue("action")
	var body struct {
		Queue []connect.Song `json:"queue"`
		Index int            `json:"index"`
		Level *float64       `json:"level"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(io.LimitReader(r.Body, 128<<10)).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeErr(w, http.StatusBadRequest, "send JSON")
			return
		}
	}
	var (
		st  connect.Status
		err error
	)
	switch action {
	case "play":
		st, err = s.connect.Play(r.Context(), id, body.Queue, body.Index)
	case "volume":
		if body.Level == nil {
			writeErr(w, http.StatusBadRequest, "send JSON: {level: 0..1}")
			return
		}
		st, err = s.connect.Volume(r.Context(), id, *body.Level)
	case "pause", "resume", "next", "prev", "stop":
		st, err = s.connect.Control(r.Context(), id, action)
	default:
		writeErr(w, http.StatusNotFound, "unknown action")
		return
	}
	switch {
	case errors.Is(err, connect.ErrNoDevice), errors.Is(err, connect.ErrIdle):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, connect.ErrBadQueue):
		writeErr(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeErr(w, http.StatusBadGateway, err.Error())
	default:
		writeJSON(w, http.StatusOK, st)
	}
}
