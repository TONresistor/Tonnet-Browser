#!/usr/bin/env bash
# Build tonutils-bridge from local source (../tonutils-bridge)
# Usage: ./scripts/build-bridge.sh [--all]
#   No args: build for current platform only
#   --all:   build for linux, mac, windows

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BRIDGE_SRC="${PROJECT_DIR}/../tonutils-bridge"
BIN_DIR="${PROJECT_DIR}/resources/bin"

if [ ! -d "$BRIDGE_SRC" ]; then
  echo "Error: tonutils-bridge not found at $BRIDGE_SRC"
  echo "Clone it: git clone https://github.com/TONresistor/tonutils-bridge.git ../tonutils-bridge"
  exit 1
fi

cd "$BRIDGE_SRC"
VER=$(git describe --tags --always 2>/dev/null || echo "dev")
LDFLAGS="-s -w -X main.GitCommit=${VER}"
echo "Building tonutils-bridge ${VER} from source..."

build_platform() {
  local goos=$1 goarch=$2 dest=$3 ext=${4:-}
  echo "  ${goos}/${goarch} -> ${dest}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -ldflags "$LDFLAGS" -o "$dest" .
  chmod +x "$dest"
  echo "$VER" > "$(dirname "$dest")/.tonutils-bridge.version"
}

if [ "${1:-}" = "--all" ]; then
  build_platform linux amd64 "${BIN_DIR}/linux/tonutils-bridge"
  build_platform darwin arm64 "${BIN_DIR}/mac/tonutils-bridge-arm64"
  build_platform darwin amd64 "${BIN_DIR}/mac/tonutils-bridge-amd64"
  if command -v lipo &>/dev/null; then
    lipo -create -output "${BIN_DIR}/mac/tonutils-bridge" \
      "${BIN_DIR}/mac/tonutils-bridge-arm64" "${BIN_DIR}/mac/tonutils-bridge-amd64"
    rm "${BIN_DIR}/mac/tonutils-bridge-arm64" "${BIN_DIR}/mac/tonutils-bridge-amd64"
    echo "$VER" > "${BIN_DIR}/mac/.tonutils-bridge.version"
  fi
  build_platform windows amd64 "${BIN_DIR}/win/tonutils-bridge.exe" .exe
else
  case "$(uname -s)" in
    Linux*)  build_platform linux amd64 "${BIN_DIR}/linux/tonutils-bridge" ;;
    Darwin*) build_platform darwin arm64 "${BIN_DIR}/mac/tonutils-bridge" ;;
    MINGW*|MSYS*|CYGWIN*) build_platform windows amd64 "${BIN_DIR}/win/tonutils-bridge.exe" .exe ;;
    *) echo "Unknown platform: $(uname -s)"; exit 1 ;;
  esac
fi

echo "Done. tonutils-bridge ${VER}"
