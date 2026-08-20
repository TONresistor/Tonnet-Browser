#!/usr/bin/env bash
# Build all Go binaries from source using pinned commits from binary-versions.json.
# Usage: ./scripts/build-binaries-from-source.sh [linux|mac|win] [amd64|arm64]
# Requires: go, git, python3, jq (optional, uses python3 fallback)
# On macOS builds: also requires lipo for universal binaries.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$SCRIPT_DIR/binary-versions.json"
CACHE_DIR="$PROJECT_DIR/.cache/go-build-binaries"
TMPDIR_BASE="${TMPDIR:-$CACHE_DIR/tmp}/tonnet-build-$$"

export GOCACHE="${GOCACHE:-$CACHE_DIR/cache}"
export GOPATH="${GOPATH:-$CACHE_DIR/gopath}"
export GOTMPDIR="${GOTMPDIR:-$CACHE_DIR/go-tmp}"

mkdir -p "$GOCACHE" "$GOPATH" "$GOTMPDIR"

# Determine target platform
if [ -n "${1:-}" ]; then
  PLATFORM="$1"
  PLATFORM_EXPLICIT=1
else
  PLATFORM_EXPLICIT=0
  case "$(uname -s)" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="mac" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
    *) echo "ERROR: Unknown OS, specify platform: linux, mac, or win"; exit 1 ;;
  esac
fi

echo "=== Building binaries from source for: $PLATFORM ==="

if [ -n "${2:-}" ]; then
  TARGET_ARCH="$2"
else
  case "$PLATFORM" in
    linux|win)
      if [ "$PLATFORM_EXPLICIT" -eq 0 ]; then
        TARGET_ARCH="$(uname -m)"
      else
        TARGET_ARCH="amd64"
      fi
      ;;
    mac)
      TARGET_ARCH="universal"
      ;;
  esac
fi

case "$TARGET_ARCH" in
  x64|x86_64) TARGET_ARCH="amd64" ;;
  aarch64) TARGET_ARCH="arm64" ;;
esac

case "$PLATFORM:$TARGET_ARCH" in
  linux:amd64|linux:arm64|win:amd64|mac:universal) ;;
  *)
    echo "ERROR: Unsupported target: $PLATFORM/$TARGET_ARCH"
    echo "Supported targets: linux/amd64, linux/arm64, win/amd64, mac/universal"
    exit 1
    ;;
esac

echo "Target architecture: $TARGET_ARCH"

# Parse config with python3 (read from stdin to avoid POSIX/Windows path issues)
GO_VERSION=$(python3 -c "import json,sys; print(json.load(sys.stdin)['go_version'])" < "$CONFIG")
BINARY_COUNT=$(python3 -c "import json,sys; print(len(json.load(sys.stdin)['binaries']))" < "$CONFIG")

# Verify Go is available
if ! command -v go &>/dev/null; then
  echo "ERROR: Go is not installed. Required version: $GO_VERSION"
  exit 1
fi
echo "Go version: $(go version)"

# Map platform to GOOS
case "$PLATFORM" in
  linux) GOOS="linux" ;;
  mac)   GOOS="darwin" ;;
  win)   GOOS="windows" ;;
  *) echo "ERROR: Invalid platform: $PLATFORM"; exit 1 ;;
esac

# Platform-specific binary extension
EXT=""
[ "$GOOS" = "windows" ] && EXT=".exe"

