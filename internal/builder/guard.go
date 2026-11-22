package builder

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

const (
	maxFiles     = 40
	maxFileBytes = 300 << 10
	maxTotal     = 1536 << 10
)

var allowedExt = map[string]bool{
	".html": true, ".css": true, ".js": true, ".mjs": true, ".json": true,
	".svg": true, ".txt": true, ".md": true, ".webmanifest": true,
}

var safePathRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$`)

type rule struct {
	re  *regexp.Regexp
	msg string
}

// Generated apps are also served with a strict CSP; these checks catch the
// same things earlier so the model can fix them before anything ships.
var rules = []rule{
	{regexp.MustCompile(`(?i)\b(src|srcset|poster|data)\s*=\s*["']?\s*(https?:)?//`), "loads a resource from another host"},
	{regexp.MustCompile(`(?i)<link\b[^>]*\bhref\s*=\s*["']?\s*(https?:)?//`), "links a stylesheet or resource from another host"},
	{regexp.MustCompile(`(?i)url\(\s*["']?\s*(https?:)?//`), "uses a CSS url() from another host"},
	{regexp.MustCompile(`(?i)@import\s+(url\()?\s*["']?\s*(https?:)?//`), "imports CSS from another host"},
	{regexp.MustCompile(`(?i)\bimport\b[^;\n]*?["'](https?:)?//`), "imports a module from another host"},
	{regexp.MustCompile(`(?i)\b(fetch|EventSource)\s*\(\s*["'` + "`" + `](https?:)?//`), "calls another host"},
	{regexp.MustCompile(`(?i)new\s+WebSocket\s*\(`), "opens a WebSocket"},
	{regexp.MustCompile(`(?i)\beval\s*\(`), "uses eval()"},
	{regexp.MustCompile(`(?i)new\s+Function\s*\(`), "uses new Function()"},
	{regexp.MustCompile(`(?i)document\.cookie`), "touches cookies"},
	{regexp.MustCompile(`(?i)<(iframe|object|embed|base)\b`), "uses <iframe>, <object>, <embed> or <base>"},
	{regexp.MustCompile(`(?i)\bjavascript:`), "uses a javascript: URL"},
	{regexp.MustCompile(`(?i)<[a-z][^>]*\son[a-z]+\s*=`), "uses an inline event handler (onclick=...); attach listeners in a .js file"},
}

var (
	scriptTagRE = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script>`)
	srcAttrRE   = regexp.MustCompile(`(?i)\bsrc\s*=`)
	apiRefRE    = regexp.MustCompile(`/_api/([A-Za-z]*)`)
)

// Validate enforces the builder guardrails on a generated file set and
// returns human-readable problems (empty means OK).
func Validate(files []File) []string {
	var problems []string
	add := func(format string, a ...any) { problems = append(problems, fmt.Sprintf(format, a...)) }

	if len(files) == 0 {
		return []string{"no files were returned"}
	}
	if len(files) > maxFiles {
		add("too many files (%d); the limit is %d", len(files), maxFiles)
	}
	seen := map[string]bool{}
	total := 0
	hasIndex := false
	for _, f := range files {
		p := f.Path
		switch {
		case !safePathRE.MatchString(p) || path.Clean(p) != p:
			add("%s: path must be relative, use only letters, digits, . _ - and /, and not start with a dot", p)
			continue
		case seen[p]:
			add("%s: listed twice", p)
			continue
		case p == "app.yaml":
			add("app.yaml: the platform writes this file; leave it out")
			continue
		case !allowedExt[strings.ToLower(path.Ext(p))]:
			add("%s: file type not allowed (use .html, .css, .js, .mjs, .json, .svg, .txt, .md)", p)
			continue
		}
		seen[p] = true
		if p == "index.html" {
			hasIndex = true
		}
		if len(f.Content) > maxFileBytes {
			add("%s: larger than %d KB", p, maxFileBytes>>10)
		}
		total += len(f.Content)

		for _, r := range rules {
			if loc := r.re.FindStringIndex(f.Content); loc != nil {
				add("%s: %s (near %q)", p, r.msg, snippet(f.Content, loc[0]))
			}
		}
		if strings.HasSuffix(p, ".html") {
			for _, m := range scriptTagRE.FindAllStringSubmatch(f.Content, -1) {
				if !srcAttrRE.MatchString(m[1]) && strings.TrimSpace(m[2]) != "" {
					add("%s: inline <script> is blocked; move the code into a .js file", p)
					break
				}
			}
		}
		for _, m := range apiRefRE.FindAllStringSubmatch(f.Content, -1) {
			if m[1] != "data" {
				add("%s: only /_api/data is available to apps (found /_api/%s)", p, m[1])
				break
			}
		}
	}
	if !hasIndex {
		add("index.html is required at the root")
	}
	if total > maxTotal {
		add("files total %d KB; the limit is %d KB", total>>10, maxTotal>>10)
	}
	return problems
}

func snippet(s string, at int) string {
	end := at + 40
	if end > len(s) {
		end = len(s)
	}
	return strings.ReplaceAll(s[at:end], "\n", " ")
}
