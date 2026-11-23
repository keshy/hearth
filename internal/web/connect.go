package web

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

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
