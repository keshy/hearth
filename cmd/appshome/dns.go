package main

import (
	"flag"
	"log"
	"net"
	"os"
	"sync/atomic"
	"time"

	"appshome/internal/dnsserver"
	"appshome/internal/netinfo"
)

func cmdDNS(args []string) error {
	fs := flag.NewFlagSet("dns", flag.ExitOnError)
	data := dataFlag(fs)
	fs.Parse(args)

	logger := log.New(os.Stderr, "dns: ", log.LstdFlags)
	cfg, _, err := loadOrDefault(*data)
	if err != nil {
		return err
	}

	var current atomic.Pointer[netinfo.Info]
	discover := func() {
		info, err := netinfo.Discover(cfg.Interface, cfg.LANIP)
		if err != nil {
			logger.Printf("LAN address not available: %v", err)
			return
		}
		if prev := current.Load(); prev == nil || !prev.IP.Equal(info.IP) {
			logger.Printf("answering *.%s with %s (%s)", cfg.Domain, info.IP, info.Interface)
		}
		current.Store(&info)
	}
	discover()
	ip := func() net.IP {
		if i := current.Load(); i != nil {
			return i.IP
		}
		return nil
	}

	ups := cfg.UpstreamDNS
	if len(ups) == 0 {
		if i := current.Load(); i != nil && i.Gateway != "" {
			ups = append(ups, i.Gateway)
		}
		ups = append(ups, "1.1.1.1", "8.8.8.8")
	}
	ups = dnsserver.NormalizeUpstreams(ups, ip())
	logger.Printf("forwarding other names to %v", ups)

	h := &dnsserver.Handler{Domain: cfg.Domain, IP: ip, Upstreams: ups, Log: logger}

	addr := cfg.DNSListen
	pinned := net.IP(nil)
	if addr == "" {
		addr = ":53"
	}
	pc, ln, err := dnsserver.Listen(addr)
	if err != nil && cfg.DNSListen == "" && ip() != nil {
		// Another resolver may already own 127.0.0.1:53; binding the LAN IP
		// alone still serves the network (requires root on macOS).
		logger.Printf("%s unavailable (%v); trying %s:53", addr, err, ip())
		pinned = ip()
		addr = net.JoinHostPort(pinned.String(), "53")
		pc, ln, err = dnsserver.Listen(addr)
	}
	if err != nil {
		return err
	}

	go func() {
		for range time.Tick(15 * time.Second) {
			discover()
			// A socket bound to the old IP can't follow a change; exit and let
			// launchd restart us on the new address.
			if pinned != nil && !pinned.Equal(ip()) {
				logger.Printf("LAN IP changed from %s to %s; restarting", pinned, ip())
				os.Exit(1)
			}
		}
	}()

	logger.Printf("listening on %s (udp+tcp)", addr)
	return dnsserver.Serve(pc, ln, h)
}
