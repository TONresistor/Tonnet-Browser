#!/usr/bin/env bash
# Download platform binaries from GitHub Releases.
# Usage: ./scripts/download-binaries.sh [linux|mac|win]
# If no platform is specified, auto-detects from the current OS.
# Set version to "latest" in binary-versions.json to always fetch the latest release.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG="$SCRIPT_DIR/binary-versions.json"

# Auto-detect platform or use argument
PLATFORM="${1:-}"
if [ -z "$PLATFORM" ]; then
  case "$(uname -s)" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="mac" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
    *) echo "Error: unsupported OS $(uname -s). Specify platform: linux, mac, or win"; exit 1 ;;
  esac
fi

echo "Platform: $PLATFORM"
echo ""

# Auth header for GitHub API (avoids 60 req/h rate limit for unauthenticated)
CURL_AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  CURL_AUTH=(-H "Authorization: token $GITHUB_TOKEN")
fi

# Resolve "latest" to actual version tag via GitHub API
resolve_version() {
  local repo="$1"
  local version="$2"

  if [ "$version" != "latest" ]; then
    echo "$version"
    return
  fi

  local tag
  tag=$(curl -sf "${CURL_AUTH[@]}" "https://api.github.com/repos/$repo/releases/latest" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null)

  if [ -z "$tag" ]; then
    echo "Error: failed to resolve latest version for $repo" >&2
    exit 1
  fi

  echo "$tag"
}

FAILED=0

# Parse config and download
while IFS='|' read -r binary_name repo config_version asset_name dest; do
  [ -z "$binary_name" ] && continue
  dest_path="$PROJECT_DIR/$dest"
  dest_dir="$(dirname "$dest_path")"
  version_file="$dest_dir/.${binary_name}.version"

  # Resolve "latest" to actual tag
  version=$(resolve_version "$repo" "$config_version")
  echo "  $binary_name: $version"

  # Skip if already downloaded at correct version
  if [ -f "$dest_path" ] && [ -f "$version_file" ] && [ "$(cat "$version_file" 2>/dev/null)" = "$version" ]; then
    echo "    [skip] already present"
    continue
  fi

  url="https://github.com/$repo/releases/download/$version/$asset_name"
  echo "    [download] $url"

  mkdir -p "$dest_dir"

  if ! curl -L -f -o "$dest_path" --progress-bar "${CURL_AUTH[@]}" "$url"; then
    echo "    [error] download failed"
    FAILED=1
    continue
  fi

  # Make executable on unix
  if [ "$PLATFORM" != "win" ]; then
    chmod +x "$dest_path"
  fi

  # Write version marker
  echo "$version" > "$version_file"
  echo "    [ok]"
done < <(python3 -c "
import json, sys
with open('$CONFIG') as f:
    config = json.load(f)
for name, info in config.items():
    asset = info['assets'].get('$PLATFORM')
    if not asset:
        continue
    print(f\"{name}|{info['repo']}|{info['version']}|{asset['name']}|{asset['dest']}\")
")

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Error: some downloads failed."
  exit 1
fi

echo ""
echo "All binaries ready."
