#!/bin/bash
# Launch Minion Orchestrator Dashboard
#
# Usage: ./minions/bin/dashboard.sh

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINIONS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$MINIONS_ROOT/.." && pwd)"

# Try to find the GUI directory
# 1. Check if we are in the agent_framework source repo
if [ -d "$PROJECT_ROOT/gui" ]; then
    GUI_DIR="$PROJECT_ROOT/gui"
else
    # 2. Check if we have a known environment variable or path (future proofing)
    echo -e "${RED}Error: GUI source not found at $PROJECT_ROOT/gui${NC}"
    echo -e "${YELLOW}The dashboard requires the GUI source to be present.${NC}"
    echo "If you installed this via install.sh, the GUI is not included in the target project."
    echo "Please run the dashboard from the agent_framework repository instead."
    exit 1
fi

echo -e "${BLUE}🍌 Launching Minion Orchestrator Dashboard...${NC}"
echo "   GUI Path: $GUI_DIR"
echo "   Project:  $PROJECT_ROOT"
echo ""

# Check for node_modules
if [ ! -d "$GUI_DIR/node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    cd "$GUI_DIR" && npm install

    # Rebuild native modules after install
    echo -e "${YELLOW}🔧 Rebuilding native modules for Electron...${NC}"
    cd "$GUI_DIR" && npm run rebuild
fi

# Check if node-pty needs rebuilding (check for marker file)
REBUILD_MARKER="$GUI_DIR/node_modules/.node-pty-rebuilt"
if [ ! -f "$REBUILD_MARKER" ]; then
    echo -e "${YELLOW}🔧 Rebuilding node-pty for Electron...${NC}"
    cd "$GUI_DIR" && npm run rebuild && touch "$REBUILD_MARKER"
fi

# Run the dashboard
echo -e "${GREEN}✅ Starting dashboard...${NC}"
cd "$GUI_DIR" && npm run dev

