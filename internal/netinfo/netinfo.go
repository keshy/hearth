// Package netinfo discovers the host's LAN address and router so nothing
// about the home network has to be configured by hand.
package netinfo

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"net"
	"os/exec"
	"sort"
	"strings"
)

type Info struct {
	Interface string
	IP        net.IP
	MAC       string
	Gateway   string
	// Other LAN candidates that were not chosen, as "iface=ip".
	Others []string
}

// Virtual, VPN and peer-to-peer interfaces never carry the home LAN address.
var skipPrefixes = []string{
	"lo", "utun", "ipsec", "ppp", "gif", "stf", "awdl", "llw", "bridge",
	"anpi", "ap", "vmenet", "feth", "docker", "veth", "tun", "tap",
}

func skipped(name string) bool {
	for _, p := range skipPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// Discover returns the interface and private IPv4 address the home network
// uses to reach this host. Interfaces with a default route win; ties go to
// the lowest name (en0 before en1). prefIface and overrideIP pin the choice.
func Discover(prefIface, overrideIP string) (Info, error) {
	gws := DefaultGateways()
	ifaces, err := net.Interfaces()
	if err != nil {
		return Info{}, err
	}

	type cand struct {
		ifc net.Interface
		ip  net.IP
	}
	var cands []cand
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		if prefIface != "" && ifc.Name != prefIface {
			continue
		}
		if prefIface == "" && skipped(ifc.Name) {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 == nil || !ip4.IsPrivate() {
				continue
			}
			if overrideIP != "" && ip4.String() != overrideIP {
				continue
			}
			cands = append(cands, cand{ifc, ip4})
			break
		}
	}

	if len(cands) == 0 {
		if ip := net.ParseIP(overrideIP).To4(); ip != nil {
			return Info{IP: ip}, nil
		}
		if prefIface != "" {
			return Info{}, fmt.Errorf("interface %q has no private IPv4 address", prefIface)
		}
		return Info{}, errors.New("no private IPv4 address found on any LAN interface")
	}

	sort.SliceStable(cands, func(i, j int) bool {
		_, gi := gws[cands[i].ifc.Name]
		_, gj := gws[cands[j].ifc.Name]
		if gi != gj {
			return gi
		}
		return cands[i].ifc.Name < cands[j].ifc.Name
	})

	best := cands[0]
	info := Info{
		Interface: best.ifc.Name,
		IP:        best.ip,
		MAC:       best.ifc.HardwareAddr.String(),
		Gateway:   gws[best.ifc.Name],
	}
	for _, c := range cands[1:] {
		info.Others = append(info.Others, c.ifc.Name+"="+c.ip.String())
	}
	return info, nil
}

// DefaultGateways maps interface name to its IPv4 default gateway, using
// macOS `netstat -rn`. It returns an empty map if routes can't be read.
func DefaultGateways() map[string]string {
	out, err := exec.Command("netstat", "-rn", "-f", "inet").Output()
	if err != nil {
		return map[string]string{}
	}
	return parseNetstat(out)
}

func parseNetstat(out []byte) map[string]string {
	m := map[string]string{}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 4 || f[0] != "default" {
			continue
		}
		if ip := net.ParseIP(f[1]); ip == nil || ip.To4() == nil {
			continue
		}
		if _, seen := m[f[3]]; !seen {
			m[f[3]] = f[1]
		}
	}
	return m
}
