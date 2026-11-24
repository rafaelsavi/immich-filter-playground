package immich

import (
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

