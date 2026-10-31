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

func ApplyDefaultConstraints(filter SearchFilter, includeVideos, includeArchived bool) SearchFilter {
	if len(filter.Type.In) == 0 && filter.Type.Eq == "" && len(filter.Type.NotIn) == 0 && filter.Type.Ne == "" {
		filter.Type = FilterAssetType{In: []AssetType{ImageType}}
		if includeVideos {
			filter.Type.In = append(filter.Type.In, VideoType)
		}
	}
	if len(filter.Visibility.In) == 0 && filter.Visibility.Eq == "" && len(filter.Visibility.NotIn) == 0 && filter.Visibility.Ne == "" {
		filter.Visibility = FilterAssetVisibility{In: []AssetVisibility{Timeline}}
		if includeArchived {
			filter.Visibility.In = append(filter.Visibility.In, Archive)
		}
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

// CountAssets counts matching assets using cursor pagination on /api/search/metadata up to maxCount.
func (c *Client) CountAssets(ctx context.Context, apiKey string, filter SearchFilter, maxCount int, includeVideos, includeArchived bool) (int, bool, error) {
	if maxCount <= 0 {
		maxCount = 5000
	}
	effectiveFilter := ApplyDefaultConstraints(filter, includeVideos, includeArchived)

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
				Items      []json.RawMessage `json:"items"`
				NextCursor string            `json:"nextCursor"`
			} `json:"assets"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return total, false, err
		}

		pageCount := len(resp.Assets.Items)
		total += pageCount

		if resp.Assets.NextCursor == "" || pageCount < 1000 || total >= maxCount {
			isExact := resp.Assets.NextCursor == "" || pageCount < 1000
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

