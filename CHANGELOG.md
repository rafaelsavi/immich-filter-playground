# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version is centrally maintained in `pyproject.toml` and `main.go`.

## [1.1.0] - 2026-10-31

### Added
- **Search Profiles & Quick Switching**: Save filter trees, accounts, sort settings, and toggle options into named profiles.
- **Profiles Dropdown**: Fast switching between saved profiles directly from the top navigation bar.
- **Backend Profile Persistence**: Added `/api/profiles` REST endpoints with local JSON file storage and localStorage browser fallback.

## [1.0.0] - 2026-10-31

Initial standalone release of Immich Filter Playground.

### Added
- **Visual Rule Tree Designer**: Arbitrary nested `ALL (AND)` and `ANY (OR)` logic groups compiling to Immich Search API v2 `SearchFilter` JSON.
- **Dynamic Immich Metadata Autocomplete**: Autocompletes people, albums, tags, countries, states, cities, cameras, makes, and lenses directly from your Immich library.
- **Two-Way JSON Synchronization**: Real-time bi-directional sync between visual rule tree and raw filter JSON editor.
- **Request Payload & cURL Inspector**: Live inspection of API requests sent to Immich with ready-to-run copyable cURL commands.
- **Live Asset Gallery & Lightbox**: Embedded gallery showing live matching photos and videos with EXIF inspection modal.
- **Multi-Account Support**: Query individual user accounts or all accounts simultaneously.
- **Standalone Go Server**: Self-contained web server with zero external dependencies and embedded frontend assets.
- **Docker Support**: Multi-stage Dockerfile and Docker Compose configuration.
