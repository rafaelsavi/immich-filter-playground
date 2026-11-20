package immich

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestCountAssetsPaginationAndCaching(t *testing.T) {
	var hits atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/search/metadata" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		hits.Add(1)
		var req SearchRequestBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch req.Cursor {
		case "":
			// Smaller than 1000 items, yet nextCursor is present -> must continue paginating
			_, _ = w.Write([]byte(`{"assets":{"count":250,"items":[{}],"nextCursor":"c1"}}`))
		case "c1":
			_, _ = w.Write([]byte(`{"assets":{"count":250,"items":[{}],"nextCursor":"c2"}}`))
		case "c2":
			_, _ = w.Write([]byte(`{"assets":{"count":125,"items":[{}],"nextCursor":""}}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer mock.Close()

	client := NewClient(mock.URL)
	ctx := context.Background()

	// 1. Multi-page count with pages < 1000
	total, exact, err := client.CountAssets(ctx, "k1", SearchFilter{}, 5000, true, false)
	if err != nil {
		t.Fatalf("CountAssets returned error: %v", err)
	}
	if total != 625 || !exact {
		t.Fatalf("expected total=625 exact=true, got total=%d exact=%v", total, exact)
	}
	if hits.Load() != 3 {
		t.Fatalf("expected 3 HTTP calls for 3 pages, got %d", hits.Load())
	}

	// 2. Cache hit: same query should not make additional HTTP requests
	totalCached, exactCached, err := client.CountAssets(ctx, "k1", SearchFilter{}, 5000, true, false)
	if err != nil || totalCached != 625 || !exactCached {
		t.Fatalf("expected cached total=625 exact=true, got total=%d exact=%v err=%v", totalCached, exactCached, err)
	}
	if hits.Load() != 3 {
		t.Fatalf("expected cache hit with still 3 HTTP calls, got %d", hits.Load())
	}

	// 3. ClearCache invalidates count cache and maxCount cap returns exact=false
	client.ClearCache()
	totalCapped, exactCapped, err := client.CountAssets(ctx, "k1", SearchFilter{}, 400, true, false)
	if err != nil {
		t.Fatalf("CountAssets capped returned error: %v", err)
	}
	if totalCapped != 500 || exactCapped {
		t.Fatalf("expected total=500 exact=false when capped at 400, got total=%d exact=%v", totalCapped, exactCapped)
	}
}
