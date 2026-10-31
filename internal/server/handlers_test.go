package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	if healthResp.Status != "ok" || !healthResp.Configured {
		t.Errorf("unexpected health response: %+v", healthResp)
	}
}

