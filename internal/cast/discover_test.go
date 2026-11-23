package cast

import "testing"

// Captured from `dns-sd -Z _googlecast._tcp local.` on the home Mac mini.
const zone = `Browsing for _googlecast._tcp.local.
DATE: ---Mon 23 Nov 2026---
14:59:25.671  ...STARTING...

; To direct clients to browse a different domain, substitute that domain in place of '@'
lb._dns-sd._udp                                 PTR     @

_googlecast._tcp                                PTR     Google-Home-Mini-59a560b6cf28f23c824487d546021b88._googlecast._tcp
Google-Home-Mini-59a560b6cf28f23c824487d546021b88._googlecast._tcp SRV     0 0 8009 59a560b6-cf28-f23c-8244-87d546021b88.local. ; Replace with unicast FQDN of target host
Google-Home-Mini-59a560b6cf28f23c824487d546021b88._googlecast._tcp TXT     "id=59a560b6cf28f23c824487d546021b88" "cd=1E37314D67BCDB8AAA22F7F3F6625C8E" "rm=E9F31277452A0726" "ve=05" "md=Google Home Mini" "ic=/setup/icon.png" "fn=Living Room speaker" "ca=199172" "st=0" "bs=FA8FCA6CAA8A" "nf=1" "rs="
Chromecast-abc._googlecast._tcp SRV     0 0 8009 abc.local. ; Replace with unicast FQDN of target host
Chromecast-abc._googlecast._tcp TXT     "id=abc" "md=Chromecast" "fn=Family \"TV\"" "ca=201221"
`

const addr = `DATE: ---Mon 23 Nov 2026---
14:59:28.190  ...STARTING...
Timestamp     A/R  Flags         IF  Hostname                               Address                                      TTL
14:59:28.191  Add  40000002      12  59a560b6-cf28-f23c-8244-87d546021b88.local. 192.168.0.107                                120
`

func TestParseZone(t *testing.T) {
	es := parseZone([]byte(zone))
	if len(es) != 2 {
		t.Fatalf("got %d entries: %+v", len(es), es)
	}
	es[0].ip = "192.168.0.107"
	d := es[0].device()
	want := Device{ID: "59a560b6cf28f23c824487d546021b88", Name: "Living Room speaker", Model: "Google Home Mini", Addr: "192.168.0.107:8009", AudioOnly: true}
	if d != want || es[0].target != "59a560b6-cf28-f23c-8244-87d546021b88.local." {
		t.Fatalf("got %+v (target %s)", d, es[0].target)
	}
	es[1].ip = "192.168.0.9"
	if d := es[1].device(); d.Name != `Family "TV"` || d.AudioOnly {
		t.Fatalf("got %+v", d)
	}
}

func TestParseAddr(t *testing.T) {
	if got := parseAddr([]byte(addr), "59a560b6-cf28-f23c-8244-87d546021b88.local."); got != "192.168.0.107" {
		t.Fatalf("got %q", got)
	}
	if got := parseAddr([]byte(addr), "other.local."); got != "" {
		t.Fatalf("got %q for an unknown host", got)
	}
}
