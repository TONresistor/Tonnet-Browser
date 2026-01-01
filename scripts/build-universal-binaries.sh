#!/bin/bash
#
# Build Universal Binaries for macOS
# Creates fat binaries that run on both Intel (x86_64) and Apple Silicon (arm64)
#
# Requirements:
#   - macOS with Xcode Command Line Tools installed
#   - Go 1.22 or later
#   - lipo (included with Xcode)
#
# Usage:
#   ./scripts/build-universal-binaries.sh [--clean] [--verify]
#
# Options:
#   --clean    Remove existing binaries before building
#   --verify   Verify the binaries after building (default: enabled)
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/resources/bin/mac"
TEMP_DIR="/tmp/tonnet-build-$$"

# Repository URLs
TONUTILS_PROXY_REPO="https://github.com/xssnick/tonutils-proxy.git"
TONUTILS_STORAGE_REPO="https://github.com/xssnick/tonutils-storage.git"
TONNET_PROXY_REPO="https://github.com/TONresistor/tonnet-proxy.git"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
CLEAN=false
VERIFY=true
for arg in "$@"; do
    case $arg in
        --clean)
            CLEAN=true
            shift
            ;;
        --verify)
            VERIFY=true
            shift
            ;;
        --no-verify)
            VERIFY=false
            shift
            ;;
        *)
            ;;
    esac
done

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Tonnet Browser Universal Binary Builder${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Check requirements
check_requirements() {
    echo -e "${YELLOW}Checking requirements...${NC}"

    # Check for macOS
    if [[ "$(uname)" != "Darwin" ]]; then
        echo -e "${RED}Error: This script must be run on macOS${NC}"
        exit 1
    fi

    # Check for Go
    if ! command -v go &> /dev/null; then
        echo -e "${RED}Error: Go is not installed${NC}"
        echo "Install Go from: https://go.dev/dl/"
        exit 1
    fi

    GO_VERSION=$(go version | grep -oE 'go[0-9]+\.[0-9]+' | sed 's/go//')
    echo -e "  Go version: ${GREEN}$GO_VERSION${NC}"

    # Check for lipo
    if ! command -v lipo &> /dev/null; then
        echo -e "${RED}Error: lipo is not installed${NC}"
        echo "Install Xcode Command Line Tools: xcode-select --install"
        exit 1
    fi
    echo -e "  lipo: ${GREEN}available${NC}"

    # Check for git
    if ! command -v git &> /dev/null; then
        echo -e "${RED}Error: git is not installed${NC}"
        exit 1
    fi
    echo -e "  git: ${GREEN}available${NC}"

    echo ""
}

# Create directories
setup_directories() {
    echo -e "${YELLOW}Setting up directories...${NC}"

    if [ "$CLEAN" = true ] && [ -d "$BIN_DIR" ]; then
        echo "  Cleaning existing binaries..."
        rm -rf "$BIN_DIR"
    fi

    mkdir -p "$BIN_DIR"
    mkdir -p "$TEMP_DIR"

    echo -e "  Output directory: ${GREEN}$BIN_DIR${NC}"
    echo -e "  Temp directory: ${GREEN}$TEMP_DIR${NC}"
    echo ""
}

# Build universal binary from source
build_universal() {
    local name="$1"
    local repo="$2"
    local build_path="${3:-.}"  # Default to current directory

    echo -e "${BLUE}Building $name universal binary...${NC}"

    local src_dir="$TEMP_DIR/$name"

    # Clone repository
    echo "  Cloning repository..."
    git clone --depth 1 "$repo" "$src_dir" 2>/dev/null

    cd "$src_dir"

    # Get version
    local version=$(git describe --tags --always 2>/dev/null || echo "dev")
    echo -e "  Version: ${GREEN}$version${NC}"

    # Build for x86_64
    echo "  Building for x86_64 (Intel)..."
    CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build \
        -ldflags="-s -w -X main.version=$version" \
        -o "${name}-amd64" \
        "$build_path"

    # Build for arm64
    echo "  Building for arm64 (Apple Silicon)..."
    CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build \
        -ldflags="-s -w -X main.version=$version" \
        -o "${name}-arm64" \
        "$build_path"

    # Create universal binary
    echo "  Creating universal binary with lipo..."
    lipo -create -output "${name}-universal" "${name}-amd64" "${name}-arm64"

    # Copy to output directory
    local output_name="${name}"
    if [[ "$name" == *"-proxy" ]] || [[ "$name" == *"-storage" ]]; then
        output_name="${name}"
    fi

    cp "${name}-universal" "$BIN_DIR/${output_name}"
    chmod +x "$BIN_DIR/${output_name}"

    echo -e "  ${GREEN}Successfully built $name${NC}"
    echo ""
}

# Verify binaries
verify_binaries() {
    echo -e "${YELLOW}Verifying universal binaries...${NC}"
    echo ""

    for binary in "$BIN_DIR"/*; do
        if [ -f "$binary" ]; then
            local name=$(basename "$binary")
            echo -e "${BLUE}$name:${NC}"

            # Check file type
            local file_info=$(file "$binary")
            echo "  Type: $file_info"

            # Check architectures
            local arch_info=$(lipo -info "$binary" 2>/dev/null)
            if [[ "$arch_info" == *"x86_64"* ]] && [[ "$arch_info" == *"arm64"* ]]; then
                echo -e "  Architectures: ${GREEN}x86_64 + arm64 (Universal)${NC}"
            else
                echo -e "  Architectures: ${RED}Not a universal binary${NC}"
            fi

            # Check size
            local size=$(ls -lh "$binary" | awk '{print $5}')
            echo "  Size: $size"
            echo ""
        fi
    done
}

# Cleanup
cleanup() {
    echo -e "${YELLOW}Cleaning up temporary files...${NC}"
    rm -rf "$TEMP_DIR"
    echo ""
}

# Main execution
main() {
    check_requirements
    setup_directories

    # Build each component
    build_universal "tonutils-proxy" "$TONUTILS_PROXY_REPO" "."
    build_universal "tonutils-storage" "$TONUTILS_STORAGE_REPO" "./cmd/tonutils-storage"
    build_universal "tonnet-proxy" "$TONNET_PROXY_REPO" "./cmd/"

    if [ "$VERIFY" = true ]; then
        verify_binaries
    fi

    cleanup

    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  Build completed successfully!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo "Universal binaries are located in:"
    echo "  $BIN_DIR"
    echo ""
    echo "These binaries will run natively on both:"
    echo "  - Intel Macs (x86_64)"
    echo "  - Apple Silicon Macs (M1/M2/M3 - arm64)"
}

# Trap to cleanup on exit
trap cleanup EXIT

main
