package immich

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseUserFiltersSingleAndNestedOr(t *testing.T) {
	raw := `{
		"personIds": {"all": ["p1", "p2"]},
		"isFavorite": {"eq": true},
		"or": [
			{"country": {"in": ["Japan", "Italy"]}},
			{"albumIds": {"any": ["a1"]}}
		]
	}`

	filters, err := ParseUserFilters(raw, []string{"alice", "bob"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	f, ok := filters.ForUser("alice")
	if !ok {
		t.Fatalf("expected filter for alice")
	}

	if len(f.PersonIDs.All) != 2 || f.PersonIDs.All[0] != "p1" {
		t.Errorf("unexpected personIds: %+v", f.PersonIDs)
	}
	if f.IsFavorite.Eq == nil || !*f.IsFavorite.Eq {
		t.Errorf("expected isFavorite=true")
	}
	if f.Or == nil || len(*f.Or) != 2 {
		t.Fatalf("expected 2 OR branches, got %+v", f.Or)
	}
	if len((*f.Or)[0].Country.In) != 2 {
		t.Errorf("expected 2 countries in first OR branch, got %+v", (*f.Or)[0].Country)
	}
}

func TestDateOnlyUpperBoundsCoverWholeDay(t *testing.T) {
	filters, err := ParseUserFilters(`{"takenAt":{"gte":"2026-11-20","lte":"2026-11-20"},"createdAt":{"gt":"2026-11-19","lt":"2026-11-21"},"takenBefore":"2026-12-01"}`, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	f, _ := filters.ForUser("")

	wantStart := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)
	if !f.TakenAt.Gte.Equal(wantStart) {
		t.Errorf("gte should stay at start of day, got %v", f.TakenAt.Gte)
	}
	// takenBefore is also an upper bound and overrides takenAt.lte
	wantEnd := time.Date(2026, 12, 1, 23, 59, 59, int(999*time.Millisecond), time.UTC)
	if !f.TakenAt.Lte.Equal(wantEnd) {
		t.Errorf("takenBefore date-only should resolve to end of day, got %v", f.TakenAt.Lte)
	}
	if !f.CreatedAt.Gt.Equal(time.Date(2026, 11, 19, 23, 59, 59, int(999*time.Millisecond), time.UTC)) {
		t.Errorf("gt date-only should resolve to end of day, got %v", f.CreatedAt.Gt)
	}
	if !f.CreatedAt.Lt.Equal(time.Date(2026, 11, 21, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("lt date-only should stay at start of day, got %v", f.CreatedAt.Lt)
	}

	// Explicit timestamps are never shifted
	filters, err = ParseUserFilters(`{"takenAt":{"lte":"2026-11-20T10:00:00Z"}}`, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	f, _ = filters.ForUser("")
	if !f.TakenAt.Lte.Equal(time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("explicit timestamp must be preserved, got %v", f.TakenAt.Lte)
	}
}

func TestNullableAndZeroFiltersRoundTrip(t *testing.T) {
	// Empty filter must omit all nullable/number objects
	emptyBytes, err := json.Marshal(SearchFilter{})
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if string(emptyBytes) != "{}" {
		t.Fatalf("expected empty SearchFilter to marshal as {}, got %s", string(emptyBytes))
	}

	raw := `{"country":{"eq":null},"city":{"ne":null},"rating":{"eq":0},"fileSizeInBytes":{"gte":10485760,"lte":52428800}}`
	filters, err := ParseUserFilters(raw, nil)
	if err != nil {
		t.Fatalf("ParseUserFilters: %v", err)
	}
	f, _ := filters.ForUser("")
	if !f.Country.EqNull || !f.City.NeNull {
		t.Fatalf("expected EqNull on country and NeNull on city, got %+v / %+v", f.Country, f.City)
	}
	if f.Rating.Eq == nil || *f.Rating.Eq != 0 {
		t.Fatalf("expected rating.eq=0, got %+v", f.Rating)
	}
	if f.FileSizeInBytes.Gte == nil || *f.FileSizeInBytes.Gte != 10485760 || f.FileSizeInBytes.Lte == nil || *f.FileSizeInBytes.Lte != 52428800 {
		t.Fatalf("unexpected fileSizeInBytes: %+v", f.FileSizeInBytes)
	}

	out, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("remarshal: %v", err)
	}
	var roundTripped map[string]any
	if err := json.Unmarshal(out, &roundTripped); err != nil {
		t.Fatalf("unmarshal remarshaled: %v", err)
	}
	if cMap, ok := roundTripped["country"].(map[string]any); !ok || cMap["eq"] != nil || len(cMap) != 1 {
		t.Errorf("expected country={eq:null}, got %v", roundTripped["country"])
	}
	if _, hasEq := roundTripped["country"].(map[string]any)["eq"]; !hasEq {
		t.Errorf("country.eq key missing")
	}
	if cityMap, ok := roundTripped["city"].(map[string]any); !ok || cityMap["ne"] != nil || len(cityMap) != 1 {
		t.Errorf("expected city={ne:null}, got %v", roundTripped["city"])
	}
	if rMap, ok := roundTripped["rating"].(map[string]any); !ok || rMap["eq"] != float64(0) {
		t.Errorf("expected rating={eq:0}, got %v", roundTripped["rating"])
	}

	// Also verify rating null/not-null
	filters2, err := ParseUserFilters(`{"rating":{"eq":null},"make":{"ne":null}}`, nil)
	if err != nil {
		t.Fatalf("ParseUserFilters 2: %v", err)
	}
	f2, _ := filters2.ForUser("")
	if !f2.Rating.EqNull || !f2.Make.NeNull {
		t.Fatalf("expected rating.EqNull and make.NeNull, got %+v / %+v", f2.Rating, f2.Make)
	}
	out2, err := json.Marshal(f2)
	if err != nil {
		t.Fatalf("remarshal 2: %v", err)
	}
	var rt2 map[string]map[string]any
	if err := json.Unmarshal(out2, &rt2); err != nil {
		t.Fatalf("unmarshal 2: %v", err)
	}
	if v, exists := rt2["rating"]["eq"]; !exists || v != nil {
		t.Errorf("expected rating.eq=null, got %v (exists=%v)", v, exists)
	}
	if v, exists := rt2["make"]["ne"]; !exists || v != nil {
		t.Errorf("expected make.ne=null, got %v (exists=%v)", v, exists)
	}
}

func TestParseUserFiltersUnwrapsRequestBody(t *testing.T) {
	raw := `{
		"filter": {
			"country": {"eq": "Switzerland"}
		},
		"size": 24,
		"withExif": true
	}`

	filters, err := ParseUserFilters(raw, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	f, ok := filters.ForUser("")
	if !ok || f.Country.Eq != "Switzerland" {
		t.Errorf("expected unwrapped filter with Country=Switzerland, got %+v", f)
	}
}
