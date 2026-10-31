package server

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"immich-filter-playground/internal/config"
	"immich-filter-playground/internal/immich"
)

//go:embed static/*
var embeddedStatic embed.FS

// Server serves the Immich Filter Playground web UI and API endpoints.
type Server struct {
	cfg      *config.Config
	client   *immich.Client
	profiles *profileStore
	mux      *http.ServeMux
}

// New creates and configures a new Server instance.
func New(cfg *config.Config) *Server {
	s := &Server{
		cfg: cfg,
		client: immich.NewClientWithOptions(cfg.Immich.URL, immich.ClientOptions{
			InsecureSkipVerify: cfg.Immich.InsecureSkipVerify,
			Timeout:            time.Duration(cfg.Immich.TimeoutSeconds) * time.Second,
		}),
		profiles: newProfileStore(cfg.Server.ProfilesFile),
		mux:      http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":     "ok",
			"configured": s.cfg.IsConfigured(),
			"version":    "1.1.0",
		})
	})
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})

	s.mux.HandleFunc("GET /api/bootstrap", s.handleBootstrap)
	s.mux.HandleFunc("POST /api/metadata/refresh", s.handleRefreshMetadata)
	s.mux.HandleFunc("POST /api/search", s.handleSearch)
	s.mux.HandleFunc("GET /api/media/{kind}/{id}", s.handleMediaProxy)

	// Search Profiles
	s.mux.HandleFunc("GET /api/profiles", s.handleGetProfiles)
	s.mux.HandleFunc("POST /api/profiles", s.handleSaveProfile)
	s.mux.HandleFunc("DELETE /api/profiles/{id}", s.handleDeleteProfile)

	// Serve static frontend files (prefer local disk in dev if present, otherwise embedded FS)
	staticSub, err := fs.Sub(embeddedStatic, "static")
	if err != nil {
		panic(err)
	}
	embeddedFileServer := http.FileServer(http.FS(staticSub))

	s.mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		localDir := filepath.Join("internal", "server", "static")
		if info, err := os.Stat(localDir); err == nil && info.IsDir() {
			http.FileServer(http.Dir(localDir)).ServeHTTP(w, r)
			return
		}
		embeddedFileServer.ServeHTTP(w, r)
	})
}

