package cast

import (
	"context"
	"os"
	"testing"
	"time"
)

// Tests that talk to real devices on the LAN. They only run with CAST_LIVE=1,
// and CAST_URL set plays that URL briefly (and quietly) on the first device.
func TestLiveDiscover(t *testing.T) {
	if os.Getenv("CAST_LIVE") == "" {
		t.Skip("set CAST_LIVE=1 to look for real devices")
	}
	ds, err := Discover(context.Background(), 2500*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range ds {
		t.Logf("%+v", d)
	}
	url := os.Getenv("CAST_URL")
	if url == "" || len(ds) == 0 {
		return
	}
	ctx := context.Background()
	c, err := Dial(ctx, ds[0].Addr)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	st, err := c.ReceiverStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("volume %.2f, apps %+v", st.Volume.Level, st.Applications)
	before := st.Volume.Level
	c.SetVolume(ctx, 0.15)
	defer c.SetVolume(ctx, before)
	app, err := c.Launch(ctx, DefaultMediaReceiver)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("launched %+v", app)
	ms, err := c.Load(ctx, app.TransportID, Media{URL: url, ContentType: "audio/mp4", Title: "Lingashtakam", Artist: "S. P. Balasubrahmanyam"})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("load: %+v", ms)
	deadline := time.After(12 * time.Second)
	var playing time.Time
	for {
		select {
		case ev := <-c.Events():
			if ev.Type == "MEDIA_STATUS" {
				for _, s := range ParseMediaStatus(ev.Payload) {
					t.Logf("status %s %s t=%.1f", s.PlayerState, s.IdleReason, s.CurrentTime)
					if s.PlayerState == "PLAYING" && playing.IsZero() {
						playing = time.Now()
					}
				}
			}
		case <-time.After(500 * time.Millisecond):
		case <-deadline:
			t.Fatal("never started playing")
		}
		if !playing.IsZero() && time.Since(playing) > 6*time.Second {
			break
		}
	}
	if err := c.StopApp(ctx, app.SessionID); err != nil {
		t.Errorf("stop: %v", err)
	}
}
