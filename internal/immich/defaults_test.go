package immich

import "testing"

func TestApplyDefaultConstraintsTopLevel(t *testing.T) {
	f := ApplyDefaultConstraints(SearchFilter{}, true, false)
	if len(f.Type.In) != 2 || f.Type.In[0] != ImageType || f.Type.In[1] != VideoType {
		t.Errorf("unexpected default type: %+v", f.Type)
	}
	if len(f.Visibility.In) != 1 || f.Visibility.In[0] != Timeline {
		t.Errorf("unexpected default visibility: %+v", f.Visibility)
	}

	explicit := SearchFilter{Visibility: FilterAssetVisibility{In: []AssetVisibility{Archive}}}
	f = ApplyDefaultConstraints(explicit, false, true)
	if len(f.Visibility.In) != 1 || f.Visibility.In[0] != Archive {
		t.Errorf("explicit visibility must be preserved, got %+v", f.Visibility)
	}
	if len(f.Type.In) != 1 || f.Type.In[0] != ImageType {
		t.Errorf("unexpected default type without videos: %+v", f.Type)
	}
}

func TestApplyDefaultConstraintsRespectsOrBranches(t *testing.T) {
	branches := []SearchFilterBranch{
		{Visibility: FilterAssetVisibility{In: []AssetVisibility{Archive}}},
		{IsFavorite: BoolFilter{Eq: boolPtr(true)}},
	}
	original := SearchFilter{Or: &branches}

	f := ApplyDefaultConstraints(original, false, false)

	if !visibilityUnset(f.Visibility) || !typeUnset(f.Type) {
		t.Fatalf("defaults must not be injected at top level when OR branches exist: %+v / %+v", f.Visibility, f.Type)
	}
	got := *f.Or
	if len(got) != 2 {
		t.Fatalf("expected 2 branches, got %d", len(got))
	}
	if len(got[0].Visibility.In) != 1 || got[0].Visibility.In[0] != Archive {
		t.Errorf("explicit archive branch must keep its visibility, got %+v", got[0].Visibility)
	}
	if len(got[1].Visibility.In) != 1 || got[1].Visibility.In[0] != Timeline {
		t.Errorf("favorite branch should receive default visibility, got %+v", got[1].Visibility)
	}
	if len(got[0].Type.In) != 1 || len(got[1].Type.In) != 1 {
		t.Errorf("every branch should receive default type, got %+v / %+v", got[0].Type, got[1].Type)
	}

	// The caller's branches must not be mutated.
	if !visibilityUnset(branches[1].Visibility) || !typeUnset(branches[0].Type) {
		t.Errorf("ApplyDefaultConstraints mutated the caller's OR branches")
	}
}

func boolPtr(b bool) *bool { return &b }
