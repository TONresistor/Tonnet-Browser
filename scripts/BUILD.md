# Building Tonnet Browser Binaries

This document describes how to build the platform binaries used by Tonnet Browser.

## Overview

Tonnet Browser requires three binary components:

1. **tonutils-proxy** - HTTP proxy for TON sites (from TONresistor/Tonutils-Proxy)
2. **tonutils-storage** - TON storage daemon (from xssnick/tonutils-storage)
3. **tonutils-bridge** - standalone WebSocket-ADNL bridge (from TONresistor/tonutils-bridge)

## Supported Platforms

| Platform | Architecture | Notes |
|----------|--------------|-------|
| macOS    | Universal (x86_64 + arm64) | Runs natively on Intel and Apple Silicon |
| Linux    | x86_64 | 64-bit Linux |
| Windows  | x86_64 | 64-bit Windows |

## Quick Start

### Automated Build (macOS Universal)

For macOS, use the provided build script to create universal binaries:

```bash
# From the project root
./scripts/build-universal-binaries.sh

# With options
./scripts/build-universal-binaries.sh --clean    # Clean before building
./scripts/build-universal-binaries.sh --verify   # Verify binaries after build
```

### GitHub Actions

The project includes a GitHub Actions workflow that automatically builds binaries for all platforms:

- **Trigger**: Push a tag starting with `v` (e.g., `v1.0.0`)
- **Workflow file**: `.github/workflows/build.yml`
- **Output**: Artifacts uploaded to the release

## Manual Build Instructions

### Prerequisites

- Go 1.22 or later
- Git
- For macOS universal binaries: Xcode Command Line Tools (provides `lipo`)

### macOS Universal Binaries

Universal binaries combine x86_64 (Intel) and arm64 (Apple Silicon) architectures into a single executable.

```bash
# Build for both architectures
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o binary-amd64 .
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o binary-arm64 .

# Combine into universal binary
lipo -create -output binary-universal binary-amd64 binary-arm64

# Verify the universal binary
lipo -info binary-universal
file binary-universal
```

### Linux x86_64

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o binary-linux .
```

### Windows x86_64

```bash
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o binary.exe .
```

## Build Flags Explained

| Flag | Purpose |
|------|---------|
| `CGO_ENABLED=0` | Disable CGO for static linking |
| `-ldflags="-s -w"` | Strip debug symbols to reduce binary size |
| `GOOS` | Target operating system |
| `GOARCH` | Target CPU architecture |

## Directory Structure

After building, binaries should be placed in:

```
resources/
  bin/
    mac/
      tonutils-proxy        # Universal binary
      tonutils-storage      # Universal binary
      tonutils-bridge       # Universal binary
    linux/
      tonutils-proxy
      tonutils-storage
      tonutils-bridge
    win/
      tonutils-proxy.exe
      tonutils-storage.exe
      tonutils-bridge.exe
```

## Building Individual Components

### tonutils-proxy

Build from local source (preferred):
```bash
npm run build:proxy          # current platform only
./scripts/build-proxy.sh --all  # all platforms
```

Or manually:
```bash
git clone https://github.com/TONresistor/Tonutils-Proxy.git ../Tonutils-Proxy
cd ../Tonutils-Proxy
go build -ldflags="-s -w -X main.GitCommit=$(git describe --tags --always)" -o tonutils-proxy ./cmd/proxy-cli
```

### tonutils-storage

```bash
git clone https://github.com/xssnick/tonutils-storage.git
cd tonutils-storage
go build -ldflags="-s -w" -o tonutils-storage ./cmd/tonutils-storage
```

### tonutils-bridge

Standalone WebSocket-ADNL bridge, separated from tonutils-proxy. Exposes a local WebSocket endpoint that the browser uses to communicate with the ADNL network directly.

Build from local source (preferred):
```bash
npm run build:bridge          # current platform only
./scripts/build-bridge.sh --all  # all platforms
```

Or manually:
```bash
git clone https://github.com/TONresistor/tonutils-bridge.git ../tonutils-bridge
cd ../tonutils-bridge
go build -ldflags="-s -w -X main.GitCommit=$(git describe --tags --always)" -o tonutils-bridge .
```

## Verifying Universal Binaries

On macOS, verify that a binary is truly universal:

```bash
# Check architectures
lipo -info resources/bin/mac/tonutils-proxy
# Output: Architectures in the fat file: resources/bin/mac/tonutils-proxy are: x86_64 arm64

# Detailed info
file resources/bin/mac/tonutils-proxy
# Output: resources/bin/mac/tonutils-proxy: Mach-O universal binary with 2 architectures:
#         [x86_64:Mach-O 64-bit executable x86_64] [arm64:Mach-O 64-bit executable arm64]
```

## Troubleshooting

### "lipo: command not found"

Install Xcode Command Line Tools:
```bash
xcode-select --install
```

### Go module issues

If you encounter Go module issues:
```bash
go mod download
go mod tidy
```

### Binary not executable

Make sure to set executable permissions:
```bash
chmod +x resources/bin/mac/*
chmod +x resources/bin/linux/*
```

## Continuous Integration

The GitHub Actions workflow (`.github/workflows/build.yml`) handles:

1. Building on the appropriate runner for each platform
2. Creating macOS universal binaries using `lipo`
3. Uploading binaries as artifacts
4. Creating releases with all binaries attached

To trigger a build:
1. Create and push a tag: `git tag v1.0.0 && git push origin v1.0.0`
2. Or use "Run workflow" in GitHub Actions for manual builds
