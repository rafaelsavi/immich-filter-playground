package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"immich-filter-playground/internal/config"
)

func TestSmartSearch(t *testing.T) {
	var gotQuery string
	var gotBody struct {
		Query  string `json:"query"`
		Filter struct {
			Type struct {
				In []string `json:"in"`
			} `json:"type"`
			Country struct {
				In []string `json:"in"`
			} `json:"country"`
		} `json:"filter"`
	}
	var countCalls int
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/search/smart":
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			gotQuery = gotBody.Query
			_, _ = w.Write([]byte(`{"assets":{"total":2,"count":2,"items":[{"id":"s1","type":"IMAGE"},{"id":"s2","type":"IMAGE"}]}}`))
		case "/api/search/metadata":
			countCalls++
			_, _ = w.Write([]byte(`{"assets":{"count":0,"items":[]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mock.Close()

	cfg := config.Default()
	cfg.Server.ProfilesFile = filepath.Join(t.TempDir(), "profiles.json")
	cfg.Immich.URL = mock.URL
	cfg.Immich.APIKey = "k"
	srv := New(cfg, "test")

	post := func(body string) searchResponse {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/search", bytes.NewBufferString(body)))
		var resp searchResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp
	}

	resp := post(`{"filterJson":"{\"country\":{\"in\":[\"Japan\"]}}","searchMode":"smart","smartQuery":"  sunset beach ","skipCount":true}`)
	if resp.Error != "" || len(resp.Assets) != 2 {
		t.Fatalf("unexpected smart response: %+v", resp)
	}
	if gotQuery != "sunset beach" {
		t.Errorf("query should be trimmed and forwarded, got %q", gotQuery)
	}
	if len(gotBody.Filter.Country.In) != 1 || len(gotBody.Filter.Type.In) == 0 {
		t.Errorf("smart search should send filter with defaults applied, got %+v", gotBody.Filter)
	}
	if resp.CountPending || countCalls != 0 {
		t.Errorf("smart search must not count (pending=%v, calls=%d)", resp.CountPending, countCalls)
	}
	if resp.Total != 2 {
		t.Errorf("total should equal returned results, got %d", resp.Total)
	}
	if !bytes.Contains([]byte(resp.RequestBodyJSON), []byte(`"query": "sunset beach"`)) {
		t.Errorf("request body preview should include the query: %s", resp.RequestBodyJSON)
	}

	empty := post(`{"filterJson":"{}","searchMode":"smart","smartQuery":"   "}`)
	if empty.Error == "" || len(empty.Assets) != 0 {
		t.Errorf("empty smart phrase should return an error, got %+v", empty)
	}
}
