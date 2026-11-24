package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"immich-filter-playground/internal/config"
)

func newCountTestServer(t *testing.T) (*Server, *atomic.Int32) {
	t.Helper()
	var countHits atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/search/random":
			_, _ = w.Write([]byte(`{"assets":{"items":[{"id":"asset-1","type":"IMAGE"}]}}`))
		case "/api/search/metadata":
			var req struct {
				Size int `json:"size"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req.Size == 1000 {
				countHits.Add(1)
				_, _ = w.Write([]byte(`{"assets":{"count":42,"items":[{}],"nextCursor":""}}`))
				return
			}
			_, _ = w.Write([]byte(`{"assets":{"items":[{"id":"asset-1","type":"IMAGE"}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(mock.Close)

	cfg := config.Default()
	cfg.Server.ProfilesFile = filepath.Join(t.TempDir(), "profiles.json")
	cfg.Immich.URL = mock.URL
	cfg.Immich.APIKey = "k"
	return New(cfg, "test"), &countHits
}

func TestSearchSkipCountDefersCounting(t *testing.T) {
	srv, countHits := newCountTestServer(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/search", bytes.NewBufferString(`{"filterJson":"{}","searchMode":"random","skipCount":true}`)))
	var resp searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Assets) != 1 || !resp.CountPending || resp.TotalExact {
		t.Fatalf("expected 1 asset with pending, inexact count, got %+v", resp)
	}
	if countHits.Load() != 0 {
		t.Fatalf("skipCount must not hit the count endpoint, got %d hits", countHits.Load())
	}

	recCount := httptest.NewRecorder()
	srv.ServeHTTP(recCount, httptest.NewRequest(http.MethodPost, "/api/search/count", bytes.NewBufferString(`{"filterJson":"{}","searchMode":"random"}`)))
	var countResp searchResponse
	if err := json.Unmarshal(recCount.Body.Bytes(), &countResp); err != nil {
		t.Fatalf("decode count: %v", err)
	}
	if countResp.Total != 42 || !countResp.TotalExact || countResp.Error != "" {
		t.Fatalf("unexpected count response: %+v", countResp)
	}
}

func TestSearchCountRejectsInvalidFilter(t *testing.T) {
	srv, _ := newCountTestServer(t)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/search/count", bytes.NewBufferString(`{"filterJson":"{nope"}`)))
	var resp searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Error == "" {
		t.Fatalf("expected an error for invalid filter JSON")
	}
}
