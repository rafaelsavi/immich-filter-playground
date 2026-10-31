package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"immich-filter-playground/internal/config"
	"immich-filter-playground/internal/server"
)

var version = "1.0.0"

func main() {
	configPath := flag.String("config", "", "Path to config.yaml file (defaults to ./config.yaml or CONFIG_FILE env var)")
	initFrom := flag.String("init-from", "", "Initialize ./config.yaml by importing Immich settings from an existing YAML config")
	portOverride := flag.Int("port", 0, "Override server listening port")
	showVersion := flag.Bool("version", false, "Show version information and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("immich-filter-playground v%s\n", version)
		return
	}

	if *initFrom != "" {
		imported, err := config.Load(*initFrom)
		if err != nil {
			log.Fatalf("Failed to import config from %s: %v", *initFrom, err)
		}
		outPath := *configPath
		if outPath == "" {
			outPath = "config.yaml"
		}
		if err := imported.SaveYAML(outPath); err != nil {
			log.Fatalf("Failed to write %s: %v", outPath, err)
		}
		log.Printf("✓ Generated %s (Immich URL: %s, accounts: %d)", outPath, imported.Immich.URL, len(imported.AccountNames()))
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}
	if *portOverride > 0 {
		cfg.Server.Port = *portOverride
	}

	srv := server.New(cfg)
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
	}

	displayHost := cfg.Server.Host
	if displayHost == "" || displayHost == "0.0.0.0" {
		displayHost = "localhost"
	}

	log.Printf("⚡ Immich Filter Playground v%s listening on http://%s:%d", version, displayHost, cfg.Server.Port)
	if cfg.IsConfigured() {
		log.Printf("🔗 Connected to Immich: %s (accounts: %d)", cfg.Immich.URL, len(cfg.AccountNames()))
	} else {
		log.Printf("⚠️  Immich credentials not yet configured. Create config.yaml (see config.example.yaml) or set IMMICH_URL & IMMICH_API_KEY.")
	}

	// Graceful shutdown on SIGINT or SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down Immich Filter Playground gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	} else {
		log.Println("✓ Server stopped cleanly.")
	}
}
