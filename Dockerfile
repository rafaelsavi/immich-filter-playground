# -------------------------------------------------------------
# Build Stage
# -------------------------------------------------------------
FROM golang:1.24-alpine AS builder

WORKDIR /src

# Download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and embedded static assets
COPY . .

# Build static binary with stripped debug symbols
ARG VERSION=1.1.0
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION}" \
    -o /bin/immich-filter-playground .

# -------------------------------------------------------------
# Final Runtime Stage
# -------------------------------------------------------------
FROM alpine:3.21

# Install ca-certificates (for HTTPS) and curl (for healthchecks)
RUN apk --no-cache add ca-certificates tzdata curl

WORKDIR /app

COPY --from=builder /bin/immich-filter-playground /usr/local/bin/immich-filter-playground
COPY config.example.yaml /app/config.example.yaml

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8090/healthz || exit 1

ENTRYPOINT ["immich-filter-playground"]
CMD ["-config", "/app/config.yaml"]

