package web

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

func roomServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.Defaults(t.TempDir())
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	state := deploy.State{Apps: map[string]deploy.AppState{
		"games":     {App: registry.App{Name: "games", Kind: registry.KindLink, Capabilities: []string{registry.CapRooms}}},
		"groceries": {App: registry.App{Name: "groceries", Kind: registry.KindLink}},
	}}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(cfg.StatePath(), b, 0o644); err != nil {
		t.Fatal(err)
	}
	logger := log.New(io.Discard, "", 0)
	engine := deploy.New(cfg, logger, nil)
	s, err := New(context.Background(), cfg, engine, nil, builder.New(cfg, engine, logger), nil, logger)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

type roomView struct {
	ID      string
	Status  string
	Host    string
	Me      string
	Version int64
	Players []struct {
		ID, Name    string
		Bot, Online bool
	}
	State   json.RawMessage
	Private map[string]json.RawMessage
}

func roomCall(t *testing.T, s *Server, app, player, method, path, body string) (int, roomView) {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set(caddy.AppHeader, app)
	if player != "" {
		r.Header.Set("X-Player", player)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	var v roomView
	json.Unmarshal(w.Body.Bytes(), &v)
	return w.Code, v
}

const (
	adi   = "token-for-adi-0000000001"
	daddy = "token-for-daddy-00000002"
	nosy  = "token-for-nosy-000000003"
)

func TestRoomsPlay(t *testing.T) {
	s := roomServer(t)
	if code, _ := roomCall(t, s, "groceries", adi, "POST", "/_api/rooms", `{"game":"chess","name":"Adi"}`); code != http.StatusForbidden {
		t.Fatalf("no capability: %d", code)
	}
	if code, _ := roomCall(t, s, "games", "short", "POST", "/_api/rooms", `{"game":"chess","name":"Adi"}`); code != http.StatusBadRequest {
		t.Fatalf("bad token: %d", code)
	}
	code, rm := roomCall(t, s, "games", adi, "POST", "/_api/rooms", `{"game":"battleship","name":"  Adi  ","max":2,"state":{"turn":0}}`)
	if code != http.StatusCreated || len(rm.ID) != 4 || rm.Me != "p1" || rm.Host != "p1" || rm.Players[0].Name != "Adi" {
		t.Fatalf("create: %d %+v", code, rm)
	}
	base := "/_api/rooms/" + rm.ID

	code, joined := roomCall(t, s, "games", daddy, "POST", base+"/players", `{"name":"Daddy"}`)
	if code != http.StatusOK || joined.Me != "p2" || len(joined.Players) != 2 {
		t.Fatalf("join: %d %+v", code, joined)
	}
	if code, _ := roomCall(t, s, "games", nosy, "POST", base+"/players", `{"name":"Nosy"}`); code != http.StatusConflict {
		t.Fatalf("full room: %d", code)
	}
	if code, _ := roomCall(t, s, "games", nosy, "PUT", base, `{"version":2,"state":{}}`); code != http.StatusForbidden {
		t.Fatalf("outsider write: %d", code)
	}

	// Daddy waits for a change; Adi's move wakes him.
	got := make(chan roomView, 1)
	go func() {
		_, v := roomCall(t, s, "games", daddy, "GET", base+"?since=2", "")
		got <- v
	}()
	time.Sleep(50 * time.Millisecond)
	code, moved := roomCall(t, s, "games", adi, "PUT", base,
		`{"version":2,"status":"playing","state":{"turn":1},"private":{"p1":{"fleet":"A1-A5"}}}`)
	if code != http.StatusOK || moved.Version != 3 || moved.Status != "playing" {
		t.Fatalf("move: %d %+v", code, moved)
	}
	select {
	case v := <-got:
		if v.Version != 3 || compact(v.State) != `{"turn":1}` || len(v.Private) != 0 {
			t.Fatalf("daddy saw %+v", v)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the long poll never woke")
	}
	_, mine := roomCall(t, s, "games", adi, "GET", base, "")
	if compact(mine.Private["p1"]) != `{"fleet":"A1-A5"}` {
		t.Fatalf("own private: %+v", mine.Private)
	}

	// A move built on an old version loses and gets the current room back.
	code, stale := roomCall(t, s, "games", daddy, "PUT", base, `{"version":2,"state":{"turn":9}}`)
	if code != http.StatusConflict || stale.Version != 3 || compact(stale.State) != `{"turn":1}` {
		t.Fatalf("stale: %d %+v", code, stale)
	}

	// Rooms survive a restart.
	s2 := roomServer(t)
	s2.cfg = s.cfg
	if code, again := roomCall(t, s2, "games", daddy, "GET", base, ""); code != http.StatusOK || again.Me != "p2" || again.Version != 3 {
		t.Fatalf("reload: %d %+v", code, again)
	}

	// Leaving hands the room to the next person; the last one out closes it.
	if code, left := roomCall(t, s, "games", adi, "DELETE", base+"/players/p1", ""); code != http.StatusOK || left.Host != "p2" {
		t.Fatalf("leave: %d %+v", code, left)
	}
	if code, _ := roomCall(t, s, "games", daddy, "DELETE", base+"/players/p2", ""); code != http.StatusNoContent {
		t.Fatalf("last leave: %d", code)
	}
	if code, _ := roomCall(t, s, "games", daddy, "GET", base, ""); code != http.StatusNotFound {
		t.Fatalf("closed room: %d", code)
	}
}

func TestRoomsBots(t *testing.T) {
	s := roomServer(t)
	_, rm := roomCall(t, s, "games", adi, "POST", "/_api/rooms", `{"game":"ludo","name":"Adi"}`)
	base := "/_api/rooms/" + rm.ID
	roomCall(t, s, "games", daddy, "POST", base+"/players", `{"name":"Daddy"}`)
	if code, _ := roomCall(t, s, "games", daddy, "POST", base+"/players", `{"name":"Robo","bot":true}`); code != http.StatusForbidden {
		t.Fatalf("guest added a bot: %d", code)
	}
	code, v := roomCall(t, s, "games", adi, "POST", base+"/players", `{"name":"Robo","bot":true}`)
	if code != http.StatusOK || len(v.Players) != 3 || !v.Players[2].Bot || v.Me != "p1" {
		t.Fatalf("bot: %d %+v", code, v)
	}
	roomCall(t, s, "games", adi, "PUT", base, `{"version":`+itoa(v.Version)+`,"private":{"p3":{"secret":1},"p2":{"hand":2}}}`)
	if _, host := roomCall(t, s, "games", adi, "GET", base, ""); host.Private["p3"] == nil || host.Private["p2"] != nil {
		t.Fatalf("host privates: %+v", host.Private)
	}
	if _, guest := roomCall(t, s, "games", daddy, "GET", base, ""); guest.Private["p3"] != nil || guest.Private["p2"] == nil {
		t.Fatalf("guest privates: %+v", guest.Private)
	}

	r := httptest.NewRequest("GET", "/_api/rooms", nil)
	r.Header.Set(caddy.AppHeader, "games")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	var list struct{ Rooms []map[string]any }
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list.Rooms) != 1 || list.Rooms[0]["state"] != nil || list.Rooms[0]["tokens"] != nil {
		t.Fatalf("list: %s", w.Body)
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func compact(b json.RawMessage) string {
	var v any
	json.Unmarshal(b, &v)
	e, _ := json.Marshal(v)
	return string(e)
}
