package config

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// FlexibleAccounts supports unmarshaling both a map of username -> apiKey
// and a single scalar string apiKey (automatically assigned to account "default").
type FlexibleAccounts map[string]string

// UnmarshalYAML implements custom YAML unmarshaling for FlexibleAccounts.
func (fa *FlexibleAccounts) UnmarshalYAML(value *yaml.Node) error {
	if *fa == nil {
		*fa = make(FlexibleAccounts)
	}
	switch value.Kind {
	case yaml.ScalarNode:
		val := strings.TrimSpace(value.Value)
		if val != "" {
			(*fa)["default"] = val
		}
		return nil
	case yaml.MappingNode:
		var m map[string]string
		if err := value.Decode(&m); err != nil {
			return err
		}
		for k, v := range m {
			kClean := strings.TrimSpace(k)
			vClean := strings.TrimSpace(v)
			if kClean != "" && vClean != "" {
				(*fa)[kClean] = vClean
			}
		}
		return nil
	default:
		return nil
	}
}

// MarshalYAML serializes FlexibleAccounts as a standard map.
func (fa FlexibleAccounts) MarshalYAML() (any, error) {
	return map[string]string(fa), nil
}

// Config holds the full configuration for the Immich Filter Playground server.
type Config struct {
	Server   ServerConfig   `yaml:"server" json:"server"`
	Immich   ImmichConfig   `yaml:"immich" json:"immich"`
	Defaults DefaultsConfig `yaml:"defaults" json:"defaults"`

	// Flat fallback fields for compatibility if a flat YAML file is used
	FlatImmichURL          string            `yaml:"immich_url,omitempty" json:"-"`
	FlatImmichExternalURL  string            `yaml:"immich_external_url,omitempty" json:"-"`
	FlatImmichAPIKey       string            `yaml:"immich_api_key,omitempty" json:"-"`
	FlatImmichUsersAPIKeys map[string]string `yaml:"immich_users_api_keys,omitempty" json:"-"`
}

// ServerConfig configures the HTTP server.
type ServerConfig struct {
	Host         string `yaml:"host" json:"host"`
	Port         int    `yaml:"port" json:"port"`
	ProfilesFile string `yaml:"profiles_file,omitempty" json:"-"`
}

// ImmichConfig configures the connection and credentials for Immich.
type ImmichConfig struct {
	URL                string           `yaml:"url" json:"url"`
	ExternalURL        string           `yaml:"external_url" json:"externalUrl"`
	APIKey             string           `yaml:"api_key,omitempty" json:"-"` // Deprecated: preserved for backward compatibility
	Accounts           FlexibleAccounts `yaml:"accounts" json:"-"`
	InsecureSkipVerify bool             `yaml:"insecure_skip_verify" json:"insecureSkipVerify"`
	TimeoutSeconds     int              `yaml:"timeout_seconds" json:"timeoutSeconds"`
}

// DefaultsConfig configures default filter playground behavior.
type DefaultsConfig struct {
	SampleSize      int    `yaml:"sample_size" json:"sampleSize"`
	SearchMode      string `yaml:"search_mode" json:"searchMode"`
	IncludeVideos   bool   `yaml:"include_videos" json:"includeVideos"`
	IncludeArchived bool   `yaml:"include_archived" json:"includeArchived"`
}

// Default returns a Config initialized with sensible defaults.
func Default() *Config {
	return &Config{
		Server: ServerConfig{
			Host:         "0.0.0.0",
			Port:         8090,
			ProfilesFile: "profiles.json",
		},
		Immich: ImmichConfig{
			Accounts:       make(FlexibleAccounts),
			TimeoutSeconds: 45,
		},
		Defaults: DefaultsConfig{
			SampleSize:      24,
			SearchMode:      "random",
			IncludeVideos:   true,
			IncludeArchived: false,
		},
	}
}

// Load loads configuration from a YAML file (if found), a .env file (if found),
// and environment variables (which take highest precedence).
func Load(configPath string) (*Config, error) {
	cfg := Default()

	// Load .env into environment (only for variables not already set in the OS environment)
	loadDotEnv(".env")

	if configPath == "" {
		if envPath := strings.TrimSpace(os.Getenv("CONFIG_FILE")); envPath != "" {
			configPath = envPath
		} else {
			configPath = "config.yaml"
		}
	}

	if data, err := os.ReadFile(configPath); err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", configPath, err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading %s: %w", configPath, err)
	}

	cfg.normalizeFlatFields()
	cfg.applyEnvOverrides()
	cfg.normalize()

	return cfg, nil
}

