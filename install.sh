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

# Create directory structure
echo -e "${BLUE}📁 Creating directory structure...${NC}"
mkdir -p "$TARGET/minions"
mkdir -p "$TARGET/.cursor/rules"

# Copy files
echo -e "${BLUE}📋 Copying files...${NC}"

# Everything in minions folder
cp -R "$FRAMEWORK_DIR/minions/"* "$TARGET/minions/"
chmod +x "$TARGET/minions/bin/"*.sh
echo "   ✓ minions/"

# Cursor rules
cp "$FRAMEWORK_DIR/.cursor/rules/agent-rules.mdc" "$TARGET/.cursor/rules/"
echo "   ✓ .cursor/rules/agent-rules.mdc"

# Detect project name
PROJECT_NAME=$(basename "$TARGET")
echo ""
echo -e "${BLUE}🔧 Configuring for project: $PROJECT_NAME${NC}"

# Update config with detected project name
sed -i.bak "s/PROJECT_NAME=\"myproject\"/PROJECT_NAME=\"$PROJECT_NAME\"/" "$TARGET/minions/bin/config.sh"
rm -f "$TARGET/minions/bin/config.sh.bak"

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
echo "1. (Optional) Edit minions/bin/config.sh to customize settings"
echo ""
echo "2. Create your first agent worktree:"
echo "   cd $TARGET"
echo "   ./minions/bin/setup.sh agent-1 feature/agent-1/my-feature"
echo ""
echo "3. Start an AI agent in the worktree:"
echo "   cd ../$PROJECT_NAME-agent-1"
echo "   cursor ."
echo ""

