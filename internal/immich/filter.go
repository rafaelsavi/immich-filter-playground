package immich

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (s *StringFilterNullable) UnmarshalJSON(data []byte) error {
	var strVal string
	if err := json.Unmarshal(data, &strVal); err == nil {
		s.Eq = strVal
		return nil
	}
	var sliceVal []string
	if err := json.Unmarshal(data, &sliceVal); err == nil {
		s.In = sliceVal
		return nil
	}
	type rawStringFilterNullable StringFilterNullable
	var raw rawStringFilterNullable
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*s = StringFilterNullable(raw)
	return nil
}

func (s *StringPatternFilter) UnmarshalJSON(data []byte) error {
	var strVal string
	if err := json.Unmarshal(data, &strVal); err == nil {
		s.Like = strVal
		return nil
	}
	type rawStringPatternFilter StringPatternFilter
	var raw rawStringPatternFilter
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*s = StringPatternFilter(raw)
	return nil
}

func (b *BoolFilter) UnmarshalJSON(data []byte) error {
	var boolVal bool
	if err := json.Unmarshal(data, &boolVal); err == nil {
		b.Eq = &boolVal
		return nil
	}
	var raw struct {
		Eq *bool `json:"eq"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	b.Eq = raw.Eq
	return nil
}

func parseFlexibleTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	formats := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse date string: %q", s)
}

func (d *DateFilter) UnmarshalJSON(data []byte) error {
	var strVal string
	if err := json.Unmarshal(data, &strVal); err == nil {
		t, err := parseFlexibleTime(strVal)
		if err != nil {
			return err
		}
		d.Gte = t
		return nil
	}

	var raw struct {
		Eq  any `json:"eq,omitempty"`
		Gt  any `json:"gt,omitempty"`
		Gte any `json:"gte,omitempty"`
		Lt  any `json:"lt,omitempty"`
		Lte any `json:"lte,omitempty"`
		Ne  any `json:"ne,omitempty"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	parseVal := func(v any) (time.Time, error) {
		if v == nil {
			return time.Time{}, nil
		}
		if s, ok := v.(string); ok && s != "" {
			return parseFlexibleTime(s)
		}
		return time.Time{}, fmt.Errorf("invalid date value: %v", v)
	}

	if raw.Eq != nil {
		t, err := parseVal(raw.Eq)
		if err != nil {
			return err
		}
		d.Eq = t
	}
	if raw.Gt != nil {
		t, err := parseVal(raw.Gt)
		if err != nil {
			return err
		}
		d.Gt = t
	}
	if raw.Gte != nil {
		t, err := parseVal(raw.Gte)
		if err != nil {
			return err
		}
		d.Gte = t
	}
	if raw.Lt != nil {
		t, err := parseVal(raw.Lt)
		if err != nil {
			return err
		}
		d.Lt = t
	}
	if raw.Lte != nil {
		t, err := parseVal(raw.Lte)
		if err != nil {
			return err
		}
		d.Lte = t
	}
	if raw.Ne != nil {
		t, err := parseVal(raw.Ne)
		if err != nil {
			return err
		}
		d.Ne = t
	}
	return nil
}

func (ids *IDsFilter) UnmarshalJSON(data []byte) error {
	var sliceVal []string
	if err := json.Unmarshal(data, &sliceVal); err == nil {
		ids.Any = sliceVal
		return nil
	}
	var strVal string
	if err := json.Unmarshal(data, &strVal); err == nil {
		ids.Any = []string{strVal}
		return nil
	}
	type rawIDsFilter IDsFilter
	var raw rawIDsFilter
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*ids = IDsFilter(raw)
	return nil
}

func (n *NumberFilterNullable) UnmarshalJSON(data []byte) error {
	var numVal float64
	if err := json.Unmarshal(data, &numVal); err == nil {
		n.Eq = numVal
		return nil
	}
	type rawNumberFilterNullable NumberFilterNullable
	var raw rawNumberFilterNullable
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*n = NumberFilterNullable(raw)
	return nil
}

func (f *FilterAssetType) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		f.In = []AssetType{AssetType(single)}
		return nil
	}
	var list []AssetType
	if err := json.Unmarshal(data, &list); err == nil {
		f.In = list
		return nil
	}
	type rawFilterAssetType FilterAssetType
	var raw rawFilterAssetType
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*f = FilterAssetType(raw)
	return nil
}

func (f *FilterAssetVisibility) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		f.In = []AssetVisibility{AssetVisibility(single)}
		return nil
	}
	var list []AssetVisibility
	if err := json.Unmarshal(data, &list); err == nil {
		f.In = list
		return nil
	}
	type rawFilterAssetVisibility FilterAssetVisibility
	var raw rawFilterAssetVisibility
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*f = FilterAssetVisibility(raw)
	return nil
}

