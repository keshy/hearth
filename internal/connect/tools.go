// Package connect plays songs on speakers and TVs around the house ("Hearth
// Connect"). The host finds Cast devices, turns a YouTube video into an audio
// URL with yt-dlp, hands it to the device, and keeps the queue, so playback
// carries on whatever the phone that started it does.
package connect

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// yt-dlp is the official single-file release, kept in <data>/tools and checked
// against the published checksums. It runs without a JavaScript runtime on
// purpose: with one it picks YouTube's TV client, whose links Cast speakers
// can't fetch.
const (
	ytdlpURL     = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
	ytdlpSums    = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"
	updateEvery  = 24 * time.Hour
	resolveLimit = 60 * time.Second
)

type Tools struct {
	dir  string
	http *http.Client

	mu      sync.Mutex
	ready   bool
	problem string
	updated time.Time

	cmu   sync.Mutex
	cache map[string]resolved
}

type resolved struct {
	url, contentType string
	expires          time.Time
}

func NewTools(dir string) *Tools {
	return &Tools{dir: dir, http: &http.Client{Timeout: 5 * time.Minute}, cache: map[string]resolved{}}
}

func (t *Tools) ytdlp() string { return filepath.Join(t.dir, "yt-dlp") }

// Status reports whether songs can be played and, if not, why.
func (t *Tools) Status() (bool, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.ready, t.problem
}

// Ensure installs the tools if they're missing and updates yt-dlp once a day
// (YouTube changes often, and an old yt-dlp stops working).
func (t *Tools) Ensure(ctx context.Context) error {
	err := t.ensure(ctx)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ready = err == nil
	t.problem = ""
	if err != nil {
		t.problem = err.Error()
	}
	return err
}

func (t *Tools) ensure(ctx context.Context) error {
	if runtime.GOOS != "darwin" {
		return errors.New("playing on speakers needs the macOS host")
	}
	if err := os.MkdirAll(t.dir, 0o755); err != nil {
		return err
	}
	os.Remove(filepath.Join(t.dir, "deno")) // installed by v0.6.0, no longer used
	if !executable(t.ytdlp()) {
		if err := t.installYtdlp(ctx); err != nil {
			return fmt.Errorf("installing yt-dlp: %w", err)
		}
		t.mu.Lock()
		t.updated = time.Now()
		t.mu.Unlock()
		return nil
	}
	t.mu.Lock()
	due := time.Since(t.updated) > updateEvery
	t.mu.Unlock()
	if due {
		// yt-dlp -U verifies the release signature itself.
		out, err := exec.CommandContext(ctx, t.ytdlp(), "-U").CombinedOutput()
		if err != nil {
			return fmt.Errorf("updating yt-dlp: %v: %s", err, lastLine(out))
		}
		t.mu.Lock()
		t.updated = time.Now()
		t.mu.Unlock()
	}
	return nil
}

func executable(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Mode()&0o111 != 0
}

func (t *Tools) get(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := t.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", u, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 300<<20))
}

func (t *Tools) installYtdlp(ctx context.Context) error {
	sums, err := t.get(ctx, ytdlpSums)
	if err != nil {
		return err
	}
	want := ""
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) == 2 && f[1] == "yt-dlp_macos" {
			want = f[0]
		}
	}
	if want == "" {
		return errors.New("no checksum published for yt-dlp_macos")
	}
	bin, err := t.get(ctx, ytdlpURL)
	if err != nil {
		return err
	}
	if err := checkSum(bin, want); err != nil {
		return err
	}
	return install(t.ytdlp(), bin)
}

func checkSum(b []byte, want string) error {
	got := sha256.Sum256(b)
	if !strings.EqualFold(hex.EncodeToString(got[:]), want) {
		return errors.New("checksum mismatch; not installing")
	}
	return nil
}

func install(path string, bin []byte) error {
	tmp := path + ".new"
	if err := os.WriteFile(tmp, bin, 0o755); err != nil {
		return err
	}
	// Downloaded with Go, so there is no quarantine flag to clear.
	return os.Rename(tmp, path)
}

func lastLine(b []byte) string {
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	return lines[len(lines)-1]
}

// Resolve turns a YouTube video id into a direct audio URL the speaker can
// fetch itself. URLs last a few hours and are tied to the house's public IPv4
// address, which every device at home shares.
func (t *Tools) Resolve(ctx context.Context, id string) (string, string, error) {
	t.cmu.Lock()
	if r, ok := t.cache[id]; ok && time.Until(r.expires) > 20*time.Minute {
		t.cmu.Unlock()
		return r.url, r.contentType, nil
	}
	t.cmu.Unlock()
	if ok, why := t.Status(); !ok {
		if why == "" {
			why = "still setting up the player tools"
		}
		return "", "", errors.New(why)
	}
	ctx, cancel := context.WithTimeout(ctx, resolveLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.ytdlp(),
		"--force-ipv4", "--no-warnings", "--no-playlist",
		"-f", "bestaudio[ext=m4a]/bestaudio[acodec=opus]/bestaudio",
		"--print", "%(ext)s %(url)s", "https://www.youtube.com/watch?v="+id)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := lastLine(stderr.Bytes())
		if msg == "" {
			msg = err.Error()
		}
		return "", "", fmt.Errorf("couldn't get the song: %s", msg)
	}
	ext, u, ok := strings.Cut(strings.TrimSpace(lastLine(out)), " ")
	if !ok || !strings.HasPrefix(u, "https://") {
		return "", "", errors.New("couldn't get the song: no audio link")
	}
	ct := "audio/mp4"
	if ext == "webm" {
		ct = "audio/webm"
	}
	exp := time.Now().Add(2 * time.Hour)
	if pu, err := url.Parse(u); err == nil {
		if s, err := strconv.ParseInt(pu.Query().Get("expire"), 10, 64); err == nil {
			exp = time.Unix(s, 0)
		}
	}
	t.cmu.Lock()
	t.cache[id] = resolved{url: u, contentType: ct, expires: exp}
	t.cmu.Unlock()
	return u, ct, nil
}

// Forget drops a cached URL, after a device couldn't play it.
func (t *Tools) Forget(id string) {
	t.cmu.Lock()
	delete(t.cache, id)
	t.cmu.Unlock()
}
