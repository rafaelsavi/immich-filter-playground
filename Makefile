.PHONY: all build run test clean docker-build help

BINARY_NAME=immich-filter-playground
VERSION ?= $(shell grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
ifeq ($(VERSION),)
VERSION = 1.3.1
endif

all: test build

build: ## Build the standalone binary
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o $(BINARY_NAME) .

run: ## Run the development server
	go run .

test: ## Run unit tests
	go test -v -race ./...

vet: ## Run Go static code analysis
	go vet ./...

clean: ## Remove build artifacts
	rm -f $(BINARY_NAME) $(BINARY_NAME).exe dist/*

docker-build: ## Build Docker container locally
	docker build -t $(BINARY_NAME):latest .

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

