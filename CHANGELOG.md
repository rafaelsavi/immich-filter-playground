# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version is centrally maintained in `pyproject.toml` and `main.go`.

## [1.2.0] - 2026-10-31

Official public production release.

### Added
- **Changelog & Central Versioning**: Added `CHANGELOG.md` following Keep a Changelog standard and synchronized version tracking across `pyproject.toml` and `main.go`.
- **Public Repository Setup**: Updated all repository links, badges, Docker registry tags, and contribution guides for open-source release.

## [1.1.4] - 2026-10-31

### Fixed
- **Video Duration Unmarshaling**: Implemented `FlexibleDuration` to handle numeric millisecond durations from Immich video assets without JSON unmarshaling errors.
- **EXIF Timestamp Parsing**: Added `FlexibleTime` for robust parsing of non-standard camera EXIF date strings.
- **Search Race Conditions**: Stamped all live searches with monotonic sequence IDs (`searchSequenceId`) to prevent out-of-order responses from overwriting newer state.
- **Debounce Clashing**: Explicit searches now immediately clear pending debounced timers.
- **Dropdown Event Isolation**: Prevented DOM element detachment during multi-select chip selection from prematurely closing dropdown menus.
- **Performance Optimization**: Decoupled asset counting during random searches and used raw JSON message probe decoding for 10x faster metadata counting.

## [1.1.3] - 2026-10-31

### Changed
- **Results Toolbar Redesign**: Replaced technical "Random" vs "Metadata" labels with user-friendly **🎲 Random Sample** and **📅 Sorted Timeline** modes.
- **Contextual Action Bar**: Added dedicated controls for active mode: "Reshuffle Sample" button in Random mode, and labeled "Sort by:" dropdown with descriptive options in Sorted Timeline mode.

## [1.1.2] - 2026-10-31

### Fixed
- **Immich API v2 `orderBy` Validation**: Corrected `orderBy` schema to a single object (`{ "field": "...", "direction": "..." }`) as required by Immich Search API v2.
- **Sort Field Normalization**: Mapped sorting fields to valid Immich enums (`localDateTime`, `fileCreatedAt`, `rating`, `fileSizeInBytes`).

## [1.1.1] - 2026-10-31

### Changed
- **Profile Preset Streamlining**: Removed hardcoded default presets in favor of pure, custom user-defined search profiles.

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
