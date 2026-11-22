// Package dnsserver answers the apps domain (and every subdomain) with the
// host's current LAN IP and forwards all other queries upstream.
package dnsserver

import (
	"log"
	"net"
	"strings"
	"time"

	"github.com/miekg/dns"
)

type Handler struct {
	Domain    string
	IP        func() net.IP
	Upstreams []string
	Timeout   time.Duration
	Log       *log.Logger
}

func (h *Handler) IsLocal(name string) bool {
	n := strings.TrimSuffix(strings.ToLower(name), ".")
	d := strings.ToLower(h.Domain)
	return n == d || strings.HasSuffix(n, "."+d)
}

func (h *Handler) ServeDNS(w dns.ResponseWriter, r *dns.Msg) {
	if len(r.Question) == 1 && h.IsLocal(r.Question[0].Name) {
		_ = w.WriteMsg(h.local(r))
		return
	}
	_ = w.WriteMsg(h.forward(r, network(w)))
}

func (h *Handler) local(r *dns.Msg) *dns.Msg {
	m := new(dns.Msg)
	m.SetReply(r)
	m.Authoritative = true
	q := r.Question[0]
	if q.Qtype == dns.TypeA || q.Qtype == dns.TypeANY {
		if ip := h.IP(); ip != nil {
			m.Answer = append(m.Answer, &dns.A{
				Hdr: dns.RR_Header{Name: q.Name, Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 60},
				A:   ip.To4(),
			})
		}
	}
	return m
}

func (h *Handler) forward(r *dns.Msg, netw string) *dns.Msg {
	timeout := h.Timeout
	if timeout == 0 {
		timeout = 2 * time.Second
	}
	for _, up := range h.Upstreams {
		c := &dns.Client{Net: netw, Timeout: timeout}
		resp, _, err := c.Exchange(r, up)
		if err == nil && resp != nil {
			return resp
		}
		if h.Log != nil {
			h.Log.Printf("upstream %s failed: %v", up, err)
		}
	}
	m := new(dns.Msg)
	m.SetRcode(r, dns.RcodeServerFailure)
	return m
}

func network(w dns.ResponseWriter) string {
	if _, ok := w.RemoteAddr().(*net.TCPAddr); ok {
		return "tcp"
	}
	return "udp"
}

// NormalizeUpstreams adds :53 where missing and drops the host's own IP so
// forwarding can never loop back to this server.
func NormalizeUpstreams(in []string, self net.IP) []string {
	var out []string
	seen := map[string]bool{}
	for _, u := range in {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		host := u
		if h, _, err := net.SplitHostPort(u); err == nil {
			host = h
		} else {
			u = net.JoinHostPort(u, "53")
		}
		if self != nil && net.ParseIP(host).Equal(self) {
			continue
		}
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

// Listen binds UDP and TCP on addr.
func Listen(addr string) (net.PacketConn, net.Listener, error) {
	pc, err := net.ListenPacket("udp", addr)
	if err != nil {
		return nil, nil, err
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		pc.Close()
		return nil, nil, err
	}
	return pc, ln, nil
}

// Serve blocks until either the UDP or TCP server stops.
func Serve(pc net.PacketConn, ln net.Listener, h dns.Handler) error {
	errc := make(chan error, 2)
	udp := &dns.Server{PacketConn: pc, Handler: h}
	tcp := &dns.Server{Listener: ln, Handler: h}
	go func() { errc <- udp.ActivateAndServe() }()
	go func() { errc <- tcp.ActivateAndServe() }()
	return <-errc
}