# Create temp dir for clones
mkdir -p "$TMPDIR_BASE"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# Build each binary
for i in $(seq 0 $((BINARY_COUNT - 1))); do
  NAME=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i]['name'])" < "$CONFIG")
  REPO=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i]['repo'])" < "$CONFIG")
  VERSION=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i]['version'])" < "$CONFIG")
  EXPECTED_COMMIT=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i]['commit'])" < "$CONFIG")
  SOURCE_PATCH=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i].get('patch', ''))" < "$CONFIG")
  ENTRY=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i]['entry_point'])" < "$CONFIG")
  LDFLAGS_TMPL=$(python3 -c "import json,sys; print(json.load(sys.stdin)['binaries'][$i]['ldflags'])" < "$CONFIG")

  echo ""
  echo "--- $NAME ($REPO @ $VERSION) ---"

  # Destination directory
  DEST_DIR="$PROJECT_DIR/resources/bin/$PLATFORM"
  mkdir -p "$DEST_DIR"

  PATCH_SUFFIX=""
  if [ -n "$SOURCE_PATCH" ]; then
    PATCH_PATH="$PROJECT_DIR/$SOURCE_PATCH"
    if [ ! -f "$PATCH_PATH" ]; then
      echo "ERROR: Source patch not found: $PATCH_PATH"
      exit 1
    fi
    PATCH_HASH=$(python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())" "$PATCH_PATH")
    PATCH_SUFFIX="+patch.$PATCH_HASH"
  fi

  # Check if already built at this version and architecture.
  VERSION_FILE="$DEST_DIR/.${NAME}.version"
  VERSION_MARKER="$VERSION@$EXPECTED_COMMIT/$TARGET_ARCH$PATCH_SUFFIX"
  if [ -f "$VERSION_FILE" ] && [ "$(cat "$VERSION_FILE")" = "$VERSION_MARKER" ] && [ -f "$DEST_DIR/${NAME}${EXT}" ]; then
    echo "Already built $NAME $VERSION_MARKER, skipping"
    continue
  fi

  # Fetch only the pinned commit so development builds stay reproducible.
  CLONE_DIR="$TMPDIR_BASE/$NAME"
  echo "Fetching https://github.com/$REPO.git @ $EXPECTED_COMMIT ($VERSION)"
  git init --quiet "$CLONE_DIR"
  git -C "$CLONE_DIR" remote add origin "https://github.com/$REPO.git"
  git -C "$CLONE_DIR" fetch --quiet --depth 1 origin "$EXPECTED_COMMIT"
  git -C "$CLONE_DIR" checkout --quiet --detach FETCH_HEAD

  # Log exact commit for transparency
  COMMIT_SHA=$(git -C "$CLONE_DIR" rev-parse HEAD)
  echo "Commit: $COMMIT_SHA"
  if [ "$COMMIT_SHA" != "$EXPECTED_COMMIT" ]; then
    echo "ERROR: $NAME resolved to $COMMIT_SHA, expected immutable pin $EXPECTED_COMMIT"
    exit 1
  fi

  if [ -n "$SOURCE_PATCH" ]; then
    git -C "$CLONE_DIR" apply --unidiff-zero --check "$PATCH_PATH"
    git -C "$CLONE_DIR" apply --unidiff-zero "$PATCH_PATH"
    echo "Applied source patch: $SOURCE_PATCH"
  fi

  # Resolve ldflags template
  LDFLAGS="${LDFLAGS_TMPL//\$\{VERSION\}/$VERSION}"

  cd "$CLONE_DIR"

  if [ "$PLATFORM" = "mac" ]; then
    # macOS: build universal binary (arm64 + amd64)
    echo "Building arm64..."
    CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$LDFLAGS" -o "${NAME}-arm64" $ENTRY

    echo "Building amd64..."
    CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "${NAME}-amd64" $ENTRY

    echo "Creating universal binary with lipo..."
    lipo -create -output "$DEST_DIR/$NAME" "${NAME}-arm64" "${NAME}-amd64"
    echo "Architectures: $(lipo -archs "$DEST_DIR/$NAME")"
  else
    # Linux/Windows: single architecture.
    echo "Building ${GOOS}/${TARGET_ARCH}..."
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$TARGET_ARCH" go build -ldflags="$LDFLAGS" -o "$DEST_DIR/${NAME}${EXT}" $ENTRY
  fi

  cd "$PROJECT_DIR"

  # Set executable permission
  [ "$GOOS" != "windows" ] && chmod +x "$DEST_DIR/${NAME}${EXT}"

  # Write version marker
  echo "$VERSION_MARKER" > "$VERSION_FILE"

  echo "Built $NAME $VERSION_MARKER -> $DEST_DIR/${NAME}${EXT}"
done

echo ""
echo "=== All binaries built successfully ==="
ls -la "$PROJECT_DIR/resources/bin/$PLATFORM/"
