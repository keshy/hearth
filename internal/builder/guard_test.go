package builder

import (
	"strings"
	"testing"
)

func TestValidateAcceptsTemplateStyle(t *testing.T) {
	files := []File{
		{Path: "index.html", Content: `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>
<body><a href="https://en.wikipedia.org">wiki</a><script type="module" src="app.js"></script></body></html>`},
		{Path: "app.js", Content: `import { load, save } from "./lib/data.js"; const x = await load("items", []); fetch("/_api/data/items");`},
		{Path: "style.css", Content: `body { background: url("bg.svg"); }`},
	}
	if p := Validate(files); len(p) != 0 {
		t.Fatalf("unexpected problems: %v", p)
	}
}

func TestValidateRejects(t *testing.T) {
	cases := map[string][]File{
		"external script":   {{Path: "index.html", Content: `<script src="https://cdn.example.com/x.js"></script>`}},
		"protocol-relative": {{Path: "index.html", Content: `<img src="//evil.com/p.png">`}},
		"external css":      {{Path: "index.html", Content: `<link rel="stylesheet" href="https://fonts.googleapis.com/css">`}},
		"inline script":     {{Path: "index.html", Content: `<script>alert(1)</script>`}},
		"inline handler":    {{Path: "index.html", Content: `<button onclick="go()">x</button>`}},
		"remote import":     {{Path: "index.html", Content: "<p>"}, {Path: "a.js", Content: `import x from "https://esm.sh/react";`}},
		"remote fetch":      {{Path: "index.html", Content: "<p>"}, {Path: "a.js", Content: "fetch(`https://api.example.com`)"}},
		"eval":              {{Path: "index.html", Content: "<p>"}, {Path: "a.js", Content: `eval("1")`}},
		"builder api":       {{Path: "index.html", Content: "<p>"}, {Path: "a.js", Content: `fetch("/_api/builder/jobs")`}},
		"traversal":         {{Path: "index.html", Content: "<p>"}, {Path: "../x.js", Content: ""}},
		"dotfile":           {{Path: "index.html", Content: "<p>"}, {Path: ".env", Content: ""}},
		"manifest":          {{Path: "index.html", Content: "<p>"}, {Path: "app.yaml", Content: "kind: proxied"}},
		"binary type":       {{Path: "index.html", Content: "<p>"}, {Path: "run.sh", Content: "rm -rf /"}},
		"no index":          {{Path: "app.js", Content: ""}},
		"iframe":            {{Path: "index.html", Content: `<iframe src="/x"></iframe>`}},
	}
	for name, files := range cases {
		if p := Validate(files); len(p) == 0 {
			t.Errorf("%s: expected a problem", name)
		}
	}
}

func TestNormalizePaths(t *testing.T) {
	got := normalizePaths([]File{{Path: "./apps/chores/index.html"}, {Path: " js/app.js "}}, "chores")
	if got[0].Path != "index.html" || got[1].Path != "js/app.js" {
		t.Fatalf("got %+v", got)
	}
	if s := sanitizeTags([]string{"Family!", "TO-DO", "a", "b", "c"}); strings.Join(s, ",") != "family,to-do,a,b" {
		t.Fatalf("tags %v", s)
	}
}
