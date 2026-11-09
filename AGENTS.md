# AI Assistant Guidelines — immich-filter-playground

This document provides context, architectural constraints, and standards for AI coding assistants working in this repository.

---

## 1. Project Overview

`immich-filter-playground` is a lightweight visual filter designer and testing playground for the Immich Search API v2. It provides:
- A Go backend communicating with Immich instances and proxying search requests.
- An embedded web frontend with visual filter controls, raw JSON payloads, dynamic timeline preview, and curl generator.
- Multi-account switching, credential management, and preset saving.

---

## 2. Code Quality & Standards

- **Language & Runtime**: Go 1.23+
- **Code Style & Formatting**: Format all Go code using `gofmt` / `goimports`.
- **Static Analysis & Linting**: Always verify changes pass:
  ```bash
  go vet ./...
  ```
- **Unit & Race Testing**: Run the test suite with race detection:
  ```bash
  go test -v -race ./...
  ```

---

## 3. Version Tracking & Release Architecture

- **Single Source of Truth**: The application version is centrally maintained in `pyproject.toml` (`[project].version = "X.Y.Z"`).
- **Changelog Parity**: Release notes are documented under `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md` following the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) standard.
- **Go Binary Injection**: Go build binaries dynamically receive the version at build time via linker flags:
  `-ldflags="-s -w -X main.version=${VERSION}"`
- **Zero-Effort Automated Release**:
  - Never manually run `git tag` or publish GitHub releases manually.
  - Bumping `version` in `pyproject.toml` and documenting changes in `CHANGELOG.md` automatically triggers the GitHub Actions CI/CD pipeline on push to `main`.
  - The pipeline automatically verifies tests, creates and pushes the Git tag `vX.Y.Z`, compiles cross-platform binaries (Linux x86/ARM, macOS x86/ARM, Windows x86), publishes the GitHub Release, and builds the multi-arch Docker image.

---

## 4. Git Workflow & Agent Commit Discipline

1. **When to Commit**:
   - **Always commit each logical change immediately after verifying it**: Every distinct logical change (e.g. bug fix, feature, UI polish, config update) must be committed individually with an atomic commit as soon as its verification passes.
   - **Do not batch unrelated changes**: Never bundle multiple unrelated features, fixes, or refactors into a single commit.
   - **Never leave uncommitted work**: Do not end an agent session or declare a task complete with uncommitted changes or untracked scratch files in the repository root.
2. **Commit Message Format**:
   - Use standard Conventional Commits format (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
3. **Pre-Commit Verification**:
   - Run `go test -v ./...` and `go vet ./...` before committing.
