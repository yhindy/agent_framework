#!/bin/bash
# Setup Agent Worktree
# Creates an isolated git worktree for a parallel agent
#
# Usage: ./minions/bin/setup.sh <agent-id> <branch-name> [base-branch]
#
# Example:
#   ./minions/bin/setup.sh agent-1 feature/agent-1/new-feature
#   ./minions/bin/setup.sh agent-2 feature/agent-2/bugfix main

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
AGENT_ID="${1:?Error: Agent ID required (e.g., agent-1)}"
BRANCH="${2:?Error: Branch name required (e.g., feature/agent-1/my-feature)}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load config
source "$SCRIPT_DIR/config.sh"

BASE_BRANCH="${3:-$DEFAULT_BASE_BRANCH}"
WORKTREE_PATH="$(dirname "$REPO_ROOT")/$PROJECT_NAME-$AGENT_ID"

echo -e "${BLUE}🍌 Deploying minion worktree for $AGENT_ID${NC}"
echo "   Project:    $PROJECT_NAME"
echo "   Branch:     $BRANCH"
echo "   Base:       $BASE_BRANCH"
echo "   Path:       $WORKTREE_PATH"
echo ""

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
    echo -e "${YELLOW}⚠️  Worktree already exists at $WORKTREE_PATH${NC}"
    echo "   To remove it, run: ./minions/bin/teardown.sh $AGENT_ID"
    exit 1
fi

# Create the worktree
echo -e "${BLUE}📁 Creating worktree...${NC}"
cd "$REPO_ROOT"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "   Branch exists, using existing branch"
    git worktree add -f "$WORKTREE_PATH" "$BRANCH"
else
    echo "   Creating new branch from $BASE_BRANCH"
    git worktree add -f "$WORKTREE_PATH" -b "$BRANCH" "$BASE_BRANCH"
fi

# Copy environment files
if [ ${#FILES_TO_COPY[@]} -gt 0 ]; then
    echo -e "${BLUE}📋 Copying environment files...${NC}"
    for file_spec in "${FILES_TO_COPY[@]}"; do
        SRC="${file_spec%%:*}"
        DST="${file_spec##*:}"
        if [ -f "$REPO_ROOT/$SRC" ]; then
            mkdir -p "$(dirname "$WORKTREE_PATH/$DST")"
            cp "$REPO_ROOT/$SRC" "$WORKTREE_PATH/$DST"
            echo "   Copied $SRC → $DST"
        else
            echo -e "${YELLOW}   Warning: $SRC not found${NC}"
        fi
    done
fi

# Copy minion mission files
echo -e "${BLUE}📋 Copying minion mission files...${NC}"
ASSIGNMENTS_SRC="$REPO_ROOT/minions/assignments"
ASSIGNMENTS_DST="$WORKTREE_PATH/minions/assignments"

if [ -d "$ASSIGNMENTS_SRC" ]; then
    mkdir -p "$ASSIGNMENTS_DST"
    FOUND=0
    for file in "$ASSIGNMENTS_SRC/${AGENT_ID}-"*.md; do
        if [ -f "$file" ]; then
            cp "$file" "$ASSIGNMENTS_DST/"
            echo "   Copied $(basename "$file")"
            FOUND=1
        fi
    done
    if [ $FOUND -eq 0 ]; then
        echo -e "${YELLOW}   No mission files found for $AGENT_ID${NC}"
        echo "   Create one: minions/assignments/${AGENT_ID}-feature-name.md"
    fi
fi

# Copy orchestrator signal rules
echo -e "${BLUE}📋 Copying orchestrator integration rules...${NC}"
RULES_SRC="$REPO_ROOT/minions/rules"
RULES_DST="$WORKTREE_PATH/minions/rules"

if [ -d "$RULES_SRC" ]; then
    mkdir -p "$RULES_DST"
    if [ -f "$RULES_SRC/orchestrator_signals.md" ]; then
        cp "$RULES_SRC/orchestrator_signals.md" "$RULES_DST/"
        echo "   Copied orchestrator_signals.md"
    fi
fi

# Run post-setup commands
if [ ${#POST_SETUP_COMMANDS[@]} -gt 0 ]; then
    echo -e "${BLUE}🔧 Running post-setup commands...${NC}"
    cd "$WORKTREE_PATH"
    for cmd in "${POST_SETUP_COMMANDS[@]}"; do
        echo "   Running: $cmd"
        eval "$cmd" || echo -e "${YELLOW}   Warning: Command failed${NC}"
    done
fi

# Create agent info file
cat > "$WORKTREE_PATH/.agent-info" << EOF
AGENT_ID=$AGENT_ID
BRANCH=$BRANCH
PROJECT=$PROJECT_NAME
EOF

echo ""
echo -e "${GREEN}✅ Minion ready for service!${NC}"
echo ""
echo -e "${YELLOW}📋 Minion Configuration:${NC}"
echo "   Minion ID:       $AGENT_ID"
echo "   Worktree:        $WORKTREE_PATH"
echo "   Branch:          $BRANCH"
echo ""
echo -e "${YELLOW}🚀 Next steps:${NC}"
echo ""
echo "1. Start working in the worktree:"
echo "   cd $WORKTREE_PATH"
echo ""
echo "2. Or launch an AI minion:"
echo "   cd $WORKTREE_PATH && cursor ."
echo "   cd $WORKTREE_PATH && claude \"Read minions/assignments/$AGENT_ID-*.md and implement\""
echo ""

