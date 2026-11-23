// Package casttest is a pretend Cast speaker for tests: it runs the Default
// Media Receiver, "plays" whatever it's given, and finishes songs on request.
package casttest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"math/big"
	"net"
	"sync"
	"time"

	"appshome/internal/cast"
)

const (
	nsReceiver = "urn:x-cast:com.google.cast.receiver"
	nsMedia    = "urn:x-cast:com.google.cast.media"
	nsConn     = "urn:x-cast:com.google.cast.tp.connection"
	nsBeat     = "urn:x-cast:com.google.cast.tp.heartbeat"
	session    = "fake-session"
)

type Device struct {
	ln net.Listener

	mu      sync.Mutex
	conns   []net.Conn
	running bool
	volume  float64
	media   int
	state   string
	loads   []string
	fail    map[string]bool
}

// Start listens on a random local port; Addr says where.
func Start() (*Device, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
	ln, err := tls.Listen("tcp", "127.0.0.1:0", cfg)
	if err != nil {
		return nil, err
	}
	d := &Device{ln: ln, volume: 0.5, state: "IDLE", fail: map[string]bool{}}
	go d.accept()
	return d, nil
}

func (d *Device) Addr() string { return d.ln.Addr().String() }

func (d *Device) Close() {
	d.ln.Close()
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, c := range d.conns {
		c.Close()
	}
}

// Loads lists the URLs the device was asked to play, in order.
func (d *Device) Loads() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.loads...)
}

func (d *Device) State() (state string, volume float64, running bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.state, d.volume, d.running
}

// FailURL makes the device report a playback error for url.
func (d *Device) FailURL(url string) {
	d.mu.Lock()
	d.fail[url] = true
	d.mu.Unlock()
}

// Finish ends the current song as if it played to the end.
func (d *Device) Finish() { d.idle("FINISHED") }

func (d *Device) idle(reason string) {
	d.mu.Lock()
	d.state = "IDLE"
	st := d.mediaStatus(reason)
	d.mu.Unlock()
	d.broadcast(session, nsMedia, st)
}

func (d *Device) accept() {
	for {
		c, err := d.ln.Accept()
		if err != nil {
			return
		}
		d.mu.Lock()
		d.conns = append(d.conns, c)
		d.mu.Unlock()
		go d.serve(c)
	}
}

func (d *Device) broadcast(src, ns string, payload map[string]any) {
	b, _ := json.Marshal(payload)
	d.mu.Lock()
	conns := append([]net.Conn(nil), d.conns...)
	d.mu.Unlock()
	for _, c := range conns {
		cast.WriteFrame(c, cast.Message{Source: src, Dest: "*", Namespace: ns, Payload: string(b)})
	}
}

// Call with mu held.
func (d *Device) receiverStatus() map[string]any {
	apps := []map[string]any{}
	if d.running {
		apps = append(apps, map[string]any{"appId": cast.DefaultMediaReceiver, "sessionId": session, "transportId": session, "displayName": "Default Media Receiver"})
	}
	return map[string]any{"type": "RECEIVER_STATUS", "status": map[string]any{"applications": apps, "volume": map[string]any{"level": d.volume}}}
}

// Call with mu held.
func (d *Device) mediaStatus(idleReason string) map[string]any {
	s := map[string]any{"mediaSessionId": d.media, "playerState": d.state, "currentTime": 1.5, "media": map[string]any{"duration": 200.0}}
	if idleReason != "" {
		s["idleReason"] = idleReason
	}
	return map[string]any{"type": "MEDIA_STATUS", "status": []any{s}}
}

func (d *Device) serve(c net.Conn) {
	defer c.Close()
	for {
		m, err := cast.ReadFrame(c)
		if err != nil {
			return
		}
		var req struct {
			Type      string `json:"type"`
			RequestID int64  `json:"requestId"`
			Volume    struct {
				Level float64 `json:"level"`
			} `json:"volume"`
			Media struct {
				ContentID string `json:"contentId"`
			} `json:"media"`
		}
		json.Unmarshal([]byte(m.Payload), &req)
		var reply map[string]any
		var after func()
		d.mu.Lock()
		switch {
		case m.Namespace == nsBeat && req.Type == "PING":
			reply = map[string]any{"type": "PONG"}
		case m.Namespace == nsReceiver && req.Type == "GET_STATUS":
			reply = d.receiverStatus()
		case m.Namespace == nsReceiver && req.Type == "LAUNCH":
			d.running = true
			reply = d.receiverStatus()
		case m.Namespace == nsReceiver && req.Type == "STOP":
			d.running, d.state = false, "IDLE"
			reply = d.receiverStatus()
			after = func() { d.broadcast(session, nsConn, map[string]any{"type": "CLOSE"}) }
		case m.Namespace == nsReceiver && req.Type == "SET_VOLUME":
			d.volume = req.Volume.Level
			reply = d.receiverStatus()
		case m.Namespace == nsMedia && req.Type == "LOAD":
			d.media++
			d.loads = append(d.loads, req.Media.ContentID)
			d.state = "PLAYING"
			reply = d.mediaStatus("")
			if d.fail[req.Media.ContentID] {
				after = func() { time.Sleep(20 * time.Millisecond); d.idle("ERROR") }
			}
		case m.Namespace == nsMedia && req.Type == "PAUSE":
			d.state = "PAUSED"
			reply = d.mediaStatus("")
		case m.Namespace == nsMedia && req.Type == "PLAY":
			d.state = "PLAYING"
			reply = d.mediaStatus("")
		case m.Namespace == nsMedia && req.Type == "GET_STATUS":
			reply = d.mediaStatus("")
		}
		d.mu.Unlock()
		if reply != nil {
			if req.RequestID != 0 {
				reply["requestId"] = req.RequestID
			}
			b, _ := json.Marshal(reply)
			cast.WriteFrame(c, cast.Message{Source: m.Dest, Dest: m.Source, Namespace: m.Namespace, Payload: string(b)})
		}
		if after != nil {
			go after()
		}
	}
}
