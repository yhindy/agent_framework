#!/bin/bash
# Pre-flight Checks
# Verifies everything is set up correctly before running
#
# Usage: ./scripts/agents/preflight.sh [agent-id]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

AGENT_ID="${1:-}"
CHECKS_PASSED=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load config
source "$SCRIPT_DIR/config.sh"

echo "🔍 Running pre-flight checks..."
echo ""

# Check required files
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$REPO_ROOT/$file" ]; then
        echo -e "${RED}✗ FAIL: $file missing${NC}"
        CHECKS_PASSED=false
    else
        echo -e "${GREEN}✓ Found: $file${NC}"
    fi
done

# Run preflight commands
for cmd in "${PREFLIGHT_COMMANDS[@]}"; do
    if eval "$cmd"; then
        echo -e "${GREEN}✓ Command passed: $cmd${NC}"
    else
        echo -e "${RED}✗ FAIL: $cmd${NC}"
        CHECKS_PASSED=false
    fi
done

# Check git status
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo -e "${YELLOW}⚠ Warning: Uncommitted changes in working directory${NC}"
fi

echo ""

if [ "$CHECKS_PASSED" = true ]; then
    echo -e "${GREEN}✅ All pre-flight checks passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Fix the issues above and try again.${NC}"
    exit 1
fi

