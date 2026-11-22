package main

import (
	"flag"
	"fmt"
	"sort"

	"appshome/internal/builder"
	"appshome/internal/registry"
)

// cmdCheck validates a repo checkout without any running services, for CI
// and before pushing.
func cmdCheck(args []string) error {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	repo := fs.String("repo", ".", "repo checkout to check (the folder containing apps/)")
	fs.Parse(args)

	apps, problems := registry.Discover(*repo)
	all := map[string][]string{}
	for name, p := range problems {
		all[name] = append(all[name], p)
	}
	for key, ps := range builder.CheckRepo(*repo) {
		all[key] = append(all[key], ps...)
	}

	for _, a := range apps {
		if _, bad := all[a.Name]; !bad {
			label := string(a.Kind)
			if a.Generated {
				label += ", generated"
			}
			fmt.Printf("ok    %-20s %s\n", a.Name, label)
		}
	}
	keys := make([]string, 0, len(all))
	for k := range all {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	count := 0
	for _, k := range keys {
		for _, p := range all[k] {
			fmt.Printf("FAIL  %-20s %s\n", k, p)
			count++
		}
	}
	if count > 0 {
		return fmt.Errorf("%d problem(s)", count)
	}
	fmt.Printf("%d app(s), guardrails and template valid\n", len(apps))
	return nil
}