func (s *SearchFilter) UnmarshalJSON(data []byte) error {
	type rawSearchFilter SearchFilter
	var raw struct {
		rawSearchFilter
		TakenAfter  any `json:"takenAfter,omitempty"`
		TakenBefore any `json:"takenBefore,omitempty"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*s = SearchFilter(raw.rawSearchFilter)
	if raw.TakenAfter != nil {
		if str, ok := raw.TakenAfter.(string); ok && str != "" {
			if t, err := parseFlexibleTime(str); err == nil {
				s.TakenAt.Gte = t
			}
		}
	}
	if raw.TakenBefore != nil {
		if str, ok := raw.TakenBefore.(string); ok && str != "" {
			if t, err := parseFlexibleTime(str); err == nil {
				s.TakenAt.Lte = t
			}
		}
	}
	return nil
}

// UserFilterMap maps usernames to their respective Immich SearchFilters.
// A key of "" or "*" represents a default/global filter applicable to any user.
type UserFilterMap map[string]SearchFilter

func (m UserFilterMap) ForUser(username string) (SearchFilter, bool) {
	if len(m) == 0 {
		return SearchFilter{}, false
	}
	if f, exists := m[username]; exists {
		return f, true
	}
	if f, exists := m["*"]; exists {
		return f, true
	}
	if f, exists := m[""]; exists {
		return f, true
	}
	if f, exists := m["default"]; exists {
		return f, true
	}
	if len(m) == 1 {
		for _, f := range m {
			return f, true
		}
	}
	return SearchFilter{}, false
}

var KnownSearchFilterFields = map[string]bool{
	"albumIds":         true,
	"checksum":         true,
	"city":             true,
	"country":          true,
	"createdAt":        true,
	"description":      true,
	"encodedVideoPath": true,
	"fileSizeInBytes":  true,
	"hasAlbums":        true,
	"hasPeople":        true,
	"hasTags":          true,
	"id":               true,
	"isEncoded":        true,
	"isFavorite":       true,
	"isMotion":         true,
	"isOffline":        true,
	"lensModel":        true,
	"libraryId":        true,
	"make":             true,
	"model":            true,
	"ocr":              true,
	"or":               true,
	"originalFileName": true,
	"originalPath":     true,
	"personIds":        true,
	"rating":           true,
	"state":            true,
	"tagIds":           true,
	"takenAfter":       true,
	"takenAt":          true,
	"takenBefore":      true,
	"type":             true,
	"updatedAt":        true,
	"visibility":       true,
}

// ParseUserFilters parses a raw JSON filter string into a UserFilterMap.
// It supports both a single SearchFilter object and a multi-user map of username -> SearchFilter.
func ParseUserFilters(rawJSON string, knownUsers []string) (UserFilterMap, error) {
	rawJSON = strings.TrimSpace(rawJSON)
	if rawJSON == "" || rawJSON == "{}" {
		return UserFilterMap{"": SearchFilter{}}, nil
	}

	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal([]byte(rawJSON), &rawMap); err != nil {
		return nil, fmt.Errorf("parsing filter JSON: %w", err)
	}

	// If someone pasted a full SearchRequestBody wrapper {"filter": {...}}, unwrap it automatically!
	if filterRaw, hasFilterKey := rawMap["filter"]; hasFilterKey && len(rawMap) <= 6 {
		_, hasKnownOther := rawMap["personIds"]
		if !hasKnownOther {
			var inner SearchFilter
			if err := json.Unmarshal(filterRaw, &inner); err == nil {
				return UserFilterMap{"": inner}, nil
			}
		}
	}

	isSingleFilter := false
	for k := range rawMap {
		if KnownSearchFilterFields[k] {
			isSingleFilter = true
			break
		}
	}

	if !isSingleFilter {
		for _, rawVal := range rawMap {
			trimmed := bytes.TrimSpace(rawVal)
			if len(trimmed) > 0 && trimmed[0] != '{' {
				isSingleFilter = true
				break
			}
		}
	}

	if !isSingleFilter && len(knownUsers) > 0 {
		hasKnownUser := false
		for k := range rawMap {
			for _, u := range knownUsers {
				if strings.EqualFold(k, u) {
					hasKnownUser = true
					break
				}
			}
			if hasKnownUser {
				break
			}
		}
		if !hasKnownUser {
			isSingleFilter = true
		}
	}

	if isSingleFilter {
		var filter SearchFilter
		if err := json.Unmarshal([]byte(rawJSON), &filter); err != nil {
			return nil, fmt.Errorf("parsing search filter: %w", err)
		}
		return UserFilterMap{"": filter}, nil
	}

	userMap := make(UserFilterMap)
	for username, userJSON := range rawMap {
		var filter SearchFilter
		if err := json.Unmarshal(userJSON, &filter); err != nil {
			return nil, fmt.Errorf("parsing search filter for user %q: %w", username, err)
		}
		userMap[username] = filter
	}

	return userMap, nil
}

