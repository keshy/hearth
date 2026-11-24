package web

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"appshome/internal/config"
	"appshome/internal/registry"
)

// Apps with the rooms capability host shared game rooms: anyone on the house
// network can open one, others join from their own device, and every move
// reaches everyone at once through long polling. The server keeps the state
// and orders the writes (each write names the version it builds on); the
// game rules live in the app.
//
// A player is a random token the browser keeps. Each player can also hold a
// private value (a hidden fleet, a spymaster's key) that only they, and the
// host for the room's bots, can read.
const (
	roomsPerApp     = 40
	roomMaxPlayers  = 8
	roomMaxState    = 128 << 10
	roomMaxPrivate  = 32 << 10
	roomIdle        = 72 * time.Hour
	roomOnline      = 40 * time.Second
	roomCodeLetters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
)

// roomWait is how long a poll waits for a change before answering anyway.
var roomWait = 25 * time.Second

type roomPlayer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Bot  bool   `json:"bot,omitempty"`
}

type room struct {
	ID      string                     `json:"id"`
	Game    string                     `json:"game"`
	Title   string                     `json:"title"`
	Status  string                     `json:"status"`
	Max     int                        `json:"max"`
	Host    string                     `json:"host"`
	Players []roomPlayer               `json:"players"`
	State   json.RawMessage            `json:"state"`
	Private map[string]json.RawMessage `json:"private"`
	Tokens  map[string]string          `json:"tokens"` // sha256(token) -> player id
	Version int64                      `json:"version"`
	Created time.Time                  `json:"created"`
	Updated time.Time                  `json:"updated"`
	NextID  int                        `json:"nextId"`

	seen map[string]time.Time
	wake chan struct{}
}

type roomStore struct {
	mu   sync.Mutex
	apps map[string]map[string]*room
}

func (s *Server) roomDir(app string) string {
	return filepath.Join(s.cfg.AppDataDir(), app, "rooms")
}

// roomsFor returns the app's rooms, loading them from disk the first time.
// Callers hold s.rooms.mu.
func (s *Server) roomsFor(app string) map[string]*room {
	if s.rooms.apps == nil {
		s.rooms.apps = map[string]map[string]*room{}
	}
	if m, ok := s.rooms.apps[app]; ok {
		return m
	}
	m := map[string]*room{}
	entries, _ := os.ReadDir(s.roomDir(app))
	for _, e := range entries {
		b, err := os.ReadFile(filepath.Join(s.roomDir(app), e.Name()))
		if err != nil {
			continue
		}
		var r room
		if json.Unmarshal(b, &r) == nil && r.ID != "" {
			r.seen = map[string]time.Time{}
			r.wake = make(chan struct{})
			m[r.ID] = &r
		}
	}
	s.rooms.apps[app] = m
	return m
}

// changed bumps the version, saves the room and wakes everyone waiting on it.
// Callers hold s.rooms.mu.
func (s *Server) changed(app string, r *room) error {
	r.Version++
	r.Updated = time.Now()
	close(r.wake)
	r.wake = make(chan struct{})
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.roomDir(app), 0o755); err != nil {
		return err
	}
	return config.WriteFileAtomic(filepath.Join(s.roomDir(app), r.ID+".json"), b, 0o644)
}

func (s *Server) dropRoom(app string, rooms map[string]*room, id string) {
	if r := rooms[id]; r != nil {
		close(r.wake)
		r.wake = make(chan struct{})
	}
	delete(rooms, id)
	os.Remove(filepath.Join(s.roomDir(app), id+".json"))
}

func (s *Server) roomsApp(w http.ResponseWriter, r *http.Request) (registry.App, bool) {
	a, ok := s.callingApp(w, r)
	if !ok {
		return a, false
	}
	if !a.Has(registry.CapRooms) {
		writeErr(w, http.StatusForbidden, "this app doesn't have the rooms capability")
		return a, false
	}
	return a, true
}

// playerToken reads the browser's player token; its hash is what's stored.
func playerToken(r *http.Request) string {
	t := r.Header.Get("X-Player")
	if len(t) < 16 || len(t) > 128 {
		return ""
	}
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

func cleanName(n string) string {
	n = strings.Join(strings.Fields(n), " ")
	for utf8.RuneCountInString(n) > 24 {
		_, size := utf8.DecodeLastRuneInString(n)
		n = n[:len(n)-size]
	}
	return n
}

func readBody(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return false
	}
	if int64(len(b)) > limit {
		writeErr(w, http.StatusRequestEntityTooLarge, "that's too big for a room")
		return false
	}
	if err := json.Unmarshal(b, v); err != nil {
		writeErr(w, http.StatusBadRequest, "body must be JSON: "+err.Error())
		return false
	}
	return true
}

type roomPlayerView struct {
	roomPlayer
	Online bool `json:"online"`
}

func (rm *room) players() []roomPlayerView {
	out := make([]roomPlayerView, 0, len(rm.Players))
	for _, p := range rm.Players {
		out = append(out, roomPlayerView{p, p.Bot || time.Since(rm.seen[p.ID]) < roomOnline})
	}
	return out
}

