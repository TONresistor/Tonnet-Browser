#!/usr/bin/env bash
# Publish Tonnet Browser by pushing an annotated version tag to the fork remote.
# GitHub Actions (.github/workflows/build.yml) builds the installers and attaches
# them to a GitHub Release on that remote. This script never pushes to upstream.
#
# The push remote is fixed: fork
# Running the script also sets remote.pushDefault=fork, so a later plain
# `git push` uses fork as well.
#
# Usage:
#   ./scripts/publish-release.sh [--dry-run] [--yes]
set -euo pipefail

REMOTE="fork"
DRY_RUN=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      echo "Usage: $0 [--dry-run] [--yes]" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: $PROJECT_DIR is not a git repository" >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "ERROR: git remote '$REMOTE' is not configured." >&2
  echo "Add the fork, then re-run:" >&2
  echo "  git remote add fork git@github.com:enlighTON/Tonnet-Browser.git" >&2
  exit 1
fi

REMOTE_URL="$(git remote get-url "$REMOTE")"
git config remote.pushDefault "$REMOTE"

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash before publishing." >&2
  git status --short >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: package.json version '$VERSION' is not major.minor.patch" >&2
  exit 1
fi

LOCK_VERSION="$(node -p "require('./package-lock.json').version")"
LOCK_ROOT="$(node -p "require('./package-lock.json').packages[''].version")"
if [ "$LOCK_VERSION" != "$VERSION" ] || [ "$LOCK_ROOT" != "$VERSION" ]; then
  echo "ERROR: package-lock.json version ($LOCK_VERSION / $LOCK_ROOT) != package.json ($VERSION)" >&2
  exit 1
fi

if ! grep -q "^## \\[$VERSION\\] - " CHANGELOG.md; then
  echo "ERROR: CHANGELOG.md has no '## [$VERSION] - YYYY-MM-DD' section." >&2
  echo "Move Unreleased into that section before publishing." >&2
  exit 1
fi

TAG="v$VERSION"
HEAD_SHA="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Fetching $REMOTE..."
git fetch "$REMOTE" main

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  TAG_SHA="$(git rev-parse "$TAG^{}")"
  if [ "$TAG_SHA" != "$HEAD_SHA" ]; then
    echo "ERROR: local tag $TAG points at ${TAG_SHA:0:12}, HEAD is ${HEAD_SHA:0:12}." >&2
    echo "Bump package.json, package-lock.json, and CHANGELOG.md, then commit." >&2
    exit 1
  fi
  if [ "$(git cat-file -t "refs/tags/$TAG")" != "tag" ]; then
    echo "ERROR: $TAG exists but is not an annotated tag." >&2
    exit 1
  fi
fi

REMOTE_TAG="$(git ls-remote --tags "$REMOTE" "refs/tags/$TAG" | awk 'NR==1 { print $1 }')"
if [ -n "$REMOTE_TAG" ]; then
  echo "ERROR: $REMOTE already has $TAG ($REMOTE_TAG)." >&2
  echo "Publish a new version instead of moving an existing release tag." >&2
  exit 1
fi

FORK_MAIN="$(git rev-parse "$REMOTE/main")"
if [ "$FORK_MAIN" = "$HEAD_SHA" ]; then
  MAIN_ACTION="already at HEAD"
elif git merge-base --is-ancestor "$FORK_MAIN" HEAD; then
  MAIN_ACTION="fast-forward ${FORK_MAIN:0:12} -> ${HEAD_SHA:0:12}"
else
  echo "ERROR: $REMOTE/main (${FORK_MAIN:0:12}) is not an ancestor of HEAD (${HEAD_SHA:0:12})." >&2
  echo "The release workflow only publishes a tag that is on main, and this script will not force-push." >&2
  echo "Merge or rebase onto $REMOTE/main, then re-run." >&2
  exit 1
fi

cat <<EOF

Publish to $REMOTE ($REMOTE_URL)
  branch:  $BRANCH
  version: $VERSION
  tag:     $TAG
  commit:  $HEAD_SHA
  main:    $MAIN_ACTION

The tag push starts "Build and Release" on the fork. Installers land at:
  ${REMOTE_URL%.git}/releases/tag/$TAG

EOF

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: no tag created, nothing pushed."
  echo "Default push remote is $REMOTE."
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Push $TAG to $REMOTE and update its main branch? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git tag -a "$TAG" HEAD -m "TON Browser $VERSION"
fi

if [ "$FORK_MAIN" != "$HEAD_SHA" ]; then
  git push "$REMOTE" HEAD:main
fi
git push "$REMOTE" "refs/tags/$TAG"

echo "Pushed $TAG to $REMOTE. Default push remote is $REMOTE."
echo "Watch the release workflow, then download from ${REMOTE_URL%.git}/releases/tag/$TAG"
