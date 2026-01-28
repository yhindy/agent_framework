#!/bin/bash
set -e

# Parse arguments
AUTO_CONFIRM=false
VERSION=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes)
      AUTO_CONFIRM=true
      shift
      ;;
    *)
      VERSION="$1"
      shift
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version> [-y|--yes]"
  echo "Example: ./scripts/release.sh 0.0.2"
  echo "         ./scripts/release.sh 0.0.2 --yes  # Skip confirmation prompts"
  exit 1
fi

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 0.0.2)"
  exit 1
fi

TAG="v$VERSION"

echo "=== Preparing release $TAG ==="

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --staged --quiet; then
  echo "Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Check we're on a release branch or main
BRANCH=$(git branch --show-current)
echo "Current branch: $BRANCH"

# Update version in package.json files
echo "Updating version to $VERSION..."
npm version "$VERSION" --no-git-tag-version
npm version "$VERSION" --no-git-tag-version -w gui
npm version "$VERSION" --no-git-tag-version -w minions

# Generate changelog entry from commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
echo "Last tag: ${LAST_TAG:-none}"

if [ -n "$LAST_TAG" ]; then
  echo ""
  echo "Commits since $LAST_TAG:"
  git --no-pager log "$LAST_TAG"..HEAD --oneline
fi

# Note: Tests run in GitHub Actions after tag is pushed (see .github/workflows/release.yml)
# Skipping local test run to avoid duplication

# Commit version bump
echo ""
echo "=== Committing changes ==="
git add package.json gui/package.json minions/package.json package-lock.json
git commit -m "[release] Prepare $TAG release"

# Create tag
echo ""
echo "=== Creating tag $TAG ==="
git tag -a "$TAG" -m "Release $TAG"

# Push
echo ""
if [ "$AUTO_CONFIRM" = true ]; then
  REPLY="y"
else
  read -p "Push commit and tag to origin? (y/n) " -n 1 -r
  echo
fi

if [[ $REPLY =~ ^[Yy]$ ]]; then
  git push origin HEAD
  git push origin "$TAG"
  echo ""
  echo "=== Release triggered! ==="
  echo "GitHub Actions will now run tests and create the release."
  echo "Watch progress at: https://github.com/yhindy/agent_framework/actions"
else
  echo "Skipped push. To push manually:"
  echo "  git push origin HEAD"
  echo "  git push origin $TAG"
fi
