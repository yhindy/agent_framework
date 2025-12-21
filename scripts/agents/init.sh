#!/bin/bash
# Initialize Agent Framework
# Run this once after copying the framework into your project
#
# Usage: ./scripts/agents/init.sh

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}🍌 Initializing Minion Framework${NC}"
echo ""

# Create directory structure if not exists
echo -e "${BLUE}📁 Creating directory structure...${NC}"
mkdir -p "$REPO_ROOT/docs/agents/assignments"
mkdir -p "$REPO_ROOT/docs/agents/templates"
mkdir -p "$REPO_ROOT/.cursor/rules"

# Check if config needs to be updated
CONFIG_FILE="$SCRIPT_DIR/config.sh"
if grep -q 'PROJECT_NAME="myproject"' "$CONFIG_FILE"; then
    # Try to auto-detect project name from folder
    DETECTED_NAME=$(basename "$REPO_ROOT")
    echo -e "${YELLOW}⚠️  Please update PROJECT_NAME in scripts/agents/config.sh${NC}"
    echo "   Detected project name: $DETECTED_NAME"
    echo ""
fi

# Make scripts executable
echo -e "${BLUE}🔧 Making scripts executable...${NC}"
chmod +x "$SCRIPT_DIR"/*.sh

# Add to .gitignore if not already there
GITIGNORE="$REPO_ROOT/.gitignore"
if [ -f "$GITIGNORE" ]; then
    if ! grep -q ".agent-info" "$GITIGNORE"; then
        echo "" >> "$GITIGNORE"
        echo "# Agent Framework" >> "$GITIGNORE"
        echo ".agent-info" >> "$GITIGNORE"
        echo -e "   Added .agent-info to .gitignore"
    fi
fi

echo ""
echo -e "${GREEN}✅ Minion Framework initialized!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "1. Edit scripts/agents/config.sh to set your project name"
echo ""
echo "2. (Optional) Customize .cursor/rules/agent-rules.mdc for your project"
echo ""
echo "3. Create a minion worktree:"
echo "   ./scripts/agents/setup.sh agent-1 feature/agent-1/my-feature"
echo ""