func (rm *room) summary() map[string]any {
	return map[string]any{
		"id": rm.ID, "game": rm.Game, "title": rm.Title, "status": rm.Status,
		"max": rm.Max, "host": rm.Host, "players": rm.players(),
		"version": rm.Version, "updated": rm.Updated,
	}
}

// view is the room as one player sees it: everything but other players'
// private values (the host also sees the bots', since its device plays them).
func (rm *room) view(me string) map[string]any {
	v := rm.summary()
	v["state"] = rm.State
	priv := map[string]json.RawMessage{}
	for _, p := range rm.Players {
		if p.ID == me || (p.Bot && me != "" && me == rm.Host) {
			if b, ok := rm.Private[p.ID]; ok {
				priv[p.ID] = b
			}
		}
	}
	v["me"] = me
	v["private"] = priv
	return v
}

func (s *Server) roomList(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	s.rooms.mu.Lock()
	defer s.rooms.mu.Unlock()
	rooms := s.roomsFor(a.Name)
	list := []*room{}
	for id, rm := range rooms {
		if time.Since(rm.Updated) > roomIdle {
			s.dropRoom(a.Name, rooms, id)
			continue
		}
		list = append(list, rm)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Updated.After(list[j].Updated) })
	out := make([]map[string]any, 0, len(list))
	for _, rm := range list {
		out = append(out, rm.summary())
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": out})
}

func newRoomCode(rooms map[string]*room) string {
	for {
		b := make([]byte, 4)
		rand.Read(b)
		code := make([]byte, 4)
		for i := range b {
			code[i] = roomCodeLetters[int(b[i])%len(roomCodeLetters)]
		}
		if rooms[string(code)] == nil {
			return string(code)
		}
	}
}

func (s *Server) roomCreate(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	tok := playerToken(r)
	if tok == "" {
		writeErr(w, http.StatusBadRequest, "send an X-Player token (16-128 characters)")
		return
	}
	var req struct {
		Game  string          `json:"game"`
		Title string          `json:"title"`
		Max   int             `json:"max"`
		Name  string          `json:"name"`
		State json.RawMessage `json:"state"`
	}
	if !readBody(w, r, roomMaxState, &req) {
		return
	}
	req.Name = cleanName(req.Name)
	if req.Game == "" || len(req.Game) > 32 || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "send {game, name} (and optionally title, max, state)")
		return
	}
	if req.Max < 1 || req.Max > roomMaxPlayers {
		req.Max = roomMaxPlayers
	}
	if len(req.State) == 0 {
		req.State = json.RawMessage("null")
	}
	s.rooms.mu.Lock()
	defer s.rooms.mu.Unlock()
	rooms := s.roomsFor(a.Name)
	if len(rooms) >= roomsPerApp {
		writeErr(w, http.StatusInsufficientStorage, "there are too many rooms open; close an old one first")
		return
	}
	now := time.Now()
	rm := &room{
		ID: newRoomCode(rooms), Game: req.Game, Title: cleanName(req.Title), Status: "waiting", Max: req.Max,
		Host: "p1", Players: []roomPlayer{{ID: "p1", Name: req.Name}}, State: req.State,
		Private: map[string]json.RawMessage{}, Tokens: map[string]string{tok: "p1"},
		Created: now, NextID: 2, seen: map[string]time.Time{"p1": now}, wake: make(chan struct{}),
	}
	rooms[rm.ID] = rm
	if err := s.changed(a.Name, rm); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rm.view("p1"))
}

// findRoom looks the room up and works out which player is asking. Callers
// hold s.rooms.mu.
func (s *Server) findRoom(w http.ResponseWriter, r *http.Request, app string) (map[string]*room, *room, string, bool) {
	rooms := s.roomsFor(app)
	rm := rooms[strings.ToUpper(r.PathValue("id"))]
	if rm == nil {
		writeErr(w, http.StatusNotFound, "that room is gone")
		return rooms, nil, "", false
	}
	me := rm.Tokens[playerToken(r)]
	if me != "" {
		rm.seen[me] = time.Now()
	}
	return rooms, rm, me, true
}

