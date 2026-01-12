#!/bin/bash
# Install Agent Framework into a project
#
# Usage: 
#   ./install.sh /path/to/your/project
#   ./install.sh  # (will prompt for path)

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

FRAMEWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Get target directory
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    read -p "Enter path to your project: " TARGET
fi

# Expand ~ if present
TARGET="${TARGET/#\~/$HOME}"

# Validate target
if [ ! -d "$TARGET" ]; then
    echo -e "${RED}Error: Directory does not exist: $TARGET${NC}"
    exit 1
fi

if [ ! -d "$TARGET/.git" ]; then
    echo -e "${YELLOW}Warning: Target is not a git repository${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${BLUE}🤖 Installing Agent Framework${NC}"
echo "   From: $FRAMEWORK_DIR"
echo "   To:   $TARGET"
echo ""

# Check for Codex CLI
if ! command -v codex &> /dev/null; then
    echo -e "${YELLOW}Warning: Codex CLI not found.${NC}"
    echo "   If you plan to use Codex agents, install it with:"
    echo "   npm install -g @openai/codex-cli"
    echo "   Or visit: https://github.com/openai/openai-codex-cli"
    echo ""
fi

# Create directory structure
echo -e "${BLUE}📁 Creating directory structure...${NC}"
mkdir -p "$TARGET/minions/assignments"
mkdir -p "$TARGET/.cursor/rules"

# Copy Cursor rules
echo -e "${BLUE}📋 Copying configuration files...${NC}"
cp "$FRAMEWORK_DIR/.cursor/rules/agent-rules.mdc" "$TARGET/.cursor/rules/"
echo "   ✓ .cursor/rules/agent-rules.mdc"

# Detect project name
PROJECT_NAME=$(basename "$TARGET")

# Detect default branch
DEFAULT_BASE_BRANCH="main"
if git -C "$TARGET" rev-parse --verify main >/dev/null 2>&1; then
    DEFAULT_BASE_BRANCH="main"
elif git -C "$TARGET" rev-parse --verify master >/dev/null 2>&1; then
    DEFAULT_BASE_BRANCH="master"
fi

echo ""
echo -e "${BLUE}🔧 Configuring for project: $PROJECT_NAME ($DEFAULT_BASE_BRANCH)${NC}"

# Create config.json
cat > "$TARGET/minions/config.json" << EOF
{
  "project": {
    "name": "$PROJECT_NAME",
    "defaultBaseBranch": "$DEFAULT_BASE_BRANCH"
  },
  "setup": {
    "filesToCopy": [],
    "postSetupCommands": [],
    "requiredFiles": [],
    "preflightCommands": []
  },
  "assignments": [],
  "testEnvironments": []
}
EOF
echo "   ✓ minions/config.json"

# Add to .gitignore
GITIGNORE="$TARGET/.gitignore"
if [ -f "$GITIGNORE" ]; then
    if ! grep -q ".agent-info" "$GITIGNORE"; then
        echo "" >> "$GITIGNORE"
        echo "# Agent Framework" >> "$GITIGNORE"
        echo ".agent-info" >> "$GITIGNORE"
        echo "   ✓ Updated .gitignore"
    fi
else
    echo "# Agent Framework" > "$GITIGNORE"
    echo ".agent-info" >> "$GITIGNORE"
    echo "   ✓ Created .gitignore"
fi

echo ""
echo -e "${GREEN}✅ Agent Framework installed!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "1. (Optional) Edit minions/config.json to customize settings"
echo ""
echo "2. Open the Minion Laboratory app to manage your agents"
echo ""
echo "3. Create your first mission in the app"
echo ""

