package connect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"appshome/internal/cast"
)

// Status is what a device is doing for us. State is one of idle, loading,
// buffering, playing, paused or error.
type Status struct {
	State    string  `json:"state"`
	Song     *Song   `json:"song,omitempty"`
	Index    int     `json:"index"`
	Queue    []Song  `json:"queue,omitempty"`
	Position float64 `json:"position"`
	Duration float64 `json:"duration"`
	Volume   float64 `json:"volume"`
	Error    string  `json:"error,omitempty"`
}

type session struct {
	hub *Hub
	dev cast.Device

	// op serialises commands to the device; mu guards the fields below.
	op sync.Mutex
	mu sync.Mutex

	client   *cast.Client
	app      cast.App
	media    int // the device's media session id
	queue    []Song
	index    int
	gen      int // bumped by every play/skip so a slow load can tell it lost
	state    string
	pos      float64
	posAt    time.Time
	duration float64
	volume   float64
	err      string
	retried  bool
}

func newSession(h *Hub, d cast.Device) *session {
	return &session{hub: h, dev: d, state: "idle", volume: -1}
}

func (s *session) active() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state != "idle" && s.state != "error"
}

func (s *session) status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{State: s.state, Index: s.index, Queue: s.queue, Duration: s.duration, Volume: s.volume, Error: s.err, Position: s.pos}
	if s.state == "playing" && !s.posAt.IsZero() {
		st.Position += time.Since(s.posAt).Seconds()
		if s.duration > 0 {
			st.Position = min(st.Position, s.duration)
		}
	}
	if s.index >= 0 && s.index < len(s.queue) {
		song := s.queue[s.index]
		st.Song = &song
	}
	return st
}

// connect makes sure we have a live connection with the media player
// running. Call with op held.
func (s *session) connect(ctx context.Context) (*cast.Client, cast.App, error) {
	s.mu.Lock()
	c, app := s.client, s.app
	s.mu.Unlock()
	if c != nil && !isDone(c) && app.TransportID != "" {
		return c, app, nil
	}
	if c == nil || isDone(c) {
		var err error
		c, err = cast.Dial(ctx, s.dev.Addr)
		if err != nil {
			return nil, cast.App{}, fmt.Errorf("couldn't reach %s: %w", s.dev.Name, err)
		}
		go s.watch(c)
	}
	if st, err := c.ReceiverStatus(ctx); err == nil {
		s.mu.Lock()
		s.volume = st.Volume.Level
		s.mu.Unlock()
	}
	app, err := c.Launch(ctx, cast.DefaultMediaReceiver)
	if err != nil {
		c.Close()
		return nil, cast.App{}, fmt.Errorf("%s wouldn't start playing: %w", s.dev.Name, err)
	}
	s.mu.Lock()
	s.client, s.app = c, app
	s.mu.Unlock()
	return c, app, nil
}

func isDone(c *cast.Client) bool {
	select {
	case <-c.Done():
		return true
	default:
		return false
	}
}

// play swaps in a new queue and starts it. It returns at once; loading
// carries on in the background.
func (s *session) play(queue []Song, index int) {
	s.mu.Lock()
	s.queue, s.index = queue, index
	s.mu.Unlock()
	s.start()
}

// start loads the current song in the background.
func (s *session) start() {
	s.mu.Lock()
	s.gen++
	gen := s.gen
	s.state, s.err, s.pos, s.posAt, s.duration, s.retried = "loading", "", 0, time.Time{}, 0, false
	s.mu.Unlock()
	go s.load(gen)
}

func (s *session) current(gen int) (Song, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if gen != s.gen || s.index < 0 || s.index >= len(s.queue) {
		return Song{}, false
	}
	return s.queue[s.index], true
}

