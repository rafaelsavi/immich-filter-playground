package immich

import (
	"testing"
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

