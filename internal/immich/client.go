package immich

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
)

type cacheEntry struct {
	val       any
	expiresAt time.Time
}

// ClientOptions configures optional settings for the Immich API client.
type ClientOptions struct {
	InsecureSkipVerify bool
	Timeout            time.Duration
}

// Client interacts with the Immich REST API.
type Client struct {
	baseURL    string
	httpClient *http.Client

	mu    sync.RWMutex
	cache map[string]cacheEntry
}

// NewClient creates a new Immich API client with default options.
func NewClient(baseURL string) *Client {
	return NewClientWithOptions(baseURL, ClientOptions{
		InsecureSkipVerify: false,
		Timeout:            45 * time.Second,
	})
}

// NewClientWithOptions creates a new Immich API client with specific options.
func NewClientWithOptions(baseURL string, opts ClientOptions) *Client {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}

	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        100,
		IdleConnTimeout:     90 * time.Second,
		MaxIdleConnsPerHost: 100,
		DialContext: (&net.Dialer{
			Timeout:   20 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: opts.InsecureSkipVerify,
		},
	}

	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   timeout,
		},
		cache: make(map[string]cacheEntry),
	}
}

func (c *Client) getCache(key string) (any, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.cache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.val, true
}

func (c *Client) setCache(key string, val any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache[key] = cacheEntry{
		val:       val,
		expiresAt: time.Now().Add(ttl),
	}
}

// ClearCache clears all cached metadata.
func (c *Client) ClearCache() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache = make(map[string]cacheEntry)
}

func (c *Client) doJSON(ctx context.Context, apiKey, method, endpoint string, query url.Values, body any) ([]byte, int, error) {
	if c.baseURL == "" {
		return nil, 0, fmt.Errorf("Immich URL is not configured")
	}
	if apiKey == "" {
		return nil, 0, fmt.Errorf("Immich API key is not configured")
	}

	u, err := url.Parse(c.baseURL)
	if err != nil {
		return nil, 0, fmt.Errorf("invalid Immich URL %q: %w", c.baseURL, err)
	}
	u.Path = path.Join(u.Path, endpoint)
	if len(query) > 0 {
		u.RawQuery = query.Encode()
	}

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshaling request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, u.String(), bodyReader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp struct {
			Message any `json:"message"`
			Error   any `json:"error"`
			Errors  any `json:"errors"`
		}
		if json.Unmarshal(respBytes, &errResp) == nil {
			if errResp.Errors != nil {
				if errBytes, err := json.Marshal(errResp.Errors); err == nil {
					return respBytes, resp.StatusCode, fmt.Errorf("Immich API (%d): %v - %s", resp.StatusCode, errResp.Message, string(errBytes))
				}
			}
			if errResp.Message != nil {
				return respBytes, resp.StatusCode, fmt.Errorf("Immich API (%d): %v", resp.StatusCode, errResp.Message)
			}
		}
		return respBytes, resp.StatusCode, fmt.Errorf("Immich API returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	return respBytes, resp.StatusCode, nil
}

// FetchPeople retrieves all named people for the given API key.
func (c *Client) FetchPeople(ctx context.Context, apiKey string) ([]Person, error) {
	cacheKey := "people:" + apiKey
	if cached, ok := c.getCache(cacheKey); ok {
		return cached.([]Person), nil
	}

	q := url.Values{"withHidden": []string{"false"}}
	data, _, err := c.doJSON(ctx, apiKey, http.MethodGet, "api/people", q, nil)
	if err != nil {
		return nil, err
	}

	var wrapper struct {
		People []Person `json:"people"`
	}
	var list []Person
	if err := json.Unmarshal(data, &wrapper); err == nil && wrapper.People != nil {
		list = wrapper.People
	} else if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}

	var named []Person
	for _, p := range list {
		if strings.TrimSpace(p.Name) != "" && !p.IsHidden {
			named = append(named, p)
		}
	}

	c.setCache(cacheKey, named, 15*time.Minute)
	return named, nil
}

