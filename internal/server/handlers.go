package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"
	"immich-filter-playground/internal/immich"
)

type metadataOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Count int    `json:"count,omitempty"`
}

type metadataPayload struct {
	People    []metadataOption `json:"people"`
	Albums    []metadataOption `json:"albums"`
	Tags      []metadataOption `json:"tags"`
	Countries []string         `json:"countries"`
	States    []string         `json:"states"`
	Cities    []string         `json:"cities"`
	Cameras   []string         `json:"cameras"`
	Makes     []string         `json:"makes"`
	Lenses    []string         `json:"lenses"`
}

type bootstrapResponse struct {
	Configured   bool            `json:"configured"`
	ImmichURL    string          `json:"immichUrl"`
	ExternalURL  string          `json:"externalUrl"`
	Accounts     []string        `json:"accounts"`
	SelectedUser string          `json:"selectedUser"`
	Defaults     any             `json:"defaults"`
	Metadata     metadataPayload `json:"metadata"`
	Warnings     []string        `json:"warnings,omitempty"`
}

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	selectedUser := strings.TrimSpace(r.URL.Query().Get("user"))
	if selectedUser == "all" {
		selectedUser = ""
	}

	meta, warnings := s.collectMetadata(r.Context(), selectedUser)

	resp := bootstrapResponse{
		Configured:   s.cfg.IsConfigured(),
		ImmichURL:    s.cfg.Immich.URL,
		ExternalURL:  s.cfg.ExternalURL(),
		Accounts:     s.cfg.AccountNames(),
		SelectedUser: selectedUser,
		Defaults:     s.cfg.Defaults,
		Metadata:     meta,
		Warnings:     warnings,
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRefreshMetadata(w http.ResponseWriter, r *http.Request) {
	s.client.ClearCache()
	selectedUser := strings.TrimSpace(r.URL.Query().Get("user"))
	if selectedUser == "all" {
		selectedUser = ""
	}
	meta, warnings := s.collectMetadata(r.Context(), selectedUser)
	writeJSON(w, http.StatusOK, map[string]any{
		"metadata": meta,
		"warnings": warnings,
	})
}

func (s *Server) collectMetadata(ctx context.Context, selectedUser string) (metadataPayload, []string) {
	payload := metadataPayload{
		People:    []metadataOption{},
		Albums:    []metadataOption{},
		Tags:      []metadataOption{},
		Countries: []string{},
		States:    []string{},
		Cities:    []string{},
		Cameras:   []string{},
		Makes:     []string{},
		Lenses:    []string{},
	}

	if !s.cfg.IsConfigured() {
		return payload, []string{"Immich URL or API key is not configured. Edit config.yaml or set IMMICH_URL and IMMICH_API_KEY."}
	}

	accounts := s.cfg.AccountNames()
	var usersToFetch []string
	isMultiUser := false

	if selectedUser != "" {
		usersToFetch = []string{selectedUser}
	} else if len(accounts) > 0 {
		usersToFetch = accounts
		if len(accounts) > 1 {
			isMultiUser = true
		}
	} else {
		usersToFetch = []string{""}
	}

	var g errgroup.Group
	var mu sync.Mutex

	seenPeople := make(map[string]bool)
	seenAlbums := make(map[string]bool)
	seenTags := make(map[string]bool)

	countrySet := make(map[string]struct{})
	stateSet := make(map[string]struct{})
	citySet := make(map[string]struct{})
	cameraSet := make(map[string]struct{})
	makeSet := make(map[string]struct{})
	lensSet := make(map[string]struct{})

	var warnings []string

	for _, u := range usersToFetch {
		username := u
		apiKey := s.cfg.APIKeyForUser(username)
		if apiKey == "" {
			continue
		}

		g.Go(func() error {
			people, pplErr := s.client.FetchPeople(ctx, apiKey)
			albums, albErr := s.client.FetchAlbums(ctx, apiKey)
			tags, tagErr := s.client.FetchTags(ctx, apiKey)
			locs, locErr := s.client.FetchLocations(ctx, apiKey)

			mu.Lock()
			defer mu.Unlock()

			userLabel := username
			if userLabel == "" {
				userLabel = "default"
			}
			if pplErr != nil {
				warnings = append(warnings, fmt.Sprintf("people (%s): %v", userLabel, pplErr))
			}
			if albErr != nil {
				warnings = append(warnings, fmt.Sprintf("albums (%s): %v", userLabel, albErr))
			}
			if tagErr != nil {
				warnings = append(warnings, fmt.Sprintf("tags (%s): %v", userLabel, tagErr))
			}
			if locErr != nil {
				warnings = append(warnings, fmt.Sprintf("locations (%s): %v", userLabel, locErr))
			}

			for _, p := range people {
				if !seenPeople[p.ID] {
					seenPeople[p.ID] = true
					label := p.Name
					if isMultiUser && username != "" {
						label = fmt.Sprintf("%s (@%s)", p.Name, username)
					}
					payload.People = append(payload.People, metadataOption{ID: p.ID, Label: label})
				}
			}

			for _, a := range albums {
				if !seenAlbums[a.ID] {
					seenAlbums[a.ID] = true
					label := a.AlbumName
					if isMultiUser && username != "" {
						label = fmt.Sprintf("%s (@%s)", a.AlbumName, username)
					}
					payload.Albums = append(payload.Albums, metadataOption{ID: a.ID, Label: label, Count: a.AssetCount})
				}
			}

			for _, t := range tags {
				key := t.ID
				if key == "" {
					key = strings.ToLower(t.Name)
				}
				if !seenTags[key] {
					seenTags[key] = true
					label := t.Value
					if label == "" {
						label = t.Name
					}
					payload.Tags = append(payload.Tags, metadataOption{ID: t.ID, Label: label})
				}
			}

			for _, v := range locs.Countries {
				countrySet[v] = struct{}{}
			}
			for _, v := range locs.States {
				stateSet[v] = struct{}{}
			}
			for _, v := range locs.Cities {
				citySet[v] = struct{}{}
			}
			for _, v := range locs.Cameras {
				cameraSet[v] = struct{}{}
			}
			for _, v := range locs.Makes {
				makeSet[v] = struct{}{}
			}
			for _, v := range locs.Lenses {
				lensSet[v] = struct{}{}
			}

			return nil
		})
	}
	_ = g.Wait()

	sort.Slice(payload.People, func(i, j int) bool {
		return strings.ToLower(payload.People[i].Label) < strings.ToLower(payload.People[j].Label)
	})
	sort.Slice(payload.Albums, func(i, j int) bool {
		return strings.ToLower(payload.Albums[i].Label) < strings.ToLower(payload.Albums[j].Label)
	})
	sort.Slice(payload.Tags, func(i, j int) bool {
		return strings.ToLower(payload.Tags[i].Label) < strings.ToLower(payload.Tags[j].Label)
	})

	payload.Countries = mapKeysSorted(countrySet)
	payload.States = mapKeysSorted(stateSet)
	payload.Cities = mapKeysSorted(citySet)
	payload.Cameras = mapKeysSorted(cameraSet)
	payload.Makes = mapKeysSorted(makeSet)
	payload.Lenses = mapKeysSorted(lensSet)

	return payload, warnings
}

type searchRequest struct {
	FilterJSON       string `json:"filterJson"`
	User             string `json:"user"`
	Limit            int    `json:"limit"`
	SearchMode       string `json:"searchMode"`
	OrderByField     string `json:"orderByField"`
	OrderByDirection string `json:"orderByDirection"`
	IncludeVideos    *bool  `json:"includeVideos"`
	IncludeArchived  *bool  `json:"includeArchived"`
}

type assetItem struct {
	ID           string   `json:"id"`
	ThumbnailURL string   `json:"thumbnailUrl"`
	PreviewURL   string   `json:"previewUrl"`
	OriginalURL  string   `json:"originalUrl"`
	ImmichWebURL string   `json:"immichWebUrl"`
	User         string   `json:"user,omitempty"`
	Type         string   `json:"type"`
	Filename     string   `json:"filename"`
	TakenAt      string   `json:"takenAt,omitempty"`
	City         string   `json:"city,omitempty"`
	State        string   `json:"state,omitempty"`
	Country      string   `json:"country,omitempty"`
	Make         string   `json:"make,omitempty"`
	Model        string   `json:"model,omitempty"`
	LensModel    string   `json:"lensModel,omitempty"`
	IsFavorite   bool     `json:"isFavorite"`
	IsArchived   bool     `json:"isArchived"`
	Rating       int      `json:"rating,omitempty"`
	People       []string `json:"people,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	Description  string   `json:"description,omitempty"`
	Width        int      `json:"width,omitempty"`
	Height       int      `json:"height,omitempty"`
}

type searchResponse struct {
	Total            int          `json:"total"`
	TotalExact       bool         `json:"totalExact"`
	Limit            int          `json:"limit"`
	SearchMode       string       `json:"searchMode"`
	NormalizedFilter string       `json:"normalizedFilter"`
	RequestBodyJSON  string       `json:"requestBodyJson"`
	Assets           []assetItem  `json:"assets"`
	Error            string       `json:"error,omitempty"`
	Warnings         []string     `json:"warnings,omitempty"`
}

type userFilterQuery struct {
	user   string
	filter immich.SearchFilter
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.IsConfigured() {
		writeJSON(w, http.StatusOK, searchResponse{
			Error: "Immich URL or API key is not configured. Please check config.yaml or environment variables.",
		})
		return
	}

	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, searchResponse{
			Error: fmt.Sprintf("Invalid search request payload: %v", err),
		})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = s.cfg.Defaults.SampleSize
	}
	if limit > 250 {
		limit = 250
	}

	searchMode := strings.ToLower(strings.TrimSpace(req.SearchMode))
	if searchMode != "metadata" && searchMode != "random" {
		searchMode = s.cfg.Defaults.SearchMode
	}

	includeVideos := s.cfg.Defaults.IncludeVideos
	if req.IncludeVideos != nil {
		includeVideos = *req.IncludeVideos
	}
	includeArchived := s.cfg.Defaults.IncludeArchived
	if req.IncludeArchived != nil {
		includeArchived = *req.IncludeArchived
	}

	selectedUser := strings.TrimSpace(req.User)
	if selectedUser == "all" {
		selectedUser = ""
	}

	knownUsers := s.cfg.AccountNames()
	rawFilter := strings.TrimSpace(req.FilterJSON)
	if rawFilter == "" {
		rawFilter = "{}"
	}

	userFilters, err := immich.ParseUserFilters(rawFilter, knownUsers)
	if err != nil {
		writeJSON(w, http.StatusOK, searchResponse{
			Limit:      limit,
			SearchMode: searchMode,
			Error:      fmt.Sprintf("Invalid Filter JSON: %v", err),
		})
		return
	}

	var prettyBuf bytes.Buffer
	normalizedFilter := rawFilter
	if json.Indent(&prettyBuf, []byte(rawFilter), "", "  ") == nil {
		normalizedFilter = prettyBuf.String()
	}

	// Determine which user queries to execute
	var queries []userFilterQuery
	if selectedUser != "" {
		if f, ok := userFilters.ForUser(selectedUser); ok {
			queries = append(queries, userFilterQuery{user: selectedUser, filter: f})
		} else {
			for _, f := range userFilters {
				queries = append(queries, userFilterQuery{user: selectedUser, filter: f})
				break
			}
		}
	} else {
		hasSpecificUsers := false
		for u := range userFilters {
			if u != "" && u != "*" && u != "default" {
				hasSpecificUsers = true
				break
			}
		}
		if hasSpecificUsers {
			for u, f := range userFilters {
				if u != "" && u != "*" && u != "default" {
					queries = append(queries, userFilterQuery{user: u, filter: f})
				}
			}
			sort.Slice(queries, func(i, j int) bool { return queries[i].user < queries[j].user })
		} else if len(knownUsers) > 1 {
			for _, u := range knownUsers {
				if f, ok := userFilters.ForUser(u); ok {
					queries = append(queries, userFilterQuery{user: u, filter: f})
				}
			}
		} else {
			user := ""
			if len(knownUsers) == 1 {
				user = knownUsers[0]
			}
			for _, f := range userFilters {
				queries = append(queries, userFilterQuery{user: user, filter: f})
				break
			}
		}
	}

	if len(queries) == 0 {
		queries = append(queries, userFilterQuery{user: "", filter: immich.SearchFilter{}})
	}

	var orderBy []immich.SearchOrder
	if searchMode == "metadata" && req.OrderByField != "" {
		dir := immich.Desc
		if strings.ToLower(req.OrderByDirection) == "asc" {
			dir = immich.Asc
		}
		orderBy = []immich.SearchOrder{{Field: req.OrderByField, Direction: dir}}
	}

	// Build representative request body JSON for display
	repFilter := immich.ApplyDefaultConstraints(queries[0].filter, includeVideos, includeArchived)
	repReqBody := immich.SearchRequestBody{
		Filter:     repFilter,
		OrderBy:    orderBy,
		Size:       limit,
		WithExif:   true,
		WithPeople: true,
	}
	reqBodyBytes, _ := json.MarshalIndent(repReqBody, "", "  ")

	var g errgroup.Group
	var mu sync.Mutex
	userLists := make([][]assetItem, len(queries))
	var searchErrors []string

	var countG errgroup.Group
	var countMu sync.Mutex
	totalMatching := 0
	isExactCount := true

	for idx, q := range queries {
		i := idx
		query := q
		apiKey := s.cfg.APIKeyForUser(query.user)

		g.Go(func() error {
			items, err := s.executeUserSearch(r.Context(), apiKey, query, limit, searchMode, orderBy, includeVideos, includeArchived)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				uLabel := query.user
				if uLabel == "" {
					uLabel = "default"
				}
				searchErrors = append(searchErrors, fmt.Sprintf("%s: %v", uLabel, err))
				return nil
			}
			userLists[i] = items
			return nil
		})

		countG.Go(func() error {
			c, exact, err := s.client.CountAssets(r.Context(), apiKey, query.filter, 5000, includeVideos, includeArchived)
			if err == nil {
				countMu.Lock()
				totalMatching += c
				if !exact {
					isExactCount = false
				}
				countMu.Unlock()
			}
			return nil
		})
	}

	_ = g.Wait()
	_ = countG.Wait()

	merged := interleaveUserAssetLists(userLists, limit)
	if totalMatching < len(merged) {
		totalMatching = len(merged)
	}

	errMsg := ""
	if len(searchErrors) > 0 && len(merged) == 0 {
		errMsg = strings.Join(searchErrors, " | ")
	}

	writeJSON(w, http.StatusOK, searchResponse{
		Total:            totalMatching,
		TotalExact:       isExactCount,
		Limit:            limit,
		SearchMode:       searchMode,
		NormalizedFilter: normalizedFilter,
		RequestBodyJSON:  string(reqBodyBytes),
		Assets:           merged,
		Error:            errMsg,
		Warnings:         searchErrors,
	})
}

func (s *Server) executeUserSearch(
	ctx context.Context,
	apiKey string,
	q userFilterQuery,
	limit int,
	searchMode string,
	orderBy []immich.SearchOrder,
	includeVideos, includeArchived bool,
) ([]assetItem, error) {
	var assets []immich.Asset
	var err error

	if searchMode == "metadata" {
		resp, metaErr := s.client.SearchMetadata(ctx, apiKey, q.filter, limit, orderBy, includeVideos, includeArchived)
		err = metaErr
		assets = resp.Assets.Items
	} else {
		assets, err = s.client.SearchRandom(ctx, apiKey, q.filter, limit, includeVideos, includeArchived)
		if err == nil {
			assets = s.supplementMultiValueRandomSample(ctx, apiKey, q.filter, assets, includeVideos, includeArchived)
		}
	}
	if err != nil {
		return nil, err
	}

	externalBase := s.cfg.ExternalURL()
	out := make([]assetItem, 0, len(assets))
	seen := make(map[string]bool, len(assets))

	for _, a := range assets {
		if seen[a.ID] {
			continue
		}
		seen[a.ID] = true

		userQuery := ""
		if q.user != "" {
			userQuery = "?user=" + url.QueryEscape(q.user)
		}

		takenAt := ""
		if !a.ExifInfo.DateTimeOriginal.IsZero() {
			takenAt = a.ExifInfo.DateTimeOriginal.Format("2006-01-02 15:04")
		} else if !a.LocalDateTime.IsZero() {
			takenAt = a.LocalDateTime.Format("2006-01-02 15:04")
		}

		var people []string
		for _, p := range a.People {
			if name := strings.TrimSpace(p.Name); name != "" {
				people = append(people, name)
			}
		}

		var tags []string
		for _, t := range a.Tags {
			label := strings.TrimSpace(t.Value)
			if label == "" {
				label = strings.TrimSpace(t.Name)
			}
			if label != "" {
				tags = append(tags, label)
			}
		}

		immichWebURL := ""
		if externalBase != "" {
			immichWebURL = fmt.Sprintf("%s/photos/%s", externalBase, a.ID)
		}

		out = append(out, assetItem{
			ID:           a.ID,
			ThumbnailURL: fmt.Sprintf("/api/media/thumbnail/%s%s", a.ID, userQuery),
			PreviewURL:   fmt.Sprintf("/api/media/preview/%s%s", a.ID, userQuery),
			OriginalURL:  fmt.Sprintf("/api/media/original/%s%s", a.ID, userQuery),
			ImmichWebURL: immichWebURL,
			User:         q.user,
			Type:         string(a.Type),
			Filename:     a.OriginalFileName,
			TakenAt:      takenAt,
			City:         a.ExifInfo.City,
			State:        a.ExifInfo.State,
			Country:      a.ExifInfo.Country,
			Make:         a.ExifInfo.Make,
			Model:        a.ExifInfo.Model,
			LensModel:    a.ExifInfo.LensModel,
			IsFavorite:   a.IsFavorite,
			IsArchived:   a.IsArchived,
			Rating:       a.ExifInfo.Rating,
			People:       people,
			Tags:         tags,
			Description:  a.ExifInfo.Description,
			Width:        a.ExifInfo.ExifImageWidth,
			Height:       a.ExifInfo.ExifImageHeight,
		})
	}

	return out, nil
}

// supplementMultiValueRandomSample ensures that when multiple countries/cities/states/models are requested
// via `in`, none of the requested values are starved out of the random sample.
func (s *Server) supplementMultiValueRandomSample(
	ctx context.Context,
	apiKey string,
	filter immich.SearchFilter,
	assets []immich.Asset,
	includeVideos, includeArchived bool,
) []immich.Asset {
	if len(filter.Country.In) > 1 {
		present := make(map[string]bool)
		for _, a := range assets {
			present[strings.ToLower(strings.TrimSpace(a.ExifInfo.Country))] = true
		}
		for _, c := range filter.Country.In {
			if !present[strings.ToLower(strings.TrimSpace(c))] {
				sub := filter
				sub.Country = immich.StringFilterNullable{Eq: c}
				if extra, err := s.client.SearchRandom(ctx, apiKey, sub, 6, includeVideos, includeArchived); err == nil {
					assets = append(assets, extra...)
				}
			}
		}
	}

	if len(filter.City.In) > 1 {
		present := make(map[string]bool)
		for _, a := range assets {
			present[strings.ToLower(strings.TrimSpace(a.ExifInfo.City))] = true
		}
		for _, city := range filter.City.In {
			if !present[strings.ToLower(strings.TrimSpace(city))] {
				sub := filter
				sub.City = immich.StringFilterNullable{Eq: city}
				if extra, err := s.client.SearchRandom(ctx, apiKey, sub, 6, includeVideos, includeArchived); err == nil {
					assets = append(assets, extra...)
				}
			}
		}
	}

	return assets
}

func (s *Server) handleMediaProxy(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	id := r.PathValue("id")
	user := strings.TrimSpace(r.URL.Query().Get("user"))
	apiKey := s.cfg.APIKeyForUser(user)

	var mediaType, sizeParam string
	switch kind {
	case "original":
		mediaType = "original"
	case "preview":
		mediaType = "thumbnail"
		sizeParam = "preview"
	default:
		mediaType = "thumbnail"
		sizeParam = "thumbnail"
	}

	if err := s.client.ProxyAssetMedia(r.Context(), apiKey, id, mediaType, sizeParam, w, r); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
	}
}

func interleaveUserAssetLists(groups [][]assetItem, limit int) []assetItem {
	seen := make(map[string]bool)
	var out []assetItem
	maxLen := 0
	for _, g := range groups {
		if len(g) > maxLen {
			maxLen = len(g)
		}
	}

	for i := 0; i < maxLen; i++ {
		for _, g := range groups {
			if i < len(g) {
				item := g[i]
				if !seen[item.ID] {
					seen[item.ID] = true
					out = append(out, item)
					if len(out) >= limit {
						return out
					}
				}
			}
		}
	}
	if out == nil {
		return []assetItem{}
	}
	return out
}

func mapKeysSorted(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

