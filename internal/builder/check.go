package builder

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

	"appshome/internal/registry"
)

// CheckRepo re-runs the builder's guardrails over a repo checkout: the rules
// and template must be present and valid, and every generated app must still
// pass Validate and carry the platform's own copy of each platform file.
// It returns problems keyed by what they're about ("guardrails", "template",
// or an app name).
func CheckRepo(repoDir string) map[string][]string {
	problems := map[string][]string{}
	add := func(key, format string, args ...any) {
		problems[key] = append(problems[key], fmt.Sprintf(format, args...))
	}

	if _, err := os.Stat(filepath.Join(repoDir, RulesFile)); err != nil {
		add("guardrails", "missing %s", RulesFile)
	}
	tmplDir := filepath.Join(repoDir, TemplateDir)
	tmpl, err := readFiles(tmplDir, nil)
	if err != nil {
		add("template", "can't read %s: %v", TemplateDir, err)
	}
	for _, p := range Validate(tmpl) {
		add("template", "%s", p)
	}

	apps, _ := registry.Discover(repoDir)
	for _, a := range apps {
		if !a.Generated {
			continue
		}
		dir := filepath.Join(repoDir, "apps", a.Name)
		files, err := readFiles(dir, map[string]bool{registry.ManifestFile: true})
		if err != nil {
			add(a.Name, "can't read files: %v", err)
			continue
		}
		for _, p := range Validate(files) {
			add(a.Name, "%s", p)
		}
		for _, pf := range platformFiles {
			want, err := os.ReadFile(filepath.Join(tmplDir, filepath.FromSlash(pf)))
			if err != nil {
				continue
			}
			got, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(pf)))
			if err != nil || !bytes.Equal(got, want) {
				add(a.Name, "%s differs from %s/%s; generated apps must use the platform's copy", pf, TemplateDir, pf)
			}
		}
	}
	return problems
}