func (s *Server) roomGet(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	s.rooms.mu.Lock()
	_, rm, me, ok := s.findRoom(w, r, a.Name)
	if !ok {
		s.rooms.mu.Unlock()
		return
	}
	if since > 0 && since >= rm.Version {
		wake := rm.wake
		s.rooms.mu.Unlock()
		t := time.NewTimer(roomWait)
		select {
		case <-wake:
		case <-t.C:
		case <-r.Context().Done():
		case <-s.ctx.Done():
		}
		t.Stop()
		s.rooms.mu.Lock()
		if s.roomsFor(a.Name)[rm.ID] != rm {
			s.rooms.mu.Unlock()
			writeErr(w, http.StatusNotFound, "that room is gone")
			return
		}
		if me != "" {
			rm.seen[me] = time.Now()
		}
	}
	v := rm.view(me)
	s.rooms.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// roomJoin adds the asking player, or a bot when the host asks for one.
func (s *Server) roomJoin(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	tok := playerToken(r)
	if tok == "" {
		writeErr(w, http.StatusBadRequest, "send an X-Player token (16-128 characters)")
		return
	}
	var req struct {
		Name string `json:"name"`
		Bot  bool   `json:"bot"`
	}
	if !readBody(w, r, 4<<10, &req) {
		return
	}
	req.Name = cleanName(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "send {name}")
		return
	}
	s.rooms.mu.Lock()
	defer s.rooms.mu.Unlock()
	_, rm, me, ok := s.findRoom(w, r, a.Name)
	if !ok {
		return
	}
	if req.Bot && me != rm.Host {
		writeErr(w, http.StatusForbidden, "only the host can add computer players")
		return
	}
	if !req.Bot && me != "" {
		for i := range rm.Players {
			if rm.Players[i].ID == me {
				rm.Players[i].Name = req.Name
			}
		}
	} else {
		if len(rm.Players) >= rm.Max {
			writeErr(w, http.StatusConflict, "this room is full")
			return
		}
		id := "p" + strconv.Itoa(rm.NextID)
		rm.NextID++
		rm.Players = append(rm.Players, roomPlayer{ID: id, Name: req.Name, Bot: req.Bot})
		if !req.Bot {
			rm.Tokens[tok] = id
			me = id
			rm.seen[id] = time.Now()
		}
	}
	if err := s.changed(a.Name, rm); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rm.view(me))
}

// roomLeave removes a player: yourself, or anyone if you're the host. The
// room closes when its last person leaves.
func (s *Server) roomLeave(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	s.rooms.mu.Lock()
	defer s.rooms.mu.Unlock()
	rooms, rm, me, ok := s.findRoom(w, r, a.Name)
	if !ok {
		return
	}
	pid := r.PathValue("player")
	if me == "" || (pid != me && me != rm.Host) {
		writeErr(w, http.StatusForbidden, "you can only remove yourself (or, as host, others)")
		return
	}
	kept := rm.Players[:0]
	for _, p := range rm.Players {
		if p.ID != pid {
			kept = append(kept, p)
		}
	}
	rm.Players = kept
	delete(rm.Private, pid)
	for t, id := range rm.Tokens {
		if id == pid {
			delete(rm.Tokens, t)
		}
	}
	people := 0
	for _, p := range rm.Players {
		if !p.Bot {
			people++
			if rm.Host == pid {
				rm.Host = p.ID
			}
		}
	}
	if people == 0 {
		s.dropRoom(a.Name, rooms, rm.ID)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.changed(a.Name, rm); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rm.view(me))
}

// roomPut replaces the shared state. It must name the version it was built
// on; if someone else moved first the answer is 409 with the room as it is.
func (s *Server) roomPut(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	var req struct {
		Version int64                      `json:"version"`
		State   json.RawMessage            `json:"state"`
		Status  *string                    `json:"status"`
		Private map[string]json.RawMessage `json:"private"`
	}
	if !readBody(w, r, roomMaxState+roomMaxPrivate*roomMaxPlayers, &req) {
		return
	}
	if len(req.State) > roomMaxState {
		writeErr(w, http.StatusRequestEntityTooLarge, "state is limited to 128 KB")
		return
	}
	s.rooms.mu.Lock()
	defer s.rooms.mu.Unlock()
	_, rm, me, ok := s.findRoom(w, r, a.Name)
	if !ok {
		return
	}
	if me == "" {
		writeErr(w, http.StatusForbidden, "join the room first")
		return
	}
	if req.Version != rm.Version {
		writeJSON(w, http.StatusConflict, rm.view(me))
		return
	}
	for pid, b := range req.Private {
		if !rm.hasPlayer(pid) {
			writeErr(w, http.StatusBadRequest, "no player "+pid)
			return
		}
		if len(b) > roomMaxPrivate {
			writeErr(w, http.StatusRequestEntityTooLarge, "private values are limited to 32 KB")
			return
		}
	}
	if len(req.State) > 0 {
		rm.State = req.State
	}
	if req.Status != nil {
		rm.Status = cleanName(*req.Status)
	}
	for pid, b := range req.Private {
		rm.Private[pid] = b
	}
	if err := s.changed(a.Name, rm); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rm.view(me))
}

func (rm *room) hasPlayer(id string) bool {
	for _, p := range rm.Players {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (s *Server) roomDelete(w http.ResponseWriter, r *http.Request) {
	a, ok := s.roomsApp(w, r)
	if !ok {
		return
	}
	s.rooms.mu.Lock()
	defer s.rooms.mu.Unlock()
	rooms, rm, me, ok := s.findRoom(w, r, a.Name)
	if !ok {
		return
	}
	if me != rm.Host && time.Since(rm.Updated) < time.Hour {
		writeErr(w, http.StatusForbidden, "only the host can close a room that's in use")
		return
	}
	s.dropRoom(a.Name, rooms, rm.ID)
	w.WriteHeader(http.StatusNoContent)
}
