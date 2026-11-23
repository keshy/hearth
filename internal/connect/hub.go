package connect

import (
	"context"
	"errors"
	"log"
	"regexp"
	"sync"
	"time"

	"appshome/internal/cast"
)

var videoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

const (
	maxQueue  = 100
	scanFor   = 2500 * time.Millisecond
	staleScan = time.Minute
)

// Song is one entry of a queue. ID is a YouTube video id.
type Song struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	By    string `json:"by,omitempty"`
}

func (s Song) valid() bool {
	return videoID.MatchString(s.ID) && len(s.Title) <= 300 && len(s.By) <= 300
}

var (
	ErrNoDevice = errors.New("that speaker isn't on the network right now")
	ErrBadQueue = errors.New("nothing playable in that list")
	ErrIdle     = errors.New("nothing is playing on that speaker")
)

type Hub struct {
	Tools *Tools
	log   *log.Logger
	ctx   context.Context

	mu       sync.Mutex
	devices  map[string]cast.Device
	scanned  time.Time
	scanning chan struct{}
	sessions map[string]*session
	discover func(context.Context, time.Duration) ([]cast.Device, error)
}

func NewHub(ctx context.Context, toolsDir string, log *log.Logger) *Hub {
	return &Hub{
		Tools:    NewTools(toolsDir),
		log:      log,
		ctx:      ctx,
		devices:  map[string]cast.Device{},
		sessions: map[string]*session{},
		discover: cast.Discover,
	}
}

// Run keeps the player tools installed and current until ctx ends.
func (h *Hub) Run(ctx context.Context) {
	for {
		if err := h.Tools.Ensure(ctx); err != nil && ctx.Err() == nil {
			h.log.Printf("connect: player tools: %v", err)
		}
		wait := 6 * time.Hour
		if ok, _ := h.Tools.Status(); !ok {
			wait = 10 * time.Minute
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// DeviceInfo is a device as apps see it, with what it's playing for us.
type DeviceInfo struct {
	cast.Device
	Status *Status `json:"status,omitempty"`
}

// Devices lists speakers and TVs. fresh asks for a new look around the network
// rather than the last answer.
func (h *Hub) Devices(ctx context.Context, fresh bool) []DeviceInfo {
	h.mu.Lock()
	stale := fresh && time.Since(h.scanned) > 5*time.Second || time.Since(h.scanned) > staleScan
	h.mu.Unlock()
	if stale {
		h.scan(ctx)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]DeviceInfo, 0, len(h.devices))
	for _, d := range h.devices {
		info := DeviceInfo{Device: d}
		if s := h.sessions[d.ID]; s != nil {
			st := s.status()
			info.Status = &st
		}
		out = append(out, info)
	}
	sortDevices(out)
	return out
}

func sortDevices(ds []DeviceInfo) {
	for i := 1; i < len(ds); i++ {
		for j := i; j > 0 && ds[j].Name < ds[j-1].Name; j-- {
			ds[j], ds[j-1] = ds[j-1], ds[j]
		}
	}
}

// scan looks for devices, sharing one scan between concurrent callers.
func (h *Hub) scan(ctx context.Context) {
	h.mu.Lock()
	if ch := h.scanning; ch != nil {
		h.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
		}
		return
	}
	ch := make(chan struct{})
	h.scanning = ch
	h.mu.Unlock()

	found, err := h.discover(h.ctx, scanFor)
	h.mu.Lock()
	defer func() { h.scanning = nil; close(ch); h.mu.Unlock() }()
	if err != nil {
		h.log.Printf("connect: looking for speakers: %v", err)
		return
	}
	next := map[string]cast.Device{}
	for _, d := range found {
		next[d.ID] = d
	}
	// A speaker we're playing on stays listed even if it missed this scan.
	for id, s := range h.sessions {
		if _, ok := next[id]; !ok && s.active() {
			next[id] = s.dev
		}
	}
	h.devices = next
	h.scanned = time.Now()
}

func (h *Hub) device(ctx context.Context, id string) (cast.Device, bool) {
	h.mu.Lock()
	d, ok := h.devices[id]
	h.mu.Unlock()
	if !ok {
		h.scan(ctx)
		h.mu.Lock()
		d, ok = h.devices[id]
		h.mu.Unlock()
	}
	return d, ok
}

func (h *Hub) session(ctx context.Context, id string, create bool) (*session, error) {
	h.mu.Lock()
	s := h.sessions[id]
	h.mu.Unlock()
	if s != nil {
		return s, nil
	}
	if !create {
		return nil, ErrIdle
	}
	d, ok := h.device(ctx, id)
	if !ok {
		return nil, ErrNoDevice
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if s = h.sessions[id]; s == nil {
		s = newSession(h, d)
		h.sessions[id] = s
	}
	return s, nil
}

// Status of one device; ok is false for devices we aren't playing on.
func (h *Hub) Status(id string) (Status, bool) {
	h.mu.Lock()
	s := h.sessions[id]
	h.mu.Unlock()
	if s == nil {
		return Status{State: "idle"}, false
	}
	return s.status(), true
}

// Play replaces what device id is playing with queue, starting at index.
func (h *Hub) Play(ctx context.Context, id string, queue []Song, index int) (Status, error) {
	var q []Song
	for i, s := range queue {
		if len(q) == maxQueue {
			break
		}
		if s.valid() {
			q = append(q, s)
		} else if i < index {
			index--
		}
	}
	if len(q) == 0 {
		return Status{}, ErrBadQueue
	}
	if index < 0 || index >= len(q) {
		index = 0
	}
	s, err := h.session(ctx, id, true)
	if err != nil {
		return Status{}, err
	}
	s.play(q, index)
	return s.status(), nil
}

// Control runs pause, resume, next, prev or stop on device id.
func (h *Hub) Control(ctx context.Context, id, action string) (Status, error) {
	s, err := h.session(ctx, id, false)
	if err != nil {
		return Status{}, err
	}
	if err := s.control(ctx, action); err != nil {
		return s.status(), err
	}
	return s.status(), nil
}

// Volume sets device id's volume, 0 to 1.
func (h *Hub) Volume(ctx context.Context, id string, level float64) (Status, error) {
	s, err := h.session(ctx, id, true)
	if err != nil {
		return Status{}, err
	}
	if err := s.setVolume(ctx, level); err != nil {
		return s.status(), err
	}
	return s.status(), nil
}
