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

	var profiles []SearchProfile
	data, err := os.ReadFile(ps.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return p, fmt.Errorf("reading existing profiles: %w", err)
		}
	} else if len(bytes.TrimSpace(data)) > 0 {
		if err := json.Unmarshal(data, &profiles); err != nil {
			return p, fmt.Errorf("parsing existing profiles: %w", err)
		}
	}

	now := time.Now().UTC()
	if strings.TrimSpace(p.ID) == "" {
		p.ID = fmt.Sprintf("prof_%d", now.UnixNano())
		p.CreatedAt = now
	}
	p.UpdatedAt = now

	found := false
	for i, existing := range profiles {
		if existing.ID == p.ID {
			if existing.CreatedAt.IsZero() {
				p.CreatedAt = now
			} else {
				p.CreatedAt = existing.CreatedAt
			}
			profiles[i] = p
			found = true
			break
		}
	}
	if !found {
		if p.CreatedAt.IsZero() {
			p.CreatedAt = now
		}
		profiles = append(profiles, p)
	}

	out, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return p, err
	}
	if err := writeFileAtomic(ps.filePath, out, 0644); err != nil {
		return p, err
	}
	return p, nil
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

func (s *Server) handleSaveProfile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	var p SearchProfile
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid profile payload: " + err.Error()})
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Profile name is required"})
		return
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
	saved, err := s.profiles.Save(p)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Saving profile failed: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": saved})
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
