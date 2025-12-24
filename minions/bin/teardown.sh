#!/bin/bash
# Teardown Agent Worktree
# Removes an agent worktree and cleans up resources
#
# Usage: ./minions/bin/teardown.sh <agent-id> [--force]
#
# Example:
#   ./minions/bin/teardown.sh agent-1
#   ./minions/bin/teardown.sh agent-2 --force

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Arguments
AGENT_ID="${1:?Error: Agent ID required (e.g., agent-1)}"
FORCE="${2:-}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load config
source "$SCRIPT_DIR/config.sh"

# Check if agent ID already contains project name prefix (for multi-repo support)
# Agent IDs can be in format: "projectname-xxxx" where projectname might match PROJECT_NAME
if [[ "$AGENT_ID" == "$PROJECT_NAME-"* ]]; then
  # Agent ID already includes project name, don't duplicate it
  WORKTREE_PATH="$(dirname "$REPO_ROOT")/$AGENT_ID"
else
  # Legacy format: agent ID doesn't include project name
  WORKTREE_PATH="$(dirname "$REPO_ROOT")/$PROJECT_NAME-$AGENT_ID"
fi

echo -e "${BLUE}🗑️  Retiring minion $AGENT_ID${NC}"
echo "   Path: $WORKTREE_PATH"
echo ""

# Check if worktree exists
if [ ! -d "$WORKTREE_PATH" ]; then
    echo -e "${YELLOW}⚠️  Worktree does not exist at $WORKTREE_PATH${NC}"
    exit 0
fi

# Get the branch name before removing
cd "$REPO_ROOT"
BRANCH=$(git worktree list --porcelain | grep -A2 "$WORKTREE_PATH" | grep "branch" | sed 's/branch refs\/heads\///' || echo "")

# Check for uncommitted changes
cd "$WORKTREE_PATH"
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}⚠️  Worktree has uncommitted changes:${NC}"
    git status --short
    echo ""
    
    if [ "$FORCE" != "--force" ]; then
        echo -e "${YELLOW}Use --force to remove anyway, or commit/stash changes first.${NC}"
        exit 1
    else
        echo -e "${YELLOW}--force specified, proceeding anyway...${NC}"
    fi
fi

# Remove the worktree
echo -e "${BLUE}📁 Removing worktree...${NC}"
cd "$REPO_ROOT"
git worktree remove "$WORKTREE_PATH" ${FORCE:+--force}

# Optionally delete the branch
if [ -n "$BRANCH" ]; then
    echo ""
    echo -e "${YELLOW}The branch '$BRANCH' still exists.${NC}"
    echo "To delete it: git branch -d $BRANCH"
    echo "To force delete: git branch -D $BRANCH"
fi

echo ""
echo -e "${GREEN}✅ Minion retired successfully${NC}"
echo ""

