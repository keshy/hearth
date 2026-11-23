package cast_test

import (
	"bytes"
	"context"
	"testing"
	"time"

	"appshome/internal/cast"
	"appshome/internal/cast/casttest"
)

func TestFrameRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	in := cast.Message{Source: "sender-0", Dest: "receiver-0", Namespace: "urn:x-cast:com.google.cast.receiver", Payload: `{"type":"GET_STATUS","requestId":7}` + string(bytes.Repeat([]byte("x"), 300))}
	if err := cast.WriteFrame(&buf, in); err != nil {
		t.Fatal(err)
	}
	out, err := cast.ReadFrame(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if out != in {
		t.Fatalf("got %+v", out)
	}
}

func TestFrameTooBig(t *testing.T) {
	if _, err := cast.ReadFrame(bytes.NewReader([]byte{0, 0x10, 0, 0})); err == nil {
		t.Fatal("accepted a 1 MB frame")
	}
}

func TestClientPlays(t *testing.T) {
	dev, err := casttest.Start()
	if err != nil {
		t.Fatal(err)
	}
	defer dev.Close()
	ctx := context.Background()
	c, err := cast.Dial(ctx, dev.Addr())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	app, err := c.Launch(ctx, cast.DefaultMediaReceiver)
	if err != nil {
		t.Fatal(err)
	}
	ms, err := c.Load(ctx, app.TransportID, cast.Media{URL: "https://example.test/a.m4a", ContentType: "audio/mp4", Title: "A"})
	if err != nil || ms.MediaSessionID == 0 {
		t.Fatalf("load: %+v %v", ms, err)
	}
	for ev := range c.Events() {
		if st := cast.ParseMediaStatus(ev.Payload); len(st) == 1 && st[0].PlayerState == "PLAYING" {
			break
		}
	}
	if err := c.Media(ctx, app.TransportID, ms.MediaSessionID, "PAUSE"); err != nil {
		t.Fatal(err)
	}
	if st, _, _ := dev.State(); st != "PAUSED" {
		t.Fatalf("device is %s", st)
	}
	if err := c.SetVolume(ctx, 0.3); err != nil {
		t.Fatal(err)
	}
	dev.Finish()
	select {
	case ev := <-c.Events():
		got := cast.ParseMediaStatus(ev.Payload)
		if len(got) != 1 || got[0].IdleReason != "FINISHED" {
			t.Fatalf("event %s", ev.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no status after the song finished")
	}
	if err := c.StopApp(ctx, app.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, vol, running := dev.State(); running || vol != 0.3 {
		t.Fatalf("running=%v volume=%v", running, vol)
	}
}
