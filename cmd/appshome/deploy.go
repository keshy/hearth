package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"time"

	"appshome/internal/caddy"
	"appshome/internal/deploy"
	"appshome/internal/registry"
)

// cmdDeploy asks the running service to deploy now. If the service isn't
// running it deploys directly, so the command also works during setup.
func cmdDeploy(args []string) error {
	fs := flag.NewFlagSet("deploy", flag.ExitOnError)
	data := dataFlag(fs)
	force := fs.Bool("force", false, "redeploy even if the commit hasn't changed")
	fs.Parse(args)

	cfg, _, err := loadOrDefault(*data)
	if err != nil {
		return err
	}

	url := "http://" + cfg.AppListen + "/_internal/deploy"
	if *force {
		url += "?force=1"
	}
	client := &http.Client{Timeout: 25 * time.Minute}
	var st deploy.State
	resp, err := client.Post(url, "application/json", nil)
	if err == nil {
		defer resp.Body.Close()
		var body struct {
			deploy.State
			Error string        `json:"error"`
			Inner *deploy.State `json:"state"`
		}
		json.NewDecoder(resp.Body).Decode(&body)
		st = body.State
		if body.Inner != nil {
			st = *body.Inner
		}
		printState(st)
		if body.Error != "" {
			return fmt.Errorf("deploy failed: %s", body.Error)
		}
		return nil
	}

	fmt.Println("service not running; deploying directly")
	var engine *deploy.Engine
	engine = deploy.New(cfg, log.New(os.Stderr, "deploy: ", 0), func(apps []registry.App) error {
		_, err := caddy.Write(caddyInput(cfg, apps, engine.LiveDir))
		return err
	})
	err = engine.Sync(context.Background(), true)
	printState(engine.State())
	return err
}

func printState(st deploy.State) {
	if st.Commit.SHA != "" {
		fmt.Printf("commit %s %s\n", st.Commit.Short(), st.Commit.Subject)
	}
	names := make([]string, 0, len(st.Apps))
	for n := range st.Apps {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		a := st.Apps[n]
		line := fmt.Sprintf("  %-8s %-20s %s", a.Status, n, a.App.Kind)
		if a.Error != "" {
			line += "  " + a.Error
		}
		fmt.Println(line)
	}
	for n, p := range st.Problems {
		fmt.Printf("  invalid  %-20s %s\n", n, p)
	}
	if st.LastError != "" {
		fmt.Println("last error:", st.LastError)
	}
}
