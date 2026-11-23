package connect

import (
	"context"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"appshome/internal/cast"
	"appshome/internal/cast/casttest"
)

// A stand-in yt-dlp that "resolves" a video to https://example.test/<id>.
const fakeYtdlp = `#!/bin/sh
for a; do last=$a; done
echo "m4a https://example.test/${last##*v=}?expire=4102444800"
`

func newTestHub(t *testing.T) (*Hub, *casttest.Device) {
	t.Helper()
	dev, err := casttest.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(dev.Close)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "yt-dlp"), []byte(fakeYtdlp), 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := NewHub(ctx, dir, log.New(io.Discard, "", 0))
	h.Tools.ready = true
	h.discover = func(context.Context, time.Duration) ([]cast.Device, error) {
		return []cast.Device{{ID: "spk", Name: "Living Room speaker", Model: "Google Home Mini", Addr: dev.Addr(), AudioOnly: true}}, nil
	}
	return h, dev
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

var queue = []Song{{ID: "AzTnnAfiqMg", Title: "Lingashtakam", By: "SPB"}, {ID: "BBBBBBBBBBB", Title: "Second", By: "Someone"}}

func TestHubPlaysQueue(t *testing.T) {
	h, dev := newTestHub(t)
	ctx := context.Background()
	if ds := h.Devices(ctx, true); len(ds) != 1 || ds[0].Name != "Living Room speaker" || ds[0].Status != nil {
		t.Fatalf("devices %+v", ds)
	}
	if _, err := h.Play(ctx, "spk", queue, 0); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "first song", func() bool { st, _ := h.Status("spk"); return st.State == "playing" })
	if got := dev.Loads(); len(got) != 1 || !strings.HasPrefix(got[0], "https://example.test/AzTnnAfiqMg") {
		t.Fatalf("loads %v", got)
	}

	dev.Finish()
	waitFor(t, "second song", func() bool { return len(dev.Loads()) == 2 })
	waitFor(t, "playing again", func() bool { st, _ := h.Status("spk"); return st.State == "playing" && st.Index == 1 })

	if st, err := h.Control(ctx, "spk", "pause"); err != nil || st.State != "paused" {
		t.Fatalf("pause: %+v %v", st, err)
	}
	if st, err := h.Control(ctx, "spk", "resume"); err != nil || st.State != "playing" {
		t.Fatalf("resume: %+v %v", st, err)
	}
	if _, err := h.Volume(ctx, "spk", 0.25); err != nil {
		t.Fatal(err)
	}
	if ds := h.Devices(ctx, false); ds[0].Status == nil || ds[0].Status.Song.Title != "Second" || ds[0].Status.Volume != 0.25 {
		t.Fatalf("devices %+v", ds[0].Status)
	}

	dev.Finish() // the last song ends
	waitFor(t, "idle at the end", func() bool { st, _ := h.Status("spk"); return st.State == "idle" })

	if _, err := h.Control(ctx, "spk", "prev"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "back to the first song", func() bool { return len(dev.Loads()) == 3 })
	if st, err := h.Control(ctx, "spk", "stop"); err != nil || st.State != "idle" {
		t.Fatalf("stop: %+v %v", st, err)
	}
	if _, _, running := dev.State(); running {
		t.Fatal("the media player is still running after stop")
	}
}

func TestHubSkipsBrokenSong(t *testing.T) {
	h, dev := newTestHub(t)
	dev.FailURL("https://example.test/AzTnnAfiqMg?expire=4102444800")
	if _, err := h.Play(context.Background(), "spk", queue, 0); err != nil {
		t.Fatal(err)
	}
	// One retry with a fresh link, then on to the next song.
	waitFor(t, "the next song", func() bool { st, _ := h.Status("spk"); return st.Index == 1 && st.State == "playing" })
	if got := dev.Loads(); len(got) != 3 {
		t.Fatalf("loads %v", got)
	}
}

func TestHubRejects(t *testing.T) {
	h, _ := newTestHub(t)
	ctx := context.Background()
	if _, err := h.Play(ctx, "spk", []Song{{ID: "../etc", Title: "x"}}, 0); !errors.Is(err, ErrBadQueue) {
		t.Fatalf("bad id: %v", err)
	}
	if _, err := h.Play(ctx, "nope", queue, 0); !errors.Is(err, ErrNoDevice) {
		t.Fatalf("unknown device: %v", err)
	}
	if _, err := h.Control(ctx, "spk", "pause"); !errors.Is(err, ErrIdle) {
		t.Fatalf("pause with nothing playing: %v", err)
	}
}

func TestResolveCaches(t *testing.T) {
	h, _ := newTestHub(t)
	u, ct, err := h.Tools.Resolve(context.Background(), "AzTnnAfiqMg")
	if err != nil || ct != "audio/mp4" || u != "https://example.test/AzTnnAfiqMg?expire=4102444800" {
		t.Fatalf("%q %q %v", u, ct, err)
	}
	os.Remove(h.Tools.ytdlp())
	if _, _, err := h.Tools.Resolve(context.Background(), "AzTnnAfiqMg"); err != nil {
		t.Fatalf("not cached: %v", err)
	}
}
