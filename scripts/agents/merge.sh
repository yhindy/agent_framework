#!/bin/bash
# Merge Agent Helper Script
# Performs the actual git merge operation
#
# Usage: ./scripts/agents/merge.sh <source-branch> [target-branch]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SOURCE_BRANCH="${1:?Error: Source branch required}"
TARGET_BRANCH="${2:-master}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}🔀 Merging $SOURCE_BRANCH → $TARGET_BRANCH${NC}"
echo ""

cd "$REPO_ROOT"

# Ensure we're on the target branch
echo -e "${BLUE}Switching to $TARGET_BRANCH...${NC}"
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH" || true

# Check if branch exists
if ! git show-ref --verify --quiet "refs/heads/$SOURCE_BRANCH"; then
    echo -e "${RED}❌ Branch $SOURCE_BRANCH does not exist${NC}"
    exit 1
fi

# Check for conflicts
echo -e "${BLUE}Checking for merge conflicts...${NC}"
if ! git merge --no-commit --no-ff "$SOURCE_BRANCH" 2>&1 | grep -q "CONFLICT"; then
    # No conflicts, abort the test merge
    git merge --abort 2>/dev/null || true
else
    echo -e "${YELLOW}⚠️  Merge conflicts detected!${NC}"
    git merge --abort 2>/dev/null || true
    echo "===SIGNAL:BLOCKER==="
    exit 1
fi

# Perform the actual merge
echo -e "${BLUE}Merging...${NC}"
git merge --no-ff "$SOURCE_BRANCH" -m "Merge $SOURCE_BRANCH into $TARGET_BRANCH

Automated merge by agent framework
Source: $SOURCE_BRANCH
Target: $TARGET_BRANCH
"

echo ""
echo -e "${GREEN}✅ Merge successful!${NC}"
echo "===SIGNAL:DEV_COMPLETED==="