func (s *session) load(gen int) {
	ctx, cancel := context.WithTimeout(s.hub.ctx, 90*time.Second)
	defer cancel()
	song, ok := s.current(gen)
	if !ok {
		return
	}
	url, ct, err := s.hub.Tools.Resolve(ctx, song.ID)
	if err != nil {
		s.fail(gen, err)
		return
	}
	s.op.Lock()
	defer s.op.Unlock()
	if _, ok := s.current(gen); !ok {
		return
	}
	c, app, err := s.connect(ctx)
	if err != nil {
		s.fail(gen, err)
		return
	}
	ms, err := c.Load(ctx, app.TransportID, cast.Media{
		URL: url, ContentType: ct, Title: song.Title, Artist: song.By,
		Image: "https://i.ytimg.com/vi/" + song.ID + "/hqdefault.jpg",
	})
	if err != nil {
		s.hub.Tools.Forget(song.ID)
		s.fail(gen, fmt.Errorf("%s couldn't play %q: %w", s.dev.Name, song.Title, err))
		return
	}
	s.mu.Lock()
	if gen == s.gen {
		s.media = ms.MediaSessionID
		s.apply(ms)
	}
	s.mu.Unlock()
	s.prefetch(gen)
}

// prefetch resolves the next song so it starts without the ~10s lookup.
func (s *session) prefetch(gen int) {
	s.mu.Lock()
	if gen != s.gen || s.index+1 >= len(s.queue) {
		s.mu.Unlock()
		return
	}
	next := s.queue[s.index+1]
	s.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(s.hub.ctx, 90*time.Second)
		defer cancel()
		if _, _, err := s.hub.Tools.Resolve(ctx, next.ID); err != nil {
			s.hub.log.Printf("connect: prefetch %s: %v", next.ID, err)
		}
	}()
}

func (s *session) fail(gen int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if gen != s.gen {
		return
	}
	s.state, s.err = "error", err.Error()
	s.hub.log.Printf("connect: %s: %v", s.dev.Name, err)
}

// apply records a media status from the device. Call with mu held.
func (s *session) apply(ms cast.MediaStatus) {
	if ms.MediaSessionID != 0 {
		s.media = ms.MediaSessionID
	}
	switch ms.PlayerState {
	case "PLAYING":
		s.state = "playing"
	case "PAUSED":
		s.state = "paused"
	case "BUFFERING":
		s.state = "buffering"
	}
	if ms.PlayerState != "IDLE" {
		s.pos, s.posAt = ms.CurrentTime, time.Now()
	}
	if ms.Media != nil && ms.Media.Duration > 0 {
		s.duration = ms.Media.Duration
	}
}

// watch follows status messages from the device for one connection.
func (s *session) watch(c *cast.Client) {
	for ev := range c.Events() {
		switch {
		case ev.Type == "MEDIA_STATUS":
			for _, ms := range cast.ParseMediaStatus(ev.Payload) {
				s.onMedia(ms)
			}
		case ev.Type == "RECEIVER_STATUS":
			s.onReceiver(ev.Payload)
		case ev.Type == "CLOSE":
			// The media player closed our channel: someone stopped it or
			// cast something else.
			s.ended(c)
		}
	}
	s.ended(c)
}

func (s *session) onMedia(ms cast.MediaStatus) {
	s.mu.Lock()
	// While loading, statuses are about the song being replaced; the reply
	// to LOAD brings the new one.
	if s.state == "loading" || s.state == "idle" || s.state == "error" ||
		ms.MediaSessionID != 0 && s.media != 0 && ms.MediaSessionID != s.media {
		s.mu.Unlock()
		return
	}
	if ms.PlayerState != "IDLE" {
		s.apply(ms)
		s.mu.Unlock()
		return
	}
	reason, gen, retried := ms.IdleReason, s.gen, s.retried
	var song Song
	if s.index >= 0 && s.index < len(s.queue) {
		song = s.queue[s.index]
	}
	switch reason {
	case "FINISHED":
		if s.index+1 < len(s.queue) {
			s.index++
			s.mu.Unlock()
			s.start()
			return
		}
		s.state, s.pos, s.posAt = "idle", 0, time.Time{}
	case "ERROR":
		s.hub.Tools.Forget(song.ID)
		if !retried {
			// Most often an expired or IP-locked link; try a fresh one once.
			s.retried = true
			s.state = "loading"
			s.mu.Unlock()
			go s.load(gen)
			return
		}
		if s.index+1 < len(s.queue) {
			s.index++
			s.mu.Unlock()
			s.start()
			return
		}
		s.state, s.err = "error", fmt.Sprintf("%s couldn't play %q", s.dev.Name, song.Title)
	case "CANCELLED", "INTERRUPTED":
		s.state, s.pos, s.posAt = "idle", 0, time.Time{}
	}
	s.mu.Unlock()
}

