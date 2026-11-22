package deploy

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Git runs git in Dir and returns trimmed stdout.
func Git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), msg)
	}
	return strings.TrimSpace(out.String()), nil
}

func IsGitRepo(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

// EnsureClone clones url into dir (branch only) if dir isn't a repo yet.
func EnsureClone(ctx context.Context, url, branch, dir string) error {
	if IsGitRepo(dir) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return err
	}
	_, err := Git(ctx, filepath.Dir(dir), "clone", "--branch", branch, url, dir)
	return err
}

type Commit struct {
	SHA     string    `json:"sha"`
	Subject string    `json:"subject"`
	Time    time.Time `json:"time"`
}

func (c Commit) Short() string {
	if len(c.SHA) > 8 {
		return c.SHA[:8]
	}
	return c.SHA
}

func commitInfo(ctx context.Context, dir, rev string) (Commit, error) {
	out, err := Git(ctx, dir, "log", "-1", "--format=%H%x00%ct%x00%s", rev)
	if err != nil {
		return Commit{}, err
	}
	parts := strings.SplitN(out, "\x00", 3)
	if len(parts) != 3 {
		return Commit{}, fmt.Errorf("unexpected git log output %q", out)
	}
	ts, _ := strconv.ParseInt(parts[1], 10, 64)
	return Commit{SHA: parts[0], Time: time.Unix(ts, 0), Subject: parts[2]}, nil
}

// pathTimes returns the first and last commit times touching path.
func pathTimes(ctx context.Context, dir, path string) (first, last time.Time) {
	out, err := Git(ctx, dir, "log", "--format=%ct", "--", path)
	if err != nil || out == "" {
		return
	}
	lines := strings.Split(out, "\n")
	parse := func(s string) time.Time {
		ts, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		return time.Unix(ts, 0)
	}
	return parse(lines[len(lines)-1]), parse(lines[0])
}
