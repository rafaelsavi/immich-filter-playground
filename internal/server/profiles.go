package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SearchProfile represents a saved search configuration.
type SearchProfile struct {
	ID               string                `json:"id"`
	Name             string                `json:"name"`
	IsDefault        bool                  `json:"isDefault,omitempty"`
	FilterJSON       string                `json:"filterJson"`
	RuleTree         json.RawMessage       `json:"ruleTree,omitempty"`
	History          []ProfileHistoryEntry `json:"history,omitempty"`
	HistoryIndex     int                   `json:"historyIndex"`
	SearchMode       string                `json:"searchMode,omitempty"`
	SmartQuery       string                `json:"smartQuery,omitempty"`
	User             string                `json:"user,omitempty"`
	Limit            int                   `json:"limit,omitempty"`
	OrderByField     string                `json:"orderByField,omitempty"`
	OrderByDirection string                `json:"orderByDirection,omitempty"`
	IncludeVideos    *bool                 `json:"includeVideos,omitempty"`
	IncludeArchived  *bool                 `json:"includeArchived,omitempty"`
	CreatedAt        time.Time             `json:"createdAt"`
	UpdatedAt        time.Time             `json:"updatedAt"`
}

type ProfileHistoryEntry struct {
	Label     string          `json:"label"`
	Detail    string          `json:"detail,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
	Snapshot  json.RawMessage `json:"snapshot"`
}

type profileStore struct {
	mu       sync.RWMutex
	filePath string
}

func newProfileStore(filePath string) *profileStore {
	if filePath == "" {
		filePath = "profiles.json"
	}
	return &profileStore{filePath: filePath}
}

func (ps *profileStore) Load() ([]SearchProfile, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	data, err := os.ReadFile(ps.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []SearchProfile{}, nil
		}
		return nil, err
	}

	var profiles []SearchProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, err
	}
	return profiles, nil
}

const maxProfileHistoryEntries = 50

func writeFileAtomic(filePath string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	} else {
		dir = "."
	}

	tmpFile, err := os.CreateTemp(dir, ".profiles-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Chmod(perm); err != nil {
		// Ignore Chmod errors on filesystems that don't support POSIX modes
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, filePath); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func (ps *profileStore) Save(p SearchProfile) (SearchProfile, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	profiles, err := ps.readAllLocked()
	if err != nil {
		return p, err
	}

	now := time.Now().UTC()
	p = upsertProfile(&profiles, p, now, 0)

	out, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return p, err
	}
	if err := writeFileAtomic(ps.filePath, out, 0644); err != nil {
		return p, err
	}
	return p, nil
}

func (ps *profileStore) readAllLocked() ([]SearchProfile, error) {
	var profiles []SearchProfile
	data, err := os.ReadFile(ps.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("reading existing profiles: %w", err)
		}
		return profiles, nil
	}
	if len(bytes.TrimSpace(data)) > 0 {
		if err := json.Unmarshal(data, &profiles); err != nil {
			return nil, fmt.Errorf("parsing existing profiles: %w", err)
		}
	}
	return profiles, nil
}

func upsertProfile(profiles *[]SearchProfile, p SearchProfile, now time.Time, seqOffset int) SearchProfile {
	if strings.TrimSpace(p.ID) == "" {
		p.ID = fmt.Sprintf("prof_%d", now.UnixNano()+int64(seqOffset))
		p.CreatedAt = now
	}
	p.UpdatedAt = now

	for i, existing := range *profiles {
		if existing.ID == p.ID {
			if existing.CreatedAt.IsZero() {
				p.CreatedAt = now
			} else {
				p.CreatedAt = existing.CreatedAt
			}
			(*profiles)[i] = p
			return p
		}
	}
	if p.CreatedAt.IsZero() {
		p.CreatedAt = now
	}
	*profiles = append(*profiles, p)
	return p
}

// SaveBatch upserts all incoming profiles into the store in a single atomic write.
func (ps *profileStore) SaveBatch(incoming []SearchProfile) ([]SearchProfile, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	profiles, err := ps.readAllLocked()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	for i, p := range incoming {
		upsertProfile(&profiles, p, now, i)
	}

	out, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(ps.filePath, out, 0644); err != nil {
		return nil, err
	}
	return profiles, nil
}

func (ps *profileStore) Delete(id string) (bool, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	data, err := os.ReadFile(ps.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}

	var profiles []SearchProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return false, err
	}

	filtered := make([]SearchProfile, 0, len(profiles))
	found := false
	for _, p := range profiles {
		if p.ID == id {
			found = true
			continue
		}
		filtered = append(filtered, p)
	}

	if !found {
		return false, nil
	}

	out, err := json.MarshalIndent(filtered, "", "  ")
	if err != nil {
		return false, err
	}
	return true, writeFileAtomic(ps.filePath, out, 0644)
}

func (s *Server) handleGetProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := s.profiles.Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": profiles})
}

func sanitizeProfile(p SearchProfile) (SearchProfile, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return p, fmt.Errorf("Profile name is required")
	}
	if len(p.History) > maxProfileHistoryEntries {
		drop := len(p.History) - maxProfileHistoryEntries
		p.History = p.History[drop:]
		p.HistoryIndex -= drop
	}
	if len(p.History) == 0 {
		p.HistoryIndex = 0
	} else {
		if p.HistoryIndex < 0 {
			p.HistoryIndex = 0
		} else if p.HistoryIndex >= len(p.History) {
			p.HistoryIndex = len(p.History) - 1
		}
	}
	return p, nil
}

func (s *Server) handleSaveProfile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var p SearchProfile
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid profile payload: " + err.Error()})
		return
	}
	sanitized, err := sanitizeProfile(p)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	saved, err := s.profiles.Save(sanitized)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Saving profile failed: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": saved})
}

func (s *Server) handleImportProfiles(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid import payload: " + err.Error()})
		return
	}

	var incoming []SearchProfile
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &incoming); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid profiles array: " + err.Error()})
			return
		}
	} else {
		var wrapper struct {
			Profiles []SearchProfile `json:"profiles"`
		}
		if err := json.Unmarshal(trimmed, &wrapper); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid profiles payload: " + err.Error()})
			return
		}
		incoming = wrapper.Profiles
	}

	if len(incoming) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "No profiles provided for import"})
		return
	}

	sanitized := make([]SearchProfile, 0, len(incoming))
	for i, p := range incoming {
		clean, err := sanitizeProfile(p)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("Profile %d: %s", i+1, err.Error())})
			return
		}
		sanitized = append(sanitized, clean)
	}

	allProfiles, err := s.profiles.SaveBatch(sanitized)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Importing profiles failed: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"profiles": allProfiles,
		"imported": len(sanitized),
	})
}

func (s *Server) handleDeleteProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Profile ID is required"})
		return
	}
	deleted, err := s.profiles.Delete(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Deleting profile failed: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}
