package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
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

	srv := New(cfg, "vtest-version")

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
	if sResp.Total != 1 || !sResp.TotalExact {
		t.Errorf("expected random search total=1 exact=true, got total=%d exact=%v", sResp.Total, sResp.TotalExact)
	}

	// 2b. Test POST /api/search (metadata with orderBy)
	metaPayload := `{"filterJson":"{\"country\":{\"in\":[\"Japan\"]}}","limit":24,"searchMode":"metadata","orderByField":"takenAt","orderByDirection":"desc"}`
	reqMetaSearch := httptest.NewRequest(http.MethodPost, "/api/search", bytes.NewBufferString(metaPayload))
	recMetaSearch := httptest.NewRecorder()
	srv.ServeHTTP(recMetaSearch, reqMetaSearch)
	if recMetaSearch.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/search (metadata), got %d", recMetaSearch.Code)
	}
	var metaSearchResp searchResponse
	if err := json.Unmarshal(recMetaSearch.Body.Bytes(), &metaSearchResp); err != nil {
		t.Fatalf("unmarshaling metadata search response: %v", err)
	}
	if metaSearchResp.Error != "" {
		t.Fatalf("metadata search returned error: %s", metaSearchResp.Error)
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
	if healthResp.Status != "ok" || !healthResp.Configured || healthResp.Version != "vtest-version" {
		t.Errorf("unexpected health response: %+v", healthResp)
	}

	for _, path := range []string{"/", "/index.html"} {
		reqIndex := httptest.NewRequest(http.MethodGet, path, nil)
		recIndex := httptest.NewRecorder()
		srv.ServeHTTP(recIndex, reqIndex)
		if recIndex.Code != http.StatusOK {
			t.Fatalf("expected 200 from %s, got %d", path, recIndex.Code)
		}
		if !bytes.Contains(recIndex.Body.Bytes(), []byte("vtest-version")) ||
			bytes.Contains(recIndex.Body.Bytes(), []byte("vvtest-version")) ||
			!bytes.Contains(recIndex.Body.Bytes(), []byte("https://github.com/rafaelsavi/immich-filter-playground")) ||
			bytes.Contains(recIndex.Body.Bytes(), []byte("{{APP_VERSION}}")) {
			t.Errorf("%s did not render version and repository link cleanly", path)
		}
	}

	srvBareVer := New(cfg, "1.6.2")
	for _, path := range []string{"/", "/index.html"} {
		reqBare := httptest.NewRequest(http.MethodGet, path, nil)
		recBare := httptest.NewRecorder()
		srvBareVer.ServeHTTP(recBare, reqBare)
		if recBare.Code != http.StatusOK {
			t.Fatalf("expected 200 from %s (bare version), got %d", path, recBare.Code)
		}
		if !bytes.Contains(recBare.Body.Bytes(), []byte("v1.6.2")) ||
			bytes.Contains(recBare.Body.Bytes(), []byte("vv1.6.2")) {
			t.Errorf("%s did not normalize bare semver to v1.6.2", path)
		}
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
	saveBody := `{"name":"Tokyo Favorites","searchMode":"random","filterJson":"{\"country\":{\"in\":[\"Japan\"]}}","history":[{"label":"Profile saved","detail":"Country is one of Japan","timestamp":"2026-11-16T16:00:00Z","snapshot":{"searchMode":"random","ruleTree":{"id":"root","type":"group","combiner":"AND","children":[]}}}],"historyIndex":0}`
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
	if len(saveResp.Profile.History) != 1 || saveResp.Profile.History[0].Detail != "Country is one of Japan" {
		t.Fatalf("expected history detail to be returned, got %+v", saveResp.Profile.History)
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
	if len(listResp.Profiles[0].History) != 1 || listResp.Profiles[0].HistoryIndex != 0 {
		t.Fatalf("expected profile history to persist, got %+v", listResp.Profiles[0])
	}
	if listResp.Profiles[0].History[0].Detail != "Country is one of Japan" {
		t.Fatalf("expected history detail to persist, got %+v", listResp.Profiles[0].History[0])
	}
	var historySnapshot struct {
		SearchMode string `json:"searchMode"`
	}
	if err := json.Unmarshal(listResp.Profiles[0].History[0].Snapshot, &historySnapshot); err != nil {
		t.Fatalf("unmarshaling profile history snapshot: %v", err)
	}
	if historySnapshot.SearchMode != "random" {
		t.Fatalf("unexpected profile history snapshot: %+v", historySnapshot)
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

func TestBootstrapWithMultipleAccounts(t *testing.T) {
	mockImmich := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		key := r.Header.Get("x-api-key")
		switch r.URL.Path {
		case "/api/people":
			if key == "bad-key" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"message":"Unauthorized"}`))
				return
			}
			_, _ = w.Write([]byte(`{"people":[{"id":"p-1","name":"Alice"}]}`))
		case "/api/albums":
			_, _ = w.Write([]byte(`[]`))
		case "/api/tags":
			_, _ = w.Write([]byte(`[]`))
		case "/api/search/cities":
			_, _ = w.Write([]byte(`[]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockImmich.Close()

	cfg := config.Default()
	cfg.Server.ProfilesFile = filepath.Join(t.TempDir(), "test_profiles.json")
	cfg.Immich.URL = mockImmich.URL
	cfg.Immich.Accounts = config.FlexibleAccounts{
		"alice": "good-key",
		"bob":   "bad-key",
	}

	srv := New(cfg, "test-version")

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

	if len(bootResp.Accounts) != 2 {
		t.Fatalf("expected 2 accounts, got %v", bootResp.Accounts)
	}
	if len(bootResp.AccountDetails) != 2 {
		t.Fatalf("expected 2 account details, got %+v", bootResp.AccountDetails)
	}

	health := make(map[string]bool)
	for _, d := range bootResp.AccountDetails {
		health[d.Name] = d.Valid
	}
	if !health["alice"] {
		t.Errorf("expected alice to be valid")
	}
	if health["bob"] {
		t.Errorf("expected bob to be invalid due to 401")
	}
}

func TestMetadataCacheAndRefresh(t *testing.T) {
	var peopleHits atomic.Int32
	mockImmich := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/people":
			peopleHits.Add(1)
			_, _ = w.Write([]byte(`{"people":[{"id":"p-1","name":"Alice"}]}`))
		case "/api/albums", "/api/tags", "/api/search/cities":
			_, _ = w.Write([]byte(`[]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockImmich.Close()

	cfg := config.Default()
	cfg.Server.ProfilesFile = filepath.Join(t.TempDir(), "profiles.json")
	cfg.Immich.URL = mockImmich.URL
	cfg.Immich.APIKey = "test-api-key"

	srv := New(cfg, "1.6.2")

	// Initial GET /api/metadata populates cache
	rec1 := httptest.NewRecorder()
	srv.ServeHTTP(rec1, httptest.NewRequest(http.MethodGet, "/api/metadata", nil))
	if rec1.Code != http.StatusOK || peopleHits.Load() != 1 {
		t.Fatalf("expected 200 and 1 hit on initial GET /api/metadata, got code=%d hits=%d", rec1.Code, peopleHits.Load())
	}

	// Second GET /api/metadata uses cache (no new hit)
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/metadata", nil))
	if rec2.Code != http.StatusOK || peopleHits.Load() != 1 {
		t.Fatalf("expected cached metadata on second GET /api/metadata, got code=%d hits=%d", rec2.Code, peopleHits.Load())
	}

	// POST /api/metadata/refresh clears cache and re-fetches
	rec3 := httptest.NewRecorder()
	srv.ServeHTTP(rec3, httptest.NewRequest(http.MethodPost, "/api/metadata/refresh", nil))
	if rec3.Code != http.StatusOK || peopleHits.Load() != 2 {
		t.Fatalf("expected cache clear and 2 hits on POST /api/metadata/refresh, got code=%d hits=%d", rec3.Code, peopleHits.Load())
	}
}

func TestProfileStoreSafety(t *testing.T) {
	nestedDir := filepath.Join(t.TempDir(), "nested", "dir")
	profilesPath := filepath.Join(nestedDir, "profiles.json")

	cfg := config.Default()
	cfg.Server.ProfilesFile = profilesPath
	srv := New(cfg, "1.6.2")

	// 1. Save with >50 history entries and nested dir creation
	var histJSON bytes.Buffer
	histJSON.WriteByte('[')
	for i := 0; i < 60; i++ {
		if i > 0 {
			histJSON.WriteByte(',')
		}
		fmt.Fprintf(&histJSON, `{"label":"Edit %d","timestamp":"2026-11-17T10:00:00Z","snapshot":{}}`, i)
	}
	histJSON.WriteByte(']')
	body := fmt.Sprintf(`{"name":"Capped History","filterJson":"{}","history":%s,"historyIndex":59}`, histJSON.String())

	req := httptest.NewRequest(http.MethodPost, "/api/profiles", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 saving profile to nested dir, got %d (%s)", rec.Code, rec.Body.String())
	}
	var saveResp struct {
		Profile SearchProfile `json:"profile"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &saveResp); err != nil {
		t.Fatalf("unmarshaling save response: %v", err)
	}
	if len(saveResp.Profile.History) != 50 || saveResp.Profile.HistoryIndex != 49 {
		t.Fatalf("expected history capped to 50 and index clamped to 49, got len=%d idx=%d", len(saveResp.Profile.History), saveResp.Profile.HistoryIndex)
	}

	// 2. Delete profile atomically
	reqDel := httptest.NewRequest(http.MethodDelete, "/api/profiles/"+saveResp.Profile.ID, nil)
	recDel := httptest.NewRecorder()
	srv.ServeHTTP(recDel, reqDel)
	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 deleting profile, got %d", recDel.Code)
	}

	// 3. Corrupt profiles file must NOT be overwritten on Save
	corruptData := []byte(`{corrupt json`)
	if err := os.WriteFile(profilesPath, corruptData, 0644); err != nil {
		t.Fatalf("writing corrupt file: %v", err)
	}
	if _, err := srv.profiles.Save(SearchProfile{Name: "Should Fail"}); err == nil {
		t.Fatalf("expected Save to fail when existing profiles.json is corrupt")
	}
	after, err := os.ReadFile(profilesPath)
	if err != nil || !bytes.Equal(after, corruptData) {
		t.Fatalf("expected corrupt profiles.json to remain untouched, got %q (err=%v)", string(after), err)
	}
}

func TestImportProfilesEndpoint(t *testing.T) {
	cfg := config.Default()
	cfg.Server.ProfilesFile = filepath.Join(t.TempDir(), "profiles.json")
	srv := New(cfg, "1.9.0")

	// 1. Reject empty array
	recEmpty := httptest.NewRecorder()
	srv.ServeHTTP(recEmpty, httptest.NewRequest(http.MethodPost, "/api/profiles/import", bytes.NewBufferString(`[]`)))
	if recEmpty.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty import, got %d", recEmpty.Code)
	}

	// 2. Import raw JSON array (including one without ID and one with explicit ID)
	arrBody := `[{"name":"Alpha","filterJson":"{}"},{"id":"prof_keep","name":"Beta","filterJson":"{\"isFavorite\":{\"eq\":true}}"}]`
	recArr := httptest.NewRecorder()
	srv.ServeHTTP(recArr, httptest.NewRequest(http.MethodPost, "/api/profiles/import", bytes.NewBufferString(arrBody)))
	if recArr.Code != http.StatusOK {
		t.Fatalf("expected 200 for array import, got %d (%s)", recArr.Code, recArr.Body.String())
	}
	var resp1 struct {
		Profiles []SearchProfile `json:"profiles"`
		Imported int             `json:"imported"`
	}
	if err := json.Unmarshal(recArr.Body.Bytes(), &resp1); err != nil {
		t.Fatalf("decode import 1: %v", err)
	}
	if resp1.Imported != 2 || len(resp1.Profiles) != 2 {
		t.Fatalf("expected 2 imported profiles, got %+v", resp1)
	}

	// 3. Import wrapper object updating existing ID and adding another
	wrapBody := `{"profiles":[{"id":"prof_keep","name":"Beta Updated","filterJson":"{}"},{"name":"Gamma","filterJson":"{}"}]}`
	recWrap := httptest.NewRecorder()
	srv.ServeHTTP(recWrap, httptest.NewRequest(http.MethodPost, "/api/profiles/import", bytes.NewBufferString(wrapBody)))
	if recWrap.Code != http.StatusOK {
		t.Fatalf("expected 200 for wrapper import, got %d (%s)", recWrap.Code, recWrap.Body.String())
	}
	var resp2 struct {
		Profiles []SearchProfile `json:"profiles"`
		Imported int             `json:"imported"`
	}
	if err := json.Unmarshal(recWrap.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("decode import 2: %v", err)
	}
	if resp2.Imported != 2 || len(resp2.Profiles) != 3 {
		t.Fatalf("expected 3 total profiles after upsert, got %d (imported=%d)", len(resp2.Profiles), resp2.Imported)
	}
	var betaName string
	for _, p := range resp2.Profiles {
		if p.ID == "prof_keep" {
			betaName = p.Name
		}
	}
	if betaName != "Beta Updated" {
		t.Errorf("expected prof_keep to be updated to 'Beta Updated', got %q", betaName)
	}
}
