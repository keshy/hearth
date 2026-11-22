// Command appshome runs the apps-home portal, admin UI, DNS responder and
// diagnostics. See README.md for how the pieces fit together.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"

	"appshome/internal/config"
)

var version = "dev"

const usage = `appshome: a single front door for the apps on your home network.

Usage:
  appshome init         [--data DIR] [flags]  create or update config, write the Caddyfile
  appshome serve        [--data DIR]          run the portal, dashboard and deployer; keep Caddy in sync
  appshome deploy       [--data DIR] [--force] deploy the latest commit now
  appshome dns          [--data DIR]          answer *.<domain> with this host's LAN IP (needs port 53)
  appshome doctor       [--data DIR]          check every piece and print router settings
  appshome set-password [--data DIR]          set the admin password (user: admin)
  appshome caddyfile    [--data DIR]          print the generated Caddyfile
  appshome check        [--repo DIR]          validate app manifests and generated apps (for CI)
  appshome version

Default data dir: %s (override with --data or APPS_HOME_DATA)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usage, config.DefaultDataDir())
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "init":
		err = cmdInit(args)
	case "serve":
		err = cmdServe(args)
	case "deploy":
		err = cmdDeploy(args)
	case "dns":
		err = cmdDNS(args)
	case "doctor":
		err = cmdDoctor(args)
	case "set-password":
		err = cmdSetPassword(args)
	case "caddyfile":
		err = cmdCaddyfile(args)
	case "check":
		err = cmdCheck(args)
	case "version", "--version":
		fmt.Println(version)
	case "help", "-h", "--help":
		fmt.Printf(usage, config.DefaultDataDir())
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n"+usage, cmd, config.DefaultDataDir())
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "appshome:", err)
		os.Exit(1)
	}
}

func dataFlag(fs *flag.FlagSet) *string {
	return fs.String("data", config.DefaultDataDir(), "data directory (config, apps, certificates, logs)")
}

// loadOrDefault returns the saved config, or defaults if none exists yet.
func loadOrDefault(dataDir string) (config.Config, bool, error) {
	cfg, err := config.Load(dataDir)
	if errors.Is(err, fs.ErrNotExist) {
		return config.Defaults(dataDir), false, nil
	}
	return cfg, err == nil, err
}