func (s *session) onReceiver(raw json.RawMessage) {
	var v struct {
		Status cast.ReceiverStatus `json:"status"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return
	}
	s.mu.Lock()
	s.volume = v.Status.Volume.Level
	gone := s.app.SessionID != ""
	for _, a := range v.Status.Applications {
		if a.SessionID == s.app.SessionID {
			gone = false
		}
	}
	c := s.client
	s.mu.Unlock()
	if gone && c != nil {
		s.ended(c)
	}
}

// ended forgets connection c after the device dropped it or moved on.
func (s *session) ended(c *cast.Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != c {
		return
	}
	c.Close()
	s.client, s.app, s.media = nil, cast.App{}, 0
	if s.state != "loading" {
		s.state, s.pos, s.posAt = "idle", 0, time.Time{}
	}
}

func (s *session) control(ctx context.Context, action string) error {
	switch action {
	case "next", "prev":
		s.mu.Lock()
		i := s.index + 1
		if action == "prev" {
			i = s.index - 1
			// Like every music app: back restarts the song unless it just began.
			if s.state == "playing" && s.position() > 5 {
				i = s.index
			}
		}
		if i < 0 || i >= len(s.queue) {
			s.mu.Unlock()
			return nil
		}
		s.index = i
		s.mu.Unlock()
		s.start()
		return nil
	case "pause", "resume", "stop":
	default:
		return errors.New("unknown action")
	}

	s.mu.Lock()
	c, app, media := s.client, s.app, s.media
	restart := action == "resume" && (c == nil || isDone(c) || s.state == "error" || s.state == "idle") && len(s.queue) > 0
	s.mu.Unlock()
	if restart {
		s.start()
		return nil
	}
	if c == nil || isDone(c) {
		return ErrIdle
	}
	s.op.Lock()
	defer s.op.Unlock()
	if action == "stop" {
		s.mu.Lock()
		s.gen++
		s.state, s.pos, s.posAt = "idle", 0, time.Time{}
		s.mu.Unlock()
		err := c.StopApp(ctx, app.SessionID)
		s.ended(c)
		return err
	}
	if media == 0 {
		return ErrIdle
	}
	if err := c.Media(ctx, app.TransportID, media, map[string]string{"pause": "PAUSE", "resume": "PLAY"}[action]); err != nil {
		return err
	}
	if ms, err := c.MediaStatus(ctx, app.TransportID); err == nil {
		s.mu.Lock()
		for _, m := range ms {
			s.apply(m)
		}
		s.mu.Unlock()
	}
	return nil
}

// position is the playback position. Call with mu held.
func (s *session) position() float64 {
	if s.posAt.IsZero() {
		return s.pos
	}
	return s.pos + time.Since(s.posAt).Seconds()
}

func (s *session) setVolume(ctx context.Context, level float64) error {
	s.op.Lock()
	defer s.op.Unlock()
	s.mu.Lock()
	c := s.client
	s.mu.Unlock()
	if c == nil || isDone(c) {
		var err error
		if c, err = cast.Dial(ctx, s.dev.Addr); err != nil {
			return fmt.Errorf("couldn't reach %s: %w", s.dev.Name, err)
		}
		defer c.Close()
	}
	level = max(0, min(1, level))
	if err := c.SetVolume(ctx, level); err != nil {
		return err
	}
	s.mu.Lock()
	s.volume = level
	s.mu.Unlock()
	return nil
}
