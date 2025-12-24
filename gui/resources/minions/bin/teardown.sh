#!/bin/bash
# Teardown Agent Worktree
# Removes an agent worktree and cleans up resources

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
AGENT_ID=""
FORCE=""
CONFIG_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    --force)
      FORCE="--force"
      shift
      ;;
    *)
      if [ -z "$AGENT_ID" ]; then
        AGENT_ID="$1"
      else
        echo "Unknown argument: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$AGENT_ID" ]; then
  echo "Error: Agent ID required"
  echo "Usage: $0 <agent-id> [--force] [--config path]"
  exit 1
fi

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(pwd)"

# Load config
if [ -z "$CONFIG_FILE" ]; then
  CONFIG_FILE="$REPO_ROOT/minions/config.json"
fi

# Ensure absolute path
if [[ "$CONFIG_FILE" != /* ]]; then
  CONFIG_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$(basename "$CONFIG_FILE")"
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}Config file not found: $CONFIG_FILE${NC}"
  # Fallback? No, new system requires config.json
  exit 1
fi

# Helper to read config values
get_json_value() {
  python3 -c "import sys, json; print(json.load(open('$CONFIG_FILE'))$1)" 2>/dev/null || echo ""
}

PROJECT_NAME=$(get_json_value "['project']['name']")

if [ -z "$PROJECT_NAME" ]; then
  PROJECT_NAME=$(basename "$REPO_ROOT")
fi

# Check if agent ID already contains project name prefix (for multi-repo support)
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

