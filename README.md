# ⚡ Immich Filter Playground

[![CI](https://github.com/immich-app/immich-filter-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/immich-app/immich-filter-playground/actions)
[![Go Version](https://img.shields.io/badge/go-1.24-blue.svg)](https://go.dev/)
[![Docker](https://img.shields.io/badge/docker-multiarch-blue?logo=docker)](https://github.com/immich-app/immich-filter-playground/pkgs/container/immich-filter-playground)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, standalone visual filter designer and testing playground for the **Immich Search API v2**. Build complex nested `AND` / `OR` rule trees, inspect and edit Filter JSON & API payloads in real time, and preview matching assets live from your Immich server.

---

## 🌟 Highlights & Features

- **🌲 Visual Nested Rule Tree**:
  - Nest `ALL (AND)` and `ANY (OR)` logic groups to arbitrary depths.
  - Automatically compiles and normalizes nested criteria into valid Immich Search API v2 `SearchFilter` JSON.
  - Live auto-complete and dropdown options populated dynamically from your own Immich instance (People, Albums, Tags, Countries, States, Cities, Cameras, Makes, and Lenses).

- **📁 Search Profiles & Quick Switching**:
  - Save your favourite search filters and query parameters into named profiles.
  - Quick-switch between custom profiles and built-in presets (e.g. ⭐ Favorites, 🔀 Nested OR, 🎬 Recent Videos, 🌟 Top Rated) via a dedicated dropdown.
  - Profiles remember rule trees, search modes, target user accounts, sort settings, and video/archive options.
  - Synchronized via backend API (`/api/profiles`) with seamless local browser persistence fallback.

- **⚡ Simultaneous Two-Way JSON Editor**:
  - Live bi-directional synchronization: click rules in the visual tree and watch the Filter JSON update instantaneously.
  - Paste or edit raw JSON directly in the editor and press `Ctrl+Enter` (**Apply to Tree**) to dynamically parse and reconstruct the visual tree.

- **📦 Request Payload & cURL Inspector**:
  - View the exact POST payload sent to `/api/search/random` or `/api/search/metadata`.
  - Copy ready-to-run `curl` commands to clipboard for scripts, cron jobs, or API integrations.

- **🖼️ Live Asset Preview & Lightbox**:
  - Toggle between **Random Sample** (`/api/search/random`) with instant re-shuffling and **Metadata Search** (`/api/search/metadata`) with custom sort orders.
  - Asset counter showing exact or estimated total matching photos and videos.
  - Multi-account support: test filters against an individual account or across all configured user accounts simultaneously.
  - Lightbox modal with full-resolution photo preview, video player, EXIF metadata inspector, tagged people, and a direct link to open the photo in Immich.

- **🚀 Zero-Dependency Single Binary**:
  - Written in modern Go with embedded web assets (`//go:embed`). No Node.js runtime, Python virtual environment, or external dependencies required.
  - Ultra-lightweight footprint (<20 MB RAM, instantaneous startup).

---

## 🚀 Quick Start

### Option 1: Standalone Binary (Recommended)

Download the latest pre-compiled binary for your operating system from the **Releases** page:

- **Linux**: `immich-filter-playground-linux-amd64` / `arm64`
- **macOS**: `immich-filter-playground-darwin-amd64` / `arm64` (Apple Silicon)
- **Windows**: `immich-filter-playground-windows-amd64.exe`

Run it directly:
```bash
./immich-filter-playground
```

### Option 2: Docker / Docker Compose

Add to your `docker-compose.yml` (e.g. alongside your Immich stack):

```yaml
services:
  immich-filter-playground:
    image: ghcr.io/<owner>/immich-filter-playground:latest
    container_name: immich-filter-playground
    restart: unless-stopped
    ports:
      - "8090:8090"
    environment:
      - IMMICH_URL=http://immich-server:2283
      - IMMICH_EXTERNAL_URL=https://photos.yourdomain.com
      - IMMICH_API_KEY=your_immich_api_key_here
      # Optional: named accounts for multi-user setups
      # - IMMICH_ACCOUNTS=alice:key1,bob:key2
```

Then start the container:
```bash
docker compose up -d
```

### Option 3: From Source (Requires Go 1.23+)

```bash
git clone https://github.com/<owner>/immich-filter-playground.git
cd immich-filter-playground
cp config.example.yaml config.yaml
# Edit config.yaml with your Immich URL & API key
go run .
```

Open **http://localhost:8090** in your browser.

---

## ⚙️ Configuration Reference

You can configure the application using a YAML file (`config.yaml`), a `.env` file, or standard environment variables (environment variables take highest precedence).

### Configuration Options

| YAML Key | Environment Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `server.host` | `PLAYGROUND_HOST` / `HOST` | `0.0.0.0` | IP address to bind server |
| `server.port` | `PLAYGROUND_PORT` / `PORT` | `8090` | HTTP listening port |
| `immich.url` | `IMMICH_URL` | — | Base URL of your Immich instance |
| `immich.external_url` | `IMMICH_EXTERNAL_URL` | `immich.url` | Public URL for "Open in Immich" links |
| `immich.api_key` | `IMMICH_API_KEY` | — | Default Immich API Key |
| `immich.accounts` | `IMMICH_ACCOUNTS` | — | Multi-user accounts (`user1:key1,user2:key2`) |
| `immich.insecure_skip_verify` | `IMMICH_INSECURE_SKIP_VERIFY` | `false` | Set `true` to allow self-signed SSL certs |
| `immich.timeout_seconds` | `IMMICH_TIMEOUT_SECONDS` | `45` | API request timeout in seconds |
| `defaults.sample_size` | `PLAYGROUND_SAMPLE_SIZE` | `24` | Default preview gallery item count |
| `defaults.search_mode` | `PLAYGROUND_SEARCH_MODE` | `random` | Search mode: `random` or `metadata` |
| `defaults.include_videos` | `PLAYGROUND_INCLUDE_VIDEOS` | `true` | Include videos by default |
| `defaults.include_archived` | `PLAYGROUND_INCLUDE_ARCHIVED` | `false` | Include archived photos by default |

### Example `config.yaml`

```yaml
server:
  host: "0.0.0.0"
  port: 8090

immich:
  url: "http://192.168.1.100:2283"
  external_url: "https://photos.example.com"
  api_key: "your_immich_api_key_here"

  # Optional: Configure named accounts for testing filters across different users
  accounts:
    alice: "api_key_for_alice"
    bob: "api_key_for_bob"

  # Optional: For self-signed SSL certificates on your local network
  insecure_skip_verify: false

defaults:
  sample_size: 24
  search_mode: "random"
  include_videos: true
  include_archived: false
```

---

## 📡 API Endpoints

The backend provides a lightweight REST API for the frontend and health checks:

- `GET /healthz` & `GET /api/health`: Healthcheck endpoints for Docker and uptime monitors.
- `GET /api/bootstrap`: Returns server configuration status, user list, and preloaded Immich metadata (People, Albums, Tags, Locations).
- `POST /api/metadata/refresh`: Flushes internal metadata cache and reloads entities from Immich.
- `POST /api/search`: Executes the normalized Immich search query and returns matched asset items.
- `GET /api/profiles`: Lists saved search profiles.
- `POST /api/profiles`: Creates or updates a search profile.
- `DELETE /api/profiles/{id}`: Deletes a saved search profile.
- `GET /api/media/{thumbnail|preview|original}/{id}`: Authenticated media proxy streaming assets without exposing credentials to the browser.

---

## 🛠️ Development & Testing

```bash
# Run unit tests
go test -v ./...

# Run static analysis
go vet ./...

# Build standalone executable
go build -o immich-filter-playground .
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
