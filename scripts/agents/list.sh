#!/bin/bash
# List Agent Worktrees
# Shows all active agent worktrees and their status
#
# Usage: ./scripts/agents/list.sh

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load config
source "$SCRIPT_DIR/config.sh"

echo -e "${BLUE}🍌 Minion Worktrees for $PROJECT_NAME${NC}"
echo "=================================="
echo ""

cd "$REPO_ROOT"

# Get all worktrees
WORKTREES=$(git worktree list --porcelain)

if [ -z "$WORKTREES" ]; then
    echo "No worktrees found."
    exit 0
fi

# Parse and display worktrees
printf "${CYAN}%-15s %-50s %-30s${NC}\n" "MINION" "PATH" "BRANCH"
echo "--------------- -------------------------------------------------- ------------------------------"

FOUND_AGENTS=0
git worktree list | while read -r line; do
    WORKTREE_PATH=$(echo "$line" | awk '{print $1}')
    BRANCH=$(echo "$line" | awk '{print $3}' | tr -d '[]')
    
    # Check if it's an agent worktree for this project
    if [[ "$WORKTREE_PATH" == *"$PROJECT_NAME-agent-"* ]]; then
        AGENT_ID=$(basename "$WORKTREE_PATH" | sed "s/$PROJECT_NAME-//")
        printf "%-15s %-50s %-30s\n" "$AGENT_ID" "$WORKTREE_PATH" "$BRANCH"
        FOUND_AGENTS=1
    fi
done

echo ""

