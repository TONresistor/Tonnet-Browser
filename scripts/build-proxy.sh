#!/usr/bin/env bash
# Build tonutils-proxy from local source (../Tonutils-Proxy)
# Usage: ./scripts/build-proxy.sh [--all]
#   No args: build for current platform only
#   --all:   build for linux, mac, windows

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROXY_SRC="${PROJECT_DIR}/../Tonutils-Proxy"
BIN_DIR="${PROJECT_DIR}/resources/bin"

if [ ! -d "$PROXY_SRC" ]; then
  echo "Error: Tonutils-Proxy not found at $PROXY_SRC"
  echo "Clone it: git clone https://github.com/TONresistor/Tonutils-Proxy.git ../Tonutils-Proxy"
  exit 1
fi

cd "$PROXY_SRC"
VER=$(git describe --tags --always 2>/dev/null || echo "dev")
LDFLAGS="-s -w -X main.GitCommit=${VER}"
echo "Building tonutils-proxy ${VER} from source..."

build_platform() {
  local goos=$1 goarch=$2 dest=$3 ext=${4:-}
  echo "  ${goos}/${goarch} -> ${dest}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -ldflags "$LDFLAGS" -o "$dest" cmd/proxy-cli/main.go
  chmod +x "$dest"
  echo "$VER" > "$(dirname "$dest")/.tonutils-proxy.version"
}

if [ "${1:-}" = "--all" ]; then
  build_platform linux amd64 "${BIN_DIR}/linux/tonutils-proxy"
  build_platform darwin arm64 "${BIN_DIR}/mac/tonutils-proxy-arm64"
  build_platform darwin amd64 "${BIN_DIR}/mac/tonutils-proxy-amd64"
  if command -v lipo &>/dev/null; then
    lipo -create -output "${BIN_DIR}/mac/tonutils-proxy" \
      "${BIN_DIR}/mac/tonutils-proxy-arm64" "${BIN_DIR}/mac/tonutils-proxy-amd64"
    rm "${BIN_DIR}/mac/tonutils-proxy-arm64" "${BIN_DIR}/mac/tonutils-proxy-amd64"
    echo "$VER" > "${BIN_DIR}/mac/.tonutils-proxy.version"
  fi
  build_platform windows amd64 "${BIN_DIR}/win/tonutils-proxy.exe" .exe
else
  case "$(uname -s)" in
    Linux*)  build_platform linux amd64 "${BIN_DIR}/linux/tonutils-proxy" ;;
    Darwin*) build_platform darwin arm64 "${BIN_DIR}/mac/tonutils-proxy" ;;
    MINGW*|MSYS*|CYGWIN*) build_platform windows amd64 "${BIN_DIR}/win/tonutils-proxy.exe" .exe ;;
    *) echo "Unknown platform: $(uname -s)"; exit 1 ;;
  esac
fi

echo "Done. tonutils-proxy ${VER}"
