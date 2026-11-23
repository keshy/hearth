package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/miekg/dns"

	"appshome/internal/config"
	"appshome/internal/netinfo"
)

type report struct{ failures, warnings int }

func (r *report) ok(format string, a ...any) { fmt.Printf("  ok    "+format+"\n", a...) }
func (r *report) warn(format string, a ...any) {
	r.warnings++
	fmt.Printf("  WARN  "+format+"\n", a...)
}
func (r *report) fail(format string, a ...any) {
	r.failures++
	fmt.Printf("  FAIL  "+format+"\n", a...)
}
func (r *report) info(format string, a ...any) { fmt.Printf("        "+format+"\n", a...) }

func cmdDoctor(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ExitOnError)
	data := dataFlag(fs)
	fs.Parse(args)
	r := &report{}

	fmt.Println("Config")
	cfg, existed, err := loadOrDefault(*data)
	switch {
	case err != nil:
		r.fail("%v", err)
		return fmt.Errorf("fix the config first")
	case !existed:
		r.fail("no config at %s; run: appshome init --data %q", cfg.Path(), cfg.DataDir)
	default:
		r.ok("%s (domain %s)", cfg.Path(), cfg.Domain)
	}
	if cfg.AdminPasswordHash == "" {
		r.warn("admin password not set; run: appshome set-password --data %q", cfg.DataDir)
	} else {
		r.ok("admin password set")
	}

	fmt.Println("\nNetwork (auto-detected)")
	info, err := netinfo.Discover(cfg.Interface, cfg.LANIP)
	if err != nil {
		r.fail("%v", err)
	} else {
		r.ok("LAN IP %s on %s, MAC %s", info.IP, orDash(info.Interface), orDash(info.MAC))
		if info.Gateway != "" {
			r.ok("router %s", info.Gateway)
		} else {
			r.warn("no default route on %s; is this Mac connected to the home network?", orDash(info.Interface))
		}
		if len(info.Others) > 0 {
			r.warn("other LAN addresses %v; pin one with: appshome init --interface NAME", info.Others)
		}
		if randomizedMAC(info.MAC) {
			r.warn("%s uses a randomized (Private Wi-Fi) address, so a router reservation may not stick;", info.MAC)
			r.info("turn off Private Wi-Fi Address for this network (System Settings > Wi-Fi > Details) or use Ethernet")
		}
	}

	fmt.Println("\nDNS")
	checkDNS(r, cfg, info.IP)

	fmt.Println("\nApps repo")
	checkRepo(r, cfg)

	fmt.Println("\nBuilder (Gemini on Vertex AI)")
	checkBuilder(r, cfg)

	fmt.Println("\nSpeakers and TVs (Hearth Connect)")
	checkConnect(r, cfg)

	fmt.Println("\nCaddy")
	checkHTTP(r, "admin API", "http://"+cfg.CaddyAdmin+"/config/", nil)
	if _, err := os.Stat(cfg.RootCertPath()); err != nil {
		r.warn("root certificate not created yet (%s); it appears after Caddy's first HTTPS request", cfg.RootCertPath())
	} else {
		r.ok("root certificate %s", cfg.RootCertPath())
		checkHTTPS(r, cfg)
	}

	fmt.Println("\nPortal service")
	checkHTTP(r, "portal/admin server", "http://"+cfg.AppListen+"/api/status", nil)

	fmt.Println("\nThis Mac's own lookups")
	if addrs, err := net.LookupHost(cfg.Domain); err == nil && info.IP != nil && contains(addrs, info.IP.String()) {
		r.ok("%s resolves to %s through the system resolver", cfg.Domain, info.IP)
	} else {
		r.info("%s doesn't resolve here yet; expected until the router hands out this Mac as DNS", cfg.Domain)
	}

	if info.IP != nil {
		ip := info.IP.String()
		fmt.Println("\nRouter settings (TP-Link: Advanced → Network → DHCP Server)")
		if info.MAC != "" {
			r.info("1. Address Reservation: reserve %s for MAC %s", ip, info.MAC)
		} else {
			r.info("1. Address Reservation: reserve %s for this Mac", ip)
		}
		r.info("2. Primary DNS: %s   Secondary DNS: leave empty", ip)
		r.info("3. On each device, open %s once and install the certificate", cfg.TrustURL())
		r.info("4. Bookmark %s", cfg.PortalURL())
	}

	fmt.Printf("\n%d failure(s), %d warning(s)\n", r.failures, r.warnings)
	if r.failures > 0 {
		return fmt.Errorf("doctor found %d problem(s)", r.failures)
	}
	return nil
}

func checkDNS(r *report, cfg config.Config, ip net.IP) {
	target := cfg.DNSListen
	if target == "" {
		host := "127.0.0.1"
		if ip != nil {
			host = ip.String()
		}
		target = net.JoinHostPort(host, "53")
	} else if h, p, err := net.SplitHostPort(target); err == nil && (h == "" || h == "0.0.0.0") {
		target = net.JoinHostPort("127.0.0.1", p)
	}

	c := &dns.Client{Timeout: 2 * time.Second}
	q := new(dns.Msg)
	q.SetQuestion(dns.Fqdn("doctor-check."+cfg.Domain), dns.TypeA)
	resp, _, err := c.Exchange(q, target)
	if err != nil {
		r.fail("no answer from %s: %v", target, err)
		r.info("is the DNS service running? Another process on port 53? check: sudo lsof -nP -i :53")
		return
	}
	var got []string
	for _, rr := range resp.Answer {
		if a, ok := rr.(*dns.A); ok {
			got = append(got, a.A.String())
		}
	}
	switch {
	case len(got) == 0:
		r.fail("%s answered *.%s with no address", target, cfg.Domain)
	case ip != nil && !contains(got, ip.String()):
		r.fail("%s answered *.%s with %v, expected %s", target, cfg.Domain, got, ip)
	default:
		r.ok("%s answers *.%s with %s", target, cfg.Domain, strings.Join(got, ", "))
	}

	q = new(dns.Msg)
	q.SetQuestion("example.com.", dns.TypeA)
	if resp, _, err := c.Exchange(q, target); err != nil || resp.Rcode != dns.RcodeSuccess {
		r.fail("%s didn't forward example.com upstream (err=%v)", target, err)
	} else {
		r.ok("forwards other names upstream")
	}
}

func checkHTTP(r *report, name, url string, client *http.Client) {
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	resp, err := client.Get(url)
	if err != nil {
		r.fail("%s: %v", name, err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		r.fail("%s: %s returned %s", name, url, resp.Status)
		return
	}
	r.ok("%s reachable (%s)", name, url)
}

// checkHTTPS hits the portal through Caddy on this host, verifying the chain
// against Caddy's own root, exactly as a device that trusts it would.
func checkHTTPS(r *report, cfg config.Config) {
	pem, err := os.ReadFile(cfg.RootCertPath())
	if err != nil {
		r.fail("read root cert: %v", err)
		return
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(pem)
	local := net.JoinHostPort("127.0.0.1", strconv.Itoa(cfg.HTTPSPort))
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool},
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, local)
			},
		},
	}
	checkHTTP(r, "HTTPS portal with trusted certificate", cfg.PortalURL()+"/api/status", client)
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