// FetchAlbums retrieves all albums for the given API key.
func (c *Client) FetchAlbums(ctx context.Context, apiKey string) ([]Album, error) {
	cacheKey := "albums:" + apiKey
	if cached, ok := c.getCache(cacheKey); ok {
		return cached.([]Album), nil
	}

	data, _, err := c.doJSON(ctx, apiKey, http.MethodGet, "api/albums", nil, nil)
	if err != nil {
		return nil, err
	}

	var albums []Album
	if err := json.Unmarshal(data, &albums); err != nil {
		return nil, err
	}

	// Also fetch shared albums
	qShared := url.Values{"shared": []string{"true"}}
	if sharedData, _, errShared := c.doJSON(ctx, apiKey, http.MethodGet, "api/albums", qShared, nil); errShared == nil {
		var sharedAlbums []Album
		if json.Unmarshal(sharedData, &sharedAlbums) == nil {
			seen := make(map[string]bool, len(albums))
			for _, a := range albums {
				seen[a.ID] = true
			}
			for _, a := range sharedAlbums {
				if !seen[a.ID] {
					seen[a.ID] = true
					albums = append(albums, a)
				}
			}
		}
	}

	c.setCache(cacheKey, albums, 15*time.Minute)
	return albums, nil
}

// FetchTags retrieves all tags for the given API key.
func (c *Client) FetchTags(ctx context.Context, apiKey string) ([]Tag, error) {
	cacheKey := "tags:" + apiKey
	if cached, ok := c.getCache(cacheKey); ok {
		return cached.([]Tag), nil
	}

	data, _, err := c.doJSON(ctx, apiKey, http.MethodGet, "api/tags", nil, nil)
	if err != nil {
		return nil, err
	}

	var tags []Tag
	if err := json.Unmarshal(data, &tags); err != nil {
		return nil, err
	}

	c.setCache(cacheKey, tags, 15*time.Minute)
	return tags, nil
}

// FetchLocations retrieves countries, states, cities, camera models, camera makes, and lenses from /api/search/cities.
func (c *Client) FetchLocations(ctx context.Context, apiKey string) (LocationMetadata, error) {
	cacheKey := "locations:" + apiKey
	if cached, ok := c.getCache(cacheKey); ok {
		return cached.(LocationMetadata), nil
	}

	data, _, err := c.doJSON(ctx, apiKey, http.MethodGet, "api/search/cities", nil, nil)
	if err != nil {
		return LocationMetadata{}, err
	}

	var items []struct {
		ExifInfo struct {
			City      string `json:"city"`
			State     string `json:"state"`
			Country   string `json:"country"`
			Model     string `json:"model"`
			Make      string `json:"make"`
			LensModel string `json:"lensModel"`
		} `json:"exifInfo"`
	}
	if err := json.Unmarshal(data, &items); err != nil {
		return LocationMetadata{}, err
	}

	countries := make(map[string]struct{})
	states := make(map[string]struct{})
	cities := make(map[string]struct{})
	cameras := make(map[string]struct{})
	makes := make(map[string]struct{})
	lenses := make(map[string]struct{})

	for _, item := range items {
		if v := strings.TrimSpace(item.ExifInfo.Country); v != "" {
			countries[v] = struct{}{}
		}
		if v := strings.TrimSpace(item.ExifInfo.State); v != "" {
			states[v] = struct{}{}
		}
		if v := strings.TrimSpace(item.ExifInfo.City); v != "" {
			cities[v] = struct{}{}
		}
		if v := strings.TrimSpace(item.ExifInfo.Model); v != "" {
			cameras[v] = struct{}{}
		}
		if v := strings.TrimSpace(item.ExifInfo.Make); v != "" {
			makes[v] = struct{}{}
		}
		if v := strings.TrimSpace(item.ExifInfo.LensModel); v != "" {
			lenses[v] = struct{}{}
		}
	}

	locs := LocationMetadata{
		Countries: setToSortedSlice(countries),
		States:    setToSortedSlice(states),
		Cities:    setToSortedSlice(cities),
		Cameras:   setToSortedSlice(cameras),
		Makes:     setToSortedSlice(makes),
		Lenses:    setToSortedSlice(lenses),
	}

	c.setCache(cacheKey, locs, 30*time.Minute)
	return locs, nil
}

func typeUnset(t FilterAssetType) bool {
	return len(t.In) == 0 && t.Eq == "" && len(t.NotIn) == 0 && t.Ne == ""
}

func visibilityUnset(v FilterAssetVisibility) bool {
	return len(v.In) == 0 && v.Eq == "" && len(v.NotIn) == 0 && v.Ne == ""
}

