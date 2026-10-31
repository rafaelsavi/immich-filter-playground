package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadNestedYAML(t *testing.T) {
	tmpDir := t.TempDir()
	cfgFile := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
server:
  host: "127.0.0.1"
  port: 9095
immich:
  url: "http://immich.local:2283/"
  external_url: "https://photos.example.com/"
  api_key: "root-key"
  insecure_skip_verify: true
  timeout_seconds: 30
  accounts:
    alice: "alice-key"
    bob: "bob-key"
defaults:
  sample_size: 48
  search_mode: "metadata"
  include_videos: false
  include_archived: true
`
	if err := os.WriteFile(cfgFile, []byte(yamlContent), 0600); err != nil {
		t.Fatalf("writing temp config: %v", err)
	}

	cfg, err := Load(cfgFile)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.Server.Host != "127.0.0.1" || cfg.Server.Port != 9095 {
		t.Errorf("unexpected server config: %+v", cfg.Server)
	}
	if cfg.Immich.URL != "http://immich.local:2283" {
		t.Errorf("unexpected immich URL: %q", cfg.Immich.URL)
	}
	if cfg.ExternalURL() != "https://photos.example.com" {
		t.Errorf("unexpected external URL: %q", cfg.ExternalURL())
	}
	if cfg.APIKeyForUser("alice") != "alice-key" {
		t.Errorf("expected alice-key, got %q", cfg.APIKeyForUser("alice"))
	}
	if cfg.APIKeyForUser("") != "root-key" {
		t.Errorf("expected root-key, got %q", cfg.APIKeyForUser(""))
	}
	accounts := cfg.AccountNames()
	if len(accounts) != 2 || accounts[0] != "alice" || accounts[1] != "bob" {
		t.Errorf("unexpected accounts: %v", accounts)
	}
	if !cfg.Immich.InsecureSkipVerify || cfg.Immich.TimeoutSeconds != 30 {
		t.Errorf("unexpected TLS or timeout settings: insecure=%v, timeout=%d", cfg.Immich.InsecureSkipVerify, cfg.Immich.TimeoutSeconds)
	}
	if cfg.Defaults.SampleSize != 48 || cfg.Defaults.SearchMode != "metadata" || cfg.Defaults.IncludeVideos || !cfg.Defaults.IncludeArchived {
		t.Errorf("unexpected defaults: %+v", cfg.Defaults)
	}
}

