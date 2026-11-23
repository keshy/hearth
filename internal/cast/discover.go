package cast

import (
	"bufio"
	"bytes"
	"context"
	"net"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Device is a Cast receiver found on the LAN.
type Device struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Model string `json:"model,omitempty"`
	Addr  string `json:"-"` // host:port
	// Audio-only devices (speakers, speaker groups) have no screen.
	AudioOnly bool `json:"audioOnly"`
}

// Discover lists Cast devices through the system's mDNS responder (dns-sd on
// macOS). Asking it, rather than sending our own queries, works with Google
// speakers, which only answer the responder's multicast queries, and needs no
// local-network permission.
func Discover(ctx context.Context, wait time.Duration) ([]Device, error) {
	out, err := runFor(ctx, wait, "dns-sd", "-Z", "_googlecast._tcp", "local.")
	if err != nil && len(out) == 0 {
		return nil, err
	}
	found := parseZone(out)
	var wg sync.WaitGroup
	for i := range found {
		wg.Add(1)
		go func(e *zoneEntry) {
			defer wg.Done()
			if a, _ := runFor(ctx, 1500*time.Millisecond, "dns-sd", "-G", "v4", e.target); len(a) > 0 {
				e.ip = parseAddr(a, e.target)
			}
		}(&found[i])
	}
	wg.Wait()

	var devices []Device
	for _, e := range found {
		if e.ip != "" {
			devices = append(devices, e.device())
		}
	}
	sort.Slice(devices, func(i, j int) bool { return strings.ToLower(devices[i].Name) < strings.ToLower(devices[j].Name) })
	return devices, nil
}

// runFor runs a command that never exits on its own and returns what it
// printed in the time allowed.
func runFor(ctx context.Context, d time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, d)
	defer cancel()
	var buf bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = &buf
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		err = nil
	}
	return buf.Bytes(), err
}

type zoneEntry struct {
	instance, target string
	port             int
	txt              map[string]string
	ip               string
}

func (e zoneEntry) device() Device {
	d := Device{ID: e.txt["id"], Name: e.txt["fn"], Model: e.txt["md"], Addr: net.JoinHostPort(e.ip, strconv.Itoa(e.port))}
	if d.ID == "" {
		d.ID = e.instance
	}
	if d.Name == "" {
		d.Name = d.Model
	}
	// ca is a capability bitmask; bit 0 is video out.
	if ca, err := strconv.Atoi(e.txt["ca"]); err == nil {
		d.AudioOnly = ca&1 == 0
	}
	return d
}

var txtRE = regexp.MustCompile(`"((?:[^"\\]|\\.)*)"`)

// parseZone reads `dns-sd -Z` output: an SRV and a TXT line per instance.
func parseZone(out []byte) []zoneEntry {
	byName := map[string]*zoneEntry{}
	var order []string
	get := func(name string) *zoneEntry {
		if byName[name] == nil {
			byName[name] = &zoneEntry{instance: name, txt: map[string]string{}}
			order = append(order, name)
		}
		return byName[name]
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 64<<10), 64<<10)
	for sc.Scan() {
		line := sc.Text()
		f := strings.Fields(line)
		if len(f) < 3 || strings.HasPrefix(line, ";") {
			continue
		}
		switch f[1] {
		case "SRV":
			if len(f) >= 6 {
				e := get(f[0])
				e.port, _ = strconv.Atoi(f[4])
				e.target = f[5]
			}
		case "TXT":
			e := get(f[0])
			for _, m := range txtRE.FindAllStringSubmatch(line, -1) {
				kv := strings.NewReplacer(`\"`, `"`, `\\`, `\`).Replace(m[1])
				if k, v, ok := strings.Cut(kv, "="); ok {
					e.txt[k] = v
				}
			}
		}
	}
	var entries []zoneEntry
	for _, n := range order {
		if e := byName[n]; e.target != "" && e.port > 0 {
			entries = append(entries, *e)
		}
	}
	return entries
}

// parseAddr reads `dns-sd -G v4 host` output and returns the first address.
func parseAddr(out []byte, host string) string {
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		for i := 0; i+1 < len(f); i++ {
			if strings.EqualFold(f[i], host) {
				if ip := net.ParseIP(f[i+1]); ip != nil && ip.To4() != nil {
					return ip.String()
				}
			}
		}
	}
	return ""
}