func defaultTypeFilter(includeVideos bool) FilterAssetType {
	f := FilterAssetType{In: []AssetType{ImageType}}
	if includeVideos {
		f.In = append(f.In, VideoType)
	}
	return f
}

func defaultVisibilityFilter(includeArchived bool) FilterAssetVisibility {
	f := FilterAssetVisibility{In: []AssetVisibility{Timeline}}
	if includeArchived {
		f.In = append(f.In, Archive)
	}
	return f
}

// ApplyDefaultConstraints injects the default media type and visibility
// constraints wherever the user has not set one explicitly. When the filter has
// OR branches, a top-level default would be ANDed onto every branch and could
// silently cancel a branch that targets e.g. archived assets, so the defaults
// are applied per branch instead. The caller's filter is never mutated.
func ApplyDefaultConstraints(filter SearchFilter, includeVideos, includeArchived bool) SearchFilter {
	hasBranches := filter.Or != nil && len(*filter.Or) > 0

	if hasBranches {
		branches := make([]SearchFilterBranch, len(*filter.Or))
		copy(branches, *filter.Or)
		for i := range branches {
			if typeUnset(branches[i].Type) && typeUnset(filter.Type) {
				branches[i].Type = defaultTypeFilter(includeVideos)
			}
			if visibilityUnset(branches[i].Visibility) && visibilityUnset(filter.Visibility) {
				branches[i].Visibility = defaultVisibilityFilter(includeArchived)
			}
		}
		filter.Or = &branches
		return filter
	}

	if typeUnset(filter.Type) {
		filter.Type = defaultTypeFilter(includeVideos)
	}
	if visibilityUnset(filter.Visibility) {
		filter.Visibility = defaultVisibilityFilter(includeArchived)
	}
	return filter
}

// SearchRandom queries /api/search/random with the given SearchFilter.
func (c *Client) SearchRandom(ctx context.Context, apiKey string, filter SearchFilter, size int, includeVideos, includeArchived bool) ([]Asset, error) {
	if size <= 0 {
		size = 24
	}
	effectiveFilter := ApplyDefaultConstraints(filter, includeVideos, includeArchived)

	reqBody := SearchRequestBody{
		Filter:     effectiveFilter,
		Size:       size,
		WithExif:   true,
		WithPeople: true,
	}

	data, _, err := c.doJSON(ctx, apiKey, http.MethodPost, SearchRandomEndpoint, nil, reqBody)
	if err != nil {
		// Fallback to /api/search/metadata if random endpoint is rejected
		metaResp, metaErr := c.SearchMetadata(ctx, apiKey, filter, size, nil, includeVideos, includeArchived)
		if metaErr != nil {
			return nil, err
		}
		return metaResp.Assets.Items, nil
	}

	var assets []Asset
	if err := json.Unmarshal(data, &assets); err == nil && assets != nil {
		return assets, nil
	}

	var metaResp SearchMetadataResponse
	if err := json.Unmarshal(data, &metaResp); err == nil {
		return metaResp.Assets.Items, nil
	}

	return nil, nil
}

// SearchMetadata queries /api/search/metadata with the given SearchFilter.
func (c *Client) SearchMetadata(ctx context.Context, apiKey string, filter SearchFilter, size int, orderBy *SearchOrder, includeVideos, includeArchived bool) (SearchMetadataResponse, error) {
	var response SearchMetadataResponse
	if size <= 0 {
		size = 24
	}
	effectiveFilter := ApplyDefaultConstraints(filter, includeVideos, includeArchived)

	reqBody := SearchRequestBody{
		Filter:     effectiveFilter,
		OrderBy:    orderBy,
		Size:       size,
		WithExif:   true,
		WithPeople: true,
	}

	data, _, err := c.doJSON(ctx, apiKey, http.MethodPost, SearchMetadataEndpoint, nil, reqBody)
	if err != nil {
		return response, err
	}

	if err := json.Unmarshal(data, &response); err != nil {
		var list []Asset
		if errList := json.Unmarshal(data, &list); errList == nil {
			response.Assets.Items = list
			response.Assets.Total = len(list)
			return response, nil
		}
		return response, err
	}

	return response, nil
}

