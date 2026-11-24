package server

import "testing"

func TestMergeSortedUserAssetLists(t *testing.T) {
	alice := []assetItem{{ID: "a1", sortKey: 90}, {ID: "a2", sortKey: 40}, {ID: "dup", sortKey: 30}}
	bob := []assetItem{{ID: "b1", sortKey: 80}, {ID: "b2", sortKey: 70}, {ID: "dup", sortKey: 30}}

	ids := func(items []assetItem) []string {
		out := make([]string, len(items))
		for i, it := range items {
			out[i] = it.ID
		}
		return out
	}
	eq := func(a, b []string) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if a[i] != b[i] {
				return false
			}
		}
		return true
	}

	desc := ids(mergeSortedUserAssetLists([][]assetItem{alice, bob}, 5, true))
	if want := []string{"a1", "b1", "b2", "a2", "dup"}; !eq(desc, want) {
		t.Errorf("descending merge = %v, want %v", desc, want)
	}

	asc := ids(mergeSortedUserAssetLists([][]assetItem{alice, bob}, 3, false))
	if want := []string{"dup", "a2", "b2"}; !eq(asc, want) {
		t.Errorf("ascending limited merge = %v, want %v", asc, want)
	}

	if got := mergeSortedUserAssetLists(nil, 5, true); got == nil || len(got) != 0 {
		t.Errorf("empty merge should return empty non-nil slice, got %#v", got)
	}
}
