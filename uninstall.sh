#!/bin/bash
# Uninstall Agent Framework from a project
#
# Usage: 
#   ./uninstall.sh /path/to/your/project
#   ./uninstall.sh  # (will prompt for path)

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Get target directory
TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ]; then
    read -p "Enter path to your project: " TARGET_DIR
fi

# Expand ~ if present
TARGET_DIR="${TARGET_DIR/#\~/$HOME}"
# Get absolute path
TARGET=$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")

# Validate target
if [ ! -d "$TARGET" ]; then
    echo -e "${RED}Error: Directory does not exist: $TARGET${NC}"
    exit 1
fi

echo -e "${BLUE}🤖 Uninstalling Agent Framework from: $TARGET${NC}"
echo ""

# Check for existing worktrees
if [ -d "$TARGET/minions" ]; then
    # Try to find the project name from config if possible
    if [ -f "$TARGET/minions/bin/config.sh" ]; then
        PROJECT_NAME=$(grep 'PROJECT_NAME=' "$TARGET/minions/bin/config.sh" | cut -d'"' -f2 || true)
    fi
    
    if [ -z "$PROJECT_NAME" ]; then
        PROJECT_NAME=$(basename "$TARGET")
    fi
    
    # Check if there are active worktrees
    if [ -d "$TARGET/.git" ]; then
        WORKTREES=$(cd "$TARGET" && git worktree list | grep "$PROJECT_NAME-agent-" || true)
        
        if [ -n "$WORKTREES" ]; then
            echo -e "${YELLOW}⚠️  Active agent worktrees detected:${NC}"
            echo "$WORKTREES"
            echo ""
            read -p "Remove active worktrees first? (y/N) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                while read -r line; do
                    WT_PATH=$(echo "$line" | awk '{print $1}')
                    echo "   Removing worktree: $WT_PATH"
                    (cd "$TARGET" && git worktree remove "$WT_PATH" || git worktree remove -f "$WT_PATH")
                done <<< "$WORKTREES"
            fi
        fi
    fi
fi

# Remove minions directory
if [ -d "$TARGET/minions" ]; then
    echo -e "${BLUE}🗑️  Removing minions directory...${NC}"
    rm -rf "$TARGET/minions"
    echo "   ✓ Removed minions/"
fi

# Remove cursor rules
RULES_FILE="$TARGET/.cursor/rules/agent-rules.mdc"
if [ -f "$RULES_FILE" ]; then
    echo -e "${BLUE}🗑️  Removing cursor rules...${NC}"
    rm "$RULES_FILE"
    echo "   ✓ Removed agent-rules.mdc"
    
    # Remove directory if empty
    RULES_DIR=$(dirname "$RULES_FILE")
    if [ -d "$RULES_DIR" ] && [ -z "$(ls -A "$RULES_DIR")" ]; then
        rmdir "$RULES_DIR"
        echo "   ✓ Removed empty .cursor/rules directory"
    fi
fi

# Clean up .gitignore
GITIGNORE="$TARGET/.gitignore"
if [ -f "$GITIGNORE" ]; then
    echo -e "${BLUE}🔧 Cleaning up .gitignore...${NC}"
    # Remove the Agent Framework section
    # This uses a temporary file to safely filter the lines
    sed -i.bak '/# Agent Framework/,/.agent-info/d' "$GITIGNORE"
    rm -f "$GITIGNORE.bak"
    echo "   ✓ Cleaned .gitignore"
fi

echo ""
echo -e "${GREEN}✅ Agent Framework uninstalled successfully!${NC}"
echo ""

