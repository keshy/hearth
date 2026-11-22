package caddy

import (
	"strings"
	"testing"

	"appshome/internal/config"
	"appshome/internal/registry"
)

func TestRender(t *testing.T) {
	cfg := config.Defaults("/data dir")
	apps := []registry.App{
		{Name: "recipes", Kind: registry.KindStatic},
		{Name: "chores", Kind: registry.KindStatic, Generated: true},
		{Name: "builder", Kind: registry.KindStatic, Private: true, Capabilities: []string{"builder"}},
		{Name: "nas", Kind: registry.KindProxied, Upstream: "https://192.168.0.5:5001", UpstreamInsecure: true},
		{Name: "photos", Kind: registry.KindHybrid, Upstream: "http://192.168.0.60:8000", APIPrefix: "/api"},
		{Name: "plex", Kind: registry.KindLink, URL: "http://192.168.0.20:32400/web"},
	}
	out := Render(Input{Cfg: cfg, Apps: apps, AdminHash: "$2a$10$hash",
		LiveDir: func(n string) string { return "/data dir/live/" + n }})

	for _, want := range []string{
		"local_certs",
		`storage file_system "/data dir/caddy"`,
		"apps.home, admin.apps.home {\n\treverse_proxy 127.0.0.1:7070 {\n\t\theader_up -X-Apps-Home-App",
		"http://apps.home {",
		`root * "/data dir/live/recipes"`,
		"recipes.apps.home {\n\thandle /_api/* {\n\t\treverse_proxy 127.0.0.1:7070 {\n\t\t\theader_up X-Apps-Home-App recipes",
		"chores.apps.home {\n\theader Content-Security-Policy \"default-src 'self';",
		"builder.apps.home {\n\tbasic_auth {\n\t\tadmin $2a$10$hash",
		"nas.apps.home {\n\treverse_proxy https://192.168.0.5:5001 {",
		"tls_insecure_skip_verify",
		"@api path /api /api/*",
		"*.apps.home {\n\tredir https://apps.home/?missing={labels.2} 302",
		"plex.apps.home {\n\tredir \"http://192.168.0.20:32400/web\"\n}",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Caddyfile missing %q\n---\n%s", want, out)
		}
	}
	recipes := strings.SplitN(strings.SplitN(out, "recipes.apps.home {", 2)[1], "\n}\n", 2)[0]
	if strings.Contains(recipes, "Content-Security-Policy") {
		t.Error("hand-written apps should not get the generated-app CSP")
	}
}
