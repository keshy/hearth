package cast

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const (
	nsConnection = "urn:x-cast:com.google.cast.tp.connection"
	nsHeartbeat  = "urn:x-cast:com.google.cast.tp.heartbeat"
	nsReceiver   = "urn:x-cast:com.google.cast.receiver"
	nsMedia      = "urn:x-cast:com.google.cast.media"

	// DefaultMediaReceiver plays a media URL on any Cast device.
	DefaultMediaReceiver = "CC1AD845"

	sender   = "sender-hearth"
	receiver = "receiver-0"
)

var ErrClosed = errors.New("cast: connection closed")

// Event is a status message the device sent on its own (not a reply).
type Event struct {
	Namespace string
	Type      string
	Payload   json.RawMessage
}

// Client is one TLS connection to a Cast device.
type Client struct {
	conn    *tls.Conn
	wmu     sync.Mutex
	nextID  atomic.Int64
	pmu     sync.Mutex
	pending map[int64]chan json.RawMessage
	events  chan Event
	done    chan struct{}
	once    sync.Once
	err     error
}

// Dial connects to a device at host:port. Cast devices use self-signed
// certificates, so the connection is encrypted but not authenticated.
func Dial(ctx context.Context, addr string) (*Client, error) {
	d := &tls.Dialer{NetDialer: &net.Dialer{Timeout: 5 * time.Second}, Config: &tls.Config{InsecureSkipVerify: true}}
	nc, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c := &Client{
		conn:    nc.(*tls.Conn),
		pending: map[int64]chan json.RawMessage{},
		events:  make(chan Event, 32),
		done:    make(chan struct{}),
	}
	go c.read()
	go c.heartbeat()
	if err := c.send(receiver, nsConnection, map[string]any{"type": "CONNECT"}); err != nil {
		c.Close()
		return nil, err
	}
	return c, nil
}

// Events delivers unsolicited status messages until the connection closes.
func (c *Client) Events() <-chan Event { return c.events }

// Done is closed when the connection ends; Err says why.
func (c *Client) Done() <-chan struct{} { return c.done }

func (c *Client) Err() error {
	<-c.done
	return c.err
}

func (c *Client) Close() error {
	c.shutdown(ErrClosed)
	return nil
}

func (c *Client) shutdown(err error) {
	c.once.Do(func() {
		c.err = err
		close(c.done)
		c.conn.Close()
	})
}

func (c *Client) send(dest, ns string, payload map[string]any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return WriteFrame(c.conn, Message{Source: sender, Dest: dest, Namespace: ns, Payload: string(b)})
}

// request sends a message with a requestId and waits for the reply.
func (c *Client) request(ctx context.Context, dest, ns string, payload map[string]any) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	payload["requestId"] = id
	ch := make(chan json.RawMessage, 1)
	c.pmu.Lock()
	c.pending[id] = ch
	c.pmu.Unlock()
	defer func() {
		c.pmu.Lock()
		delete(c.pending, id)
		c.pmu.Unlock()
	}()
	if err := c.send(dest, ns, payload); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	select {
	case r := <-ch:
		var head struct {
			Type   string `json:"type"`
			Reason string `json:"reason"`
		}
		json.Unmarshal(r, &head)
		switch head.Type {
		case "LOAD_FAILED", "LOAD_CANCELLED", "INVALID_REQUEST", "LAUNCH_ERROR", "INVALID_PLAYER_STATE":
			return r, fmt.Errorf("cast: %s %s", head.Type, head.Reason)
		}
		return r, nil
	case <-c.done:
		return nil, c.err
	case <-ctx.Done():
		return nil, fmt.Errorf("cast: no reply to %v: %w", payload["type"], ctx.Err())
	}
}

func (c *Client) read() {
	for {
		c.conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		m, err := ReadFrame(c.conn)
		if err != nil {
			c.shutdown(err)
			close(c.events)
			return
		}
		var head struct {
			Type      string `json:"type"`
			RequestID int64  `json:"requestId"`
		}
		json.Unmarshal([]byte(m.Payload), &head)
		switch {
		case m.Namespace == nsHeartbeat && head.Type == "PING":
			c.send(m.Source, nsHeartbeat, map[string]any{"type": "PONG"})
		case m.Namespace == nsHeartbeat:
		case m.Namespace == nsConnection && head.Type == "CLOSE" && m.Source == receiver:
			c.shutdown(ErrClosed)
			close(c.events)
			return
		default:
			if head.RequestID != 0 {
				c.pmu.Lock()
				ch := c.pending[head.RequestID]
				c.pmu.Unlock()
				if ch != nil {
					ch <- json.RawMessage(m.Payload)
					continue
				}
			}
			select {
			case c.events <- Event{Namespace: m.Namespace, Type: head.Type, Payload: json.RawMessage(m.Payload)}:
			default: // nobody listening; status is re-read on demand
			}
		}
	}
}

