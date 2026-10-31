package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"immich-filter-playground/internal/config"
)

func TestBootstrapAndSearchWithMockImmich(t *testing.T) {
	mockImmich := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/people":
			_, _ = w.Write([]byte(`{"people":[{"id":"p-1","name":"Alice"}]}`))
		case "/api/albums":
			_, _ = w.Write([]byte(`[{"id":"a-1","albumName":"Summer Trip","assetCount":12}]`))
		case "/api/tags":
			_, _ = w.Write([]byte(`[{"id":"t-1","name":"vacation","value":"vacation"}]`))
		case "/api/search/cities":
			_, _ = w.Write([]byte(`[{"exifInfo":{"country":"Japan","state":"Tokyo","city":"Shibuya","model":"X100V","make":"Fujifilm"}}]`))
		case "/api/search/random", "/api/search/metadata":
			_, _ = w.Write([]byte(`{"assets":{"total":1,"count":1,"items":[{"id":"asset-1","type":"IMAGE","originalFileName":"DSCF0001.JPG","isFavorite":true,"exifInfo":{"country":"Japan","city":"Shibuya","rating":5},"people":[{"id":"p-1","name":"Alice"}]}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockImmich.Close()

	cfg := config.Default()
	cfg.Server.ProfilesFile = filepath.Join(t.TempDir(), "test_profiles.json")
	cfg.Immich.URL = mockImmich.URL
	cfg.Immich.APIKey = "test-api-key"

	srv := New(cfg)

	// 1. Test GET /api/bootstrap
	reqBoot := httptest.NewRequest(http.MethodGet, "/api/bootstrap", nil)
	recBoot := httptest.NewRecorder()
	srv.ServeHTTP(recBoot, reqBoot)

	if recBoot.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/bootstrap, got %d", recBoot.Code)
	}
	var bootResp bootstrapResponse
	if err := json.Unmarshal(recBoot.Body.Bytes(), &bootResp); err != nil {
		t.Fatalf("unmarshaling bootstrap response: %v", err)
	}
	if !bootResp.Configured || len(bootResp.Metadata.People) != 1 || bootResp.Metadata.Countries[0] != "Japan" {
		t.Errorf("unexpected bootstrap payload: %+v", bootResp)
	}

	// 2. Test POST /api/search
	searchPayload := `{"filterJson":"{\"country\":{\"in\":[\"Japan\"]}}","limit":24,"searchMode":"random"}`
	reqSearch := httptest.NewRequest(http.MethodPost, "/api/search", bytes.NewBufferString(searchPayload))
	recSearch := httptest.NewRecorder()
	srv.ServeHTTP(recSearch, reqSearch)

	if recSearch.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/search, got %d", recSearch.Code)
	}
	var sResp searchResponse
	if err := json.Unmarshal(recSearch.Body.Bytes(), &sResp); err != nil {
		t.Fatalf("unmarshaling search response: %v", err)
	}
	// 3. Test GET /api/health
	reqHealth := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	recHealth := httptest.NewRecorder()
	srv.ServeHTTP(recHealth, reqHealth)
	if recHealth.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/health, got %d", recHealth.Code)
	}

	var healthResp struct {
		Status     string `json:"status"`
		Configured bool   `json:"configured"`
		Version    string `json:"version"`
	}
	if err := json.Unmarshal(recHealth.Body.Bytes(), &healthResp); err != nil {
		t.Fatalf("unmarshaling health response: %v", err)
	}
	if healthResp.Status != "ok" || !healthResp.Configured || healthResp.Version != "1.1.0" {
		t.Errorf("unexpected health response: %+v", healthResp)
	}

	// 4. Test Search Profiles Endpoints
	// 4a. Initially empty
	reqProfGet := httptest.NewRequest(http.MethodGet, "/api/profiles", nil)
	recProfGet := httptest.NewRecorder()
	srv.ServeHTTP(recProfGet, reqProfGet)
	if recProfGet.Code != http.StatusOK {
		t.Fatalf("expected 200 from GET /api/profiles, got %d", recProfGet.Code)
	}

	// 4b. Save a profile
	saveBody := `{"name":"Tokyo Favorites","searchMode":"random","filterJson":"{\"country\":{\"in\":[\"Japan\"]}}"}`
	reqProfSave := httptest.NewRequest(http.MethodPost, "/api/profiles", bytes.NewBufferString(saveBody))
	recProfSave := httptest.NewRecorder()
	srv.ServeHTTP(recProfSave, reqProfSave)
	if recProfSave.Code != http.StatusOK {
		t.Fatalf("expected 200 from POST /api/profiles, got %d (%s)", recProfSave.Code, recProfSave.Body.String())
	}
	var saveResp struct {
		Profile SearchProfile `json:"profile"`
	}
	if err := json.Unmarshal(recProfSave.Body.Bytes(), &saveResp); err != nil {
		t.Fatalf("unmarshaling save profile response: %v", err)
	}
	if saveResp.Profile.ID == "" || saveResp.Profile.Name != "Tokyo Favorites" {
		t.Fatalf("unexpected saved profile: %+v", saveResp.Profile)
	}

	// 4c. Verify profile list
	recProfGet2 := httptest.NewRecorder()
	srv.ServeHTTP(recProfGet2, reqProfGet)
	var listResp struct {
		Profiles []SearchProfile `json:"profiles"`
	}
	if err := json.Unmarshal(recProfGet2.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshaling profiles list response: %v", err)
	}
	if len(listResp.Profiles) != 1 || listResp.Profiles[0].ID != saveResp.Profile.ID {
		t.Fatalf("expected 1 profile in list, got %+v", listResp.Profiles)
	}

	// 4d. Delete profile
	reqProfDel := httptest.NewRequest(http.MethodDelete, "/api/profiles/"+saveResp.Profile.ID, nil)
	recProfDel := httptest.NewRecorder()
	srv.ServeHTTP(recProfDel, reqProfDel)
	if recProfDel.Code != http.StatusOK {
		t.Fatalf("expected 200 from DELETE /api/profiles, got %d", recProfDel.Code)
	}

	// Clean up temp test profiles file if created
	defer os.Remove(cfg.Server.ProfilesFile)
}

