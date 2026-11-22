package dnsserver

import (
	"net"
	"testing"

	"github.com/miekg/dns"
)

func TestLocalAnswers(t *testing.T) {
	h := &Handler{Domain: "apps.home", IP: func() net.IP { return net.ParseIP("192.168.0.50") }}
	pc, ln, err := Listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go Serve(pc, ln, h)

	for _, name := range []string{"apps.home.", "admin.apps.home.", "Recipes.Apps.Home."} {
		q := new(dns.Msg)
		q.SetQuestion(name, dns.TypeA)
		resp, err := dns.Exchange(q, pc.LocalAddr().String())
		if err != nil {
			t.Fatal(err)
		}
		if len(resp.Answer) != 1 || resp.Answer[0].(*dns.A).A.String() != "192.168.0.50" {
			t.Errorf("%s: got %v", name, resp.Answer)
		}
	}

	q := new(dns.Msg)
	q.SetQuestion("recipes.apps.home.", dns.TypeAAAA)
	resp, _ := dns.Exchange(q, pc.LocalAddr().String())
	if resp.Rcode != dns.RcodeSuccess || len(resp.Answer) != 0 {
		t.Errorf("AAAA should be an empty success, got %v", resp)
	}
}

func TestIsLocal(t *testing.T) {
	h := &Handler{Domain: "apps.home"}
	if h.IsLocal("notapps.home.") || h.IsLocal("home.") || !h.IsLocal("a.b.apps.home") {
		t.Fatal("suffix matching is wrong")
	}
}

func TestNormalizeUpstreams(t *testing.T) {
	got := NormalizeUpstreams([]string{"192.168.0.1", "192.168.0.50", "1.1.1.1:53", "1.1.1.1"}, net.ParseIP("192.168.0.50"))
	want := []string{"192.168.0.1:53", "1.1.1.1:53"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v want %v", got, want)
	}
}