func (c *Client) heartbeat() {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			if err := c.send(receiver, nsHeartbeat, map[string]any{"type": "PING"}); err != nil {
				c.shutdown(err)
				return
			}
		case <-c.done:
			return
		}
	}
}

// ---------- receiver ----------

type App struct {
	AppID       string `json:"appId"`
	SessionID   string `json:"sessionId"`
	TransportID string `json:"transportId"`
	DisplayName string `json:"displayName"`
}

type Volume struct {
	Level float64 `json:"level"`
	Muted bool    `json:"muted"`
}

type ReceiverStatus struct {
	Applications []App  `json:"applications"`
	Volume       Volume `json:"volume"`
}

func (s ReceiverStatus) App(id string) (App, bool) {
	for _, a := range s.Applications {
		if a.AppID == id {
			return a, true
		}
	}
	return App{}, false
}

func parseReceiver(r json.RawMessage) (ReceiverStatus, error) {
	var v struct {
		Status ReceiverStatus `json:"status"`
	}
	err := json.Unmarshal(r, &v)
	return v.Status, err
}

func (c *Client) ReceiverStatus(ctx context.Context) (ReceiverStatus, error) {
	r, err := c.request(ctx, receiver, nsReceiver, map[string]any{"type": "GET_STATUS"})
	if err != nil {
		return ReceiverStatus{}, err
	}
	return parseReceiver(r)
}

// Launch starts an app (or finds it running) and opens a channel to it.
func (c *Client) Launch(ctx context.Context, appID string) (App, error) {
	if st, err := c.ReceiverStatus(ctx); err == nil {
		if a, ok := st.App(appID); ok && a.TransportID != "" {
			return a, c.send(a.TransportID, nsConnection, map[string]any{"type": "CONNECT"})
		}
	}
	r, err := c.request(ctx, receiver, nsReceiver, map[string]any{"type": "LAUNCH", "appId": appID})
	if err != nil {
		return App{}, err
	}
	st, err := parseReceiver(r)
	if err != nil {
		return App{}, err
	}
	a, ok := st.App(appID)
	if !ok || a.TransportID == "" {
		return App{}, errors.New("cast: the media player didn't start")
	}
	return a, c.send(a.TransportID, nsConnection, map[string]any{"type": "CONNECT"})
}

// StopApp ends an app's session, which stops playback and frees the device.
func (c *Client) StopApp(ctx context.Context, sessionID string) error {
	_, err := c.request(ctx, receiver, nsReceiver, map[string]any{"type": "STOP", "sessionId": sessionID})
	return err
}

func (c *Client) SetVolume(ctx context.Context, level float64) error {
	level = max(0, min(1, level))
	_, err := c.request(ctx, receiver, nsReceiver, map[string]any{"type": "SET_VOLUME", "volume": map[string]any{"level": level}})
	return err
}

// ---------- media ----------

type Media struct {
	URL, ContentType, Title, Artist, Image string
}

type MediaStatus struct {
	MediaSessionID int     `json:"mediaSessionId"`
	PlayerState    string  `json:"playerState"` // IDLE, BUFFERING, PLAYING, PAUSED
	IdleReason     string  `json:"idleReason"`  // FINISHED, CANCELLED, INTERRUPTED, ERROR
	CurrentTime    float64 `json:"currentTime"`
	Media          *struct {
		ContentID string  `json:"contentId"`
		Duration  float64 `json:"duration"`
	} `json:"media"`
}

func ParseMediaStatus(r json.RawMessage) []MediaStatus {
	var v struct {
		Status []MediaStatus `json:"status"`
	}
	json.Unmarshal(r, &v)
	return v.Status
}

func (c *Client) Load(ctx context.Context, transportID string, m Media) (MediaStatus, error) {
	meta := map[string]any{"metadataType": 3, "title": m.Title, "artist": m.Artist}
	if m.Image != "" {
		meta["images"] = []map[string]string{{"url": m.Image}}
	}
	r, err := c.request(ctx, transportID, nsMedia, map[string]any{
		"type":     "LOAD",
		"autoplay": true,
		"media": map[string]any{
			"contentId": m.URL, "contentType": m.ContentType, "streamType": "BUFFERED", "metadata": meta,
		},
	})
	if err != nil {
		return MediaStatus{}, err
	}
	st := ParseMediaStatus(r)
	if len(st) == 0 {
		return MediaStatus{}, errors.New("cast: the speaker didn't report the new song")
	}
	return st[0], nil
}

func (c *Client) MediaStatus(ctx context.Context, transportID string) ([]MediaStatus, error) {
	r, err := c.request(ctx, transportID, nsMedia, map[string]any{"type": "GET_STATUS"})
	if err != nil {
		return nil, err
	}
	return ParseMediaStatus(r), nil
}

// Media sends PLAY, PAUSE or STOP for the current media session.
func (c *Client) Media(ctx context.Context, transportID string, sessionID int, command string) error {
	_, err := c.request(ctx, transportID, nsMedia, map[string]any{"type": command, "mediaSessionId": sessionID})
	return err
}
