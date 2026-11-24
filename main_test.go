package main

import (
	"os"
	"regexp"
	"testing"
)

// TestVersionFallbacksMatchPyproject guards against the fallback versions in
// main.go, the Dockerfile and the Makefile drifting from pyproject.toml, the
// single source of truth. (Release builds inject the version via -ldflags.)
func TestVersionFallbacksMatchPyproject(t *testing.T) {
	read := func(name string) string {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("reading %s: %v", name, err)
		}
		return string(data)
	}
	extract := func(name, pattern string) string {
		m := regexp.MustCompile(pattern).FindStringSubmatch(read(name))
		if m == nil {
			t.Fatalf("%s: version pattern %q not found", name, pattern)
		}
		return m[1]
	}

	want := extract("pyproject.toml", `(?m)^version = "([^"]+)"`)
	checks := []struct{ file, pattern string }{
		{"main.go", `(?m)^var version = "([^"]+)"`},
		{"Dockerfile", `(?m)^ARG VERSION=(\S+)`},
		{"Makefile", `(?m)^VERSION = (\S+)`},
	}
	for _, c := range checks {
		if got := extract(c.file, c.pattern); got != want {
			t.Errorf("%s fallback version %q does not match pyproject.toml %q", c.file, got, want)
		}
	}
}
