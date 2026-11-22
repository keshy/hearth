package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"appshome/internal/builder"
	"appshome/internal/caddy"
	"appshome/internal/config"
	"appshome/internal/deploy"
	"appshome/internal/registry"
	"appshome/internal/web"
)

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	data := dataFlag(fs)
	fs.Parse(args)

	logger := log.New(os.Stderr, "serve: ", log.LstdFlags)
	cfg, existed, err := loadOrDefault(*data)
	if err != nil {
		return err
	}
	if !existed {
		if err := cfg.Save(); err != nil {
			return err
		}
		logger.Printf("created %s with defaults", cfg.Path())
	}
	if cfg.AdminPasswordHash == "" {
		logger.Printf("no admin password yet; run: appshome set-password --data %q", cfg.DataDir)
	}

	var engine *deploy.Engine
	reload := func() error { return caddy.Sync(caddyInput(cfg, engine.Apps(), engine.LiveDir)) }
	engine = deploy.New(cfg, log.New(os.Stderr, "deploy: ", log.LstdFlags), func([]registry.App) error { return reload() })
	health := web.NewHealth(engine.Apps, engine.LiveDir)
	b := builder.New(cfg, engine, log.New(os.Stderr, "", log.LstdFlags))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv, err := web.New(ctx, cfg, engine, health, b, reload, logger)
	if err != nil {
		return err
	}

	go func() {
		syncCaddyAtStartup(ctx, logger, reload)
		if err := engine.Sync(ctx, true); err != nil {
			logger.Printf("initial deploy: %v", err)
		}
		health.CheckAll()
		engine.Poll(ctx)
	}()
	go health.Run(ctx, 30*time.Second)

	hs := &http.Server{Addr: cfg.AppListen, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		hs.Shutdown(shut)
	}()

	source := cfg.RepoPath() + " (local)"
	if cfg.GitMode() {
		source = cfg.RepoURL + " @ " + cfg.Branch
	}
	logger.Printf("portal %s, admin %s, apps from %s (listening on %s)", cfg.PortalURL(), cfg.AdminURL(), source, cfg.AppListen)
	if err := hs.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func caddyInput(cfg config.Config, apps []registry.App, liveDir func(string) string) caddy.Input {
	hash := cfg.AdminPasswordHash
	if fresh, err := config.Load(cfg.DataDir); err == nil {
		hash = fresh.AdminPasswordHash
	}
	return caddy.Input{Cfg: cfg, Apps: apps, LiveDir: liveDir, AdminHash: hash}
}

// syncCaddyAtStartup retries because launchd may start Caddy after us.
func syncCaddyAtStartup(ctx context.Context, logger *log.Logger, reload func() error) {
	var err error
	for i := 0; i < 60; i++ {
		if err = reload(); err == nil {
			logger.Printf("caddy config loaded")
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
	logger.Printf("caddy still not reachable after 2 minutes: %v", err)
}