func (c *Config) normalizeFlatFields() {
	if c.Immich.Accounts == nil {
		c.Immich.Accounts = make(FlexibleAccounts)
	}
	if c.Immich.URL == "" && c.FlatImmichURL != "" {
		c.Immich.URL = c.FlatImmichURL
	}
	if c.Immich.ExternalURL == "" && c.FlatImmichExternalURL != "" {
		c.Immich.ExternalURL = c.FlatImmichExternalURL
	}
	if c.Immich.APIKey == "" && c.FlatImmichAPIKey != "" {
		c.Immich.APIKey = c.FlatImmichAPIKey
	}
	for user, key := range c.FlatImmichUsersAPIKeys {
		u := strings.TrimSpace(user)
		k := strings.TrimSpace(key)
		if u != "" && k != "" {
			if _, exists := c.Immich.Accounts[u]; !exists {
				c.Immich.Accounts[u] = k
			}
		}
	}
}

func (c *Config) applyEnvOverrides() {
	if host := firstNonEmptyEnv("PLAYGROUND_HOST", "HOST"); host != "" {
		c.Server.Host = host
	}
	if portStr := firstNonEmptyEnv("PLAYGROUND_PORT", "PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil && p > 0 {
			c.Server.Port = p
		}
	}
	if pf := firstNonEmptyEnv("PLAYGROUND_PROFILES_FILE", "PROFILES_FILE"); pf != "" {
		c.Server.ProfilesFile = pf
	}

	if u := firstNonEmptyEnv("IMMICH_URL"); u != "" {
		c.Immich.URL = u
	}
	if eu := firstNonEmptyEnv("IMMICH_EXTERNAL_URL"); eu != "" {
		c.Immich.ExternalURL = eu
	}
	if key := firstNonEmptyEnv("IMMICH_API_KEY"); key != "" {
		c.Immich.APIKey = key
	}
	if skip := firstNonEmptyEnv("IMMICH_INSECURE_SKIP_VERIFY"); skip != "" {
		if b, err := strconv.ParseBool(skip); err == nil {
			c.Immich.InsecureSkipVerify = b
		}
	}
	if timeoutStr := firstNonEmptyEnv("IMMICH_TIMEOUT_SECONDS", "IMMICH_TIMEOUT"); timeoutStr != "" {
		if t, err := strconv.Atoi(timeoutStr); err == nil && t > 0 {
			c.Immich.TimeoutSeconds = t
		}
	}

	if accountsRaw := firstNonEmptyEnv("IMMICH_ACCOUNTS"); accountsRaw != "" {
		for _, pair := range strings.Split(accountsRaw, ",") {
			pair = strings.TrimSpace(pair)
			if pair == "" {
				continue
			}
			parts := strings.SplitN(pair, ":", 2)
			if len(parts) == 2 {
				u := strings.TrimSpace(parts[0])
				k := strings.TrimSpace(parts[1])
				if u != "" && k != "" {
					c.Immich.Accounts[u] = k
				}
			}
		}
	}

	// Also support IMMICH_ACCOUNT_<NAME>=<key>
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		k, v := parts[0], strings.TrimSpace(parts[1])
		if strings.HasPrefix(k, "IMMICH_ACCOUNT_") && v != "" {
			name := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(k, "IMMICH_ACCOUNT_")))
			if name != "" {
				c.Immich.Accounts[name] = v
			}
		}
	}

	if sizeStr := firstNonEmptyEnv("PLAYGROUND_SAMPLE_SIZE"); sizeStr != "" {
		if s, err := strconv.Atoi(sizeStr); err == nil && s > 0 {
			c.Defaults.SampleSize = s
		}
	}
	if mode := strings.ToLower(firstNonEmptyEnv("PLAYGROUND_SEARCH_MODE")); mode == "random" || mode == "metadata" {
		c.Defaults.SearchMode = mode
	}
	if incVid := firstNonEmptyEnv("PLAYGROUND_INCLUDE_VIDEOS"); incVid != "" {
		if b, err := strconv.ParseBool(incVid); err == nil {
			c.Defaults.IncludeVideos = b
		}
	}
	if incArch := firstNonEmptyEnv("PLAYGROUND_INCLUDE_ARCHIVED"); incArch != "" {
		if b, err := strconv.ParseBool(incArch); err == nil {
			c.Defaults.IncludeArchived = b
		}
	}
}

