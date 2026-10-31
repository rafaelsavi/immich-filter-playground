# Contributing to Immich Filter Playground

Thank you for your interest in contributing to **Immich Filter Playground**!

## Getting Started

1. **Prerequisites**:
   - [Go](https://go.dev/) 1.23 or higher
   - A running [Immich](https://immich.app/) instance (v1.118+ recommended) with an API key

2. **Clone and run locally**:
   ```bash
   git clone https://github.com/rafaelsavi/immich-filter-playground.git
   cd immich-filter-playground
   cp config.example.yaml config.yaml
   # Edit config.yaml with your Immich URL & accounts
   go run .
   ```

3. **Running Tests**:
   ```bash
   go test -v ./...
   ```

## Development Guidelines

- **Zero frontend build step**: The frontend is built using standard HTML5, CSS3, and modern vanilla JavaScript located in `internal/server/static/`. Avoid introducing heavy bundlers, Webpack, or npm dependencies unless strictly necessary.
- **Embedded Static Assets**: In Go, the frontend is embedded into the single binary using `//go:embed static/*`. During development, the server automatically reads from `internal/server/static` if present on disk so you can edit frontend files without recompiling.
- **Security**: Never hardcode API keys, hostnames, or personal data into the repository. All secrets must stay in `.gitignore`'d files (`config.yaml`, `.env`).

## Pull Requests

1. Create a feature branch (`git checkout -b feature/my-new-feature`).
2. Commit your changes with clear, descriptive commit messages.
3. Make sure all tests pass (`go test ./...` and `go vet ./...`).
4. Submit a Pull Request.

