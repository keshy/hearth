package netinfo

import "testing"

func TestParseNetstat(t *testing.T) {
	out := []byte(`Routing tables

Internet:
Destination        Gateway            Flags               Netif Expire
default            link#26            UCSg                utun4
default            192.168.0.1        UGScIg                en0
127                127.0.0.1          UCS                   lo0
`)
	m := parseNetstat(out)
	if m["en0"] != "192.168.0.1" || len(m) != 1 {
		t.Fatalf("got %v", m)
	}
}
