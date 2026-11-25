package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"immich-filter-playground/internal/config"
)

func TestOptionalBasicAuthGuard(t *testing.T) {
	// 1. Disabled by default when AuthPassword is empty
	cfgOpen := config.Default()
	cfgOpen.Server.ProfilesFile = filepath.Join(t.TempDir(), "profiles.json")
	srvOpen := New(cfgOpen, "1.9.0")

	recOpen := httptest.NewRecorder()
	srvOpen.ServeHTTP(recOpen, httptest.NewRequest(http.MethodGet, "/api/bootstrap", nil))
	if recOpen.Code != http.StatusOK {
		t.Fatalf("expected 200 when auth is disabled, got %d", recOpen.Code)
	}

	// 2. Enabled when AuthPassword is set
	cfgAuth := config.Default()
	cfgAuth.Server.ProfilesFile = filepath.Join(t.TempDir(), "profiles.json")
	cfgAuth.Server.AuthUsername = "admin"
	cfgAuth.Server.AuthPassword = "super-secret-password"
	srvAuth := New(cfgAuth, "1.9.0")

	// /healthz stays unauthenticated for container healthchecks
	recHealthz := httptest.NewRecorder()
	srvAuth.ServeHTTP(recHealthz, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recHealthz.Code != http.StatusOK {
		t.Fatalf("expected /healthz to bypass Basic Auth, got %d", recHealthz.Code)
	}

	// Protected routes reject missing or wrong credentials with 401 + WWW-Authenticate
	for _, path := range []string{"/", "/api/bootstrap", "/api/profiles"} {
		recNoAuth := httptest.NewRecorder()
		srvAuth.ServeHTTP(recNoAuth, httptest.NewRequest(http.MethodGet, path, nil))
		if recNoAuth.Code != http.StatusUnauthorized {
			t.Errorf("%s without auth: expected 401, got %d", path, recNoAuth.Code)
		}
		if recNoAuth.Header().Get("WWW-Authenticate") == "" {
			t.Errorf("%s without auth: missing WWW-Authenticate header", path)
		}

		reqBad := httptest.NewRequest(http.MethodGet, path, nil)
		reqBad.SetBasicAuth("admin", "wrong")
		recBad := httptest.NewRecorder()
		srvAuth.ServeHTTP(recBad, reqBad)
		if recBad.Code != http.StatusUnauthorized {
			t.Errorf("%s with bad password: expected 401, got %d", path, recBad.Code)
		}

		reqGood := httptest.NewRequest(http.MethodGet, path, nil)
		reqGood.SetBasicAuth("admin", "super-secret-password")
		recGood := httptest.NewRecorder()
		srvAuth.ServeHTTP(recGood, reqGood)
		if recGood.Code != http.StatusOK {
			t.Errorf("%s with valid credentials: expected 200, got %d", path, recGood.Code)
		}
	}
}