func (c *Config) normalize() {
	if c.Server.ProfilesFile == "" {
		c.Server.ProfilesFile = "profiles.json"
	}

	c.Immich.URL = strings.TrimRight(strings.TrimSpace(c.Immich.URL), "/")
	c.Immich.ExternalURL = strings.TrimRight(strings.TrimSpace(c.Immich.ExternalURL), "/")
	c.Immich.APIKey = strings.TrimSpace(c.Immich.APIKey)

	cleanedAccounts := make(FlexibleAccounts)
	for u, k := range c.Immich.Accounts {
		uClean := strings.TrimSpace(u)
		kClean := strings.TrimSpace(k)
		if uClean != "" && kClean != "" {
			cleanedAccounts[uClean] = kClean
		}
	}
	c.Immich.Accounts = cleanedAccounts

	// Backward compatibility: If legacy APIKey was supplied, ensure it is available in Accounts
	if c.Immich.APIKey != "" {
		if len(c.Immich.Accounts) == 0 {
			c.Immich.Accounts["default"] = c.Immich.APIKey
		} else {
			hasKey := false
			for _, k := range c.Immich.Accounts {
				if k == c.Immich.APIKey {
					hasKey = true
					break
				}
			}
			if !hasKey {
				if _, exists := c.Immich.Accounts["default"]; !exists {
					c.Immich.Accounts["default"] = c.Immich.APIKey
				}
			}
		}
	}

	// Ensure APIKey is populated for internal fallback
	if c.Immich.APIKey == "" {
		if defKey, ok := c.Immich.Accounts["default"]; ok && defKey != "" {
			c.Immich.APIKey = defKey
		} else if len(c.Immich.Accounts) > 0 {
			names := c.AccountNames()
			if len(names) > 0 {
				c.Immich.APIKey = c.Immich.Accounts[names[0]]
			}
		}
	}

	if c.Immich.TimeoutSeconds <= 0 {
		c.Immich.TimeoutSeconds = 45
	}
	if c.Defaults.SampleSize <= 0 {
		c.Defaults.SampleSize = 24
	}
	if c.Defaults.SearchMode != "metadata" {
		c.Defaults.SearchMode = "random"
	}
}

// AccountNames returns the sorted list of user accounts.
// If named accounts exist alongside "default", "default" is omitted unless it is the only account.
func (c *Config) AccountNames() []string {
	var names []string
	var hasDefault bool
	for u, k := range c.Immich.Accounts {
		uClean := strings.TrimSpace(u)
		if uClean == "" || strings.TrimSpace(k) == "" {
			continue
		}
		if uClean == "default" {
			hasDefault = true
			continue
		}
		names = append(names, uClean)
	}
	sort.Strings(names)
	if len(names) == 0 && hasDefault {
		return []string{"default"}
	}
	return names
}

// APIKeyForUser returns the API key for a named user, falling back to the default or first available account.
func (c *Config) APIKeyForUser(user string) string {
	user = strings.TrimSpace(user)
	if user != "" && user != "all" {
		if key, ok := c.Immich.Accounts[user]; ok && key != "" {
			return key
		}
		for u, key := range c.Immich.Accounts {
			if strings.EqualFold(u, user) && key != "" {
				return key
			}
		}
	}
	if defKey, ok := c.Immich.Accounts["default"]; ok && defKey != "" {
		return defKey
	}
	if c.Immich.APIKey != "" {
		return c.Immich.APIKey
	}
	names := c.AccountNames()
	if len(names) > 0 {
		return c.Immich.Accounts[names[0]]
	}
	return ""
}

// ExternalURL returns the external Immich URL for browser links, falling back to Immich.URL.
func (c *Config) ExternalURL() string {
	if c.Immich.ExternalURL != "" {
		return c.Immich.ExternalURL
	}
	return c.Immich.URL
}

// IsConfigured reports whether an Immich URL and at least one account API key are configured.
func (c *Config) IsConfigured() bool {
	return c.Immich.URL != "" && (len(c.Immich.Accounts) > 0 || c.Immich.APIKey != "")
}

// SaveYAML writes the clean nested configuration structure to the given file path.
func (c *Config) SaveYAML(path string) error {
	clean := &Config{
		Server:   c.Server,
		Immich:   c.Immich,
		Defaults: c.Defaults,
	}
	data, err := yaml.Marshal(clean)
	if err != nil {
		return err
	}
	header := "# Immich Filter Playground Configuration\n"
	return os.WriteFile(path, append([]byte(header), data...), 0600)
}

func firstNonEmptyEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		val = strings.Trim(val, `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
}