// SearchSmart queries /api/search/smart (CLIP semantic search) with a natural-language
// phrase, constrained by the given SearchFilter.
func (c *Client) SearchSmart(ctx context.Context, apiKey string, filter SearchFilter, query string, size int, includeVideos, includeArchived bool) ([]Asset, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("smart search needs a search phrase")
	}
	if size <= 0 {
		size = 24
	}

	reqBody := SearchRequestBody{
		Filter:     ApplyDefaultConstraints(filter, includeVideos, includeArchived),
		Query:      query,
		Size:       size,
		WithExif:   true,
		WithPeople: true,
	}

	data, _, err := c.doJSON(ctx, apiKey, http.MethodPost, SearchSmartEndpoint, nil, reqBody)
	if err != nil {
		return nil, err
	}

	var metaResp SearchMetadataResponse
	if err := json.Unmarshal(data, &metaResp); err == nil && (metaResp.Assets.Items != nil || metaResp.Assets.Total > 0) {
		return metaResp.Assets.Items, nil
	}
	var list []Asset
	if err := json.Unmarshal(data, &list); err == nil {
		return list, nil
	}
	return nil, nil
}

type cachedAssetCount struct {
	total int
	exact bool
}

// CountAssets counts matching assets using cursor pagination on /api/search/metadata up to maxCount.
func (c *Client) CountAssets(ctx context.Context, apiKey string, filter SearchFilter, maxCount int, includeVideos, includeArchived bool) (int, bool, error) {
	if maxCount <= 0 {
		maxCount = 1000000
	}
	effectiveFilter := ApplyDefaultConstraints(filter, includeVideos, includeArchived)

	var cacheKey string
	if filterBytes, err := json.Marshal(effectiveFilter); err == nil {
		cacheKey = fmt.Sprintf("count:%s:%d:%s", apiKey, maxCount, string(filterBytes))
		if cached, ok := c.getCache(cacheKey); ok {
			if res, ok := cached.(cachedAssetCount); ok {
				return res.total, res.exact, nil
			}
		}
	}

	total := 0
	cursor := ""

	for {
		reqBody := SearchRequestBody{
			Filter:     effectiveFilter,
			Size:       1000,
			WithExif:   false,
			WithPeople: false,
			Cursor:     cursor,
		}

		data, _, err := c.doJSON(ctx, apiKey, http.MethodPost, SearchMetadataEndpoint, nil, reqBody)
		if err != nil {
			return total, false, err
		}

		var resp struct {
			Assets struct {
				Count      int        `json:"count"`
				Items      []struct{} `json:"items"`
				NextCursor string     `json:"nextCursor"`
			} `json:"assets"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return total, false, err
		}

		pageCount := resp.Assets.Count
		if pageCount == 0 && len(resp.Assets.Items) > 0 {
			pageCount = len(resp.Assets.Items)
		}
		total += pageCount

		if resp.Assets.NextCursor == "" || pageCount == 0 || total >= maxCount {
			isExact := resp.Assets.NextCursor == "" || pageCount == 0
			if cacheKey != "" {
				c.setCache(cacheKey, cachedAssetCount{total: total, exact: isExact}, 45*time.Second)
			}
			return total, isExact, nil
		}
		cursor = resp.Assets.NextCursor
	}
}

// ProxyAssetMedia streams an asset thumbnail or original media file from Immich.
func (c *Client) ProxyAssetMedia(ctx context.Context, apiKey, assetID, mediaType, sizeParam string, w http.ResponseWriter, r *http.Request) error {
	if c.baseURL == "" || apiKey == "" {
		return fmt.Errorf("Immich credentials not configured")
	}

	u, err := url.Parse(c.baseURL)
	if err != nil {
		return err
	}

	if mediaType == "original" {
		u.Path = path.Join(u.Path, "api/assets", assetID, "original")
	} else {
		u.Path = path.Join(u.Path, "api/assets", assetID, "thumbnail")
		q := url.Values{}
		if sizeParam != "" {
			q.Set("size", sizeParam)
		} else {
			q.Set("size", "thumbnail")
		}
		u.RawQuery = q.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", apiKey)
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	for _, hdr := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if val := resp.Header.Get(hdr); val != "" {
			w.Header().Set(hdr, val)
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(resp.StatusCode)
	_, err = io.Copy(w, resp.Body)
	return err
}

func setToSortedSlice(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
