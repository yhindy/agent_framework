#!/bin/bash
# Setup Agent Worktree
# Creates an isolated git worktree for a parallel agent

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
AGENT_ID=""
BRANCH=""
BASE_BRANCH=""
CONFIG_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    *)
      if [ -z "$AGENT_ID" ]; then
        AGENT_ID="$1"
      elif [ -z "$BRANCH" ]; then
        BRANCH="$1"
      elif [ -z "$BASE_BRANCH" ]; then
        BASE_BRANCH="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$AGENT_ID" ] || [ -z "$BRANCH" ]; then
  echo "Error: Agent ID and Branch name are required"
  echo "Usage: $0 <agent-id> <branch-name> [base-branch] [--config path]"
  exit 1
fi

REPO_ROOT="$(pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Config detection (new format first, legacy fallback)
# If --config was passed, use that directly
if [ -n "$CONFIG_FILE" ]; then
  # Ensure absolute path
  if [[ "$CONFIG_FILE" != /* ]]; then
    CONFIG_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$(basename "$CONFIG_FILE")"
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Config file not found: $CONFIG_FILE${NC}"
    exit 1
  fi

  # Determine format based on path
  if [[ "$CONFIG_FILE" == *"/minions.json" ]]; then
    CONFIG_FORMAT="v2"
    echo "   Using config: minions.json (v2 format)"
  else
    CONFIG_FORMAT="v1"
    echo "   Using config: minions/config.json (legacy format)"
  fi
else
  # Auto-detect config format
  if [ -f "$REPO_ROOT/minions.json" ]; then
    CONFIG_FILE="$REPO_ROOT/minions.json"
    CONFIG_FORMAT="v2"
    echo "   Using config: minions.json (v2 format)"
  elif [ -f "$REPO_ROOT/minions/config.json" ]; then
    CONFIG_FILE="$REPO_ROOT/minions/config.json"
    CONFIG_FORMAT="v1"
    echo "   Using config: minions/config.json (legacy format)"
  else
    echo -e "${RED}❌ Error: No minions configuration found${NC}"
    echo "   Expected: minions.json (new) or minions/config.json (legacy)"
    exit 1
  fi
fi

# Helper to read config values using python (available on macOS/Linux usually)
get_json_value() {
  python3 -c "import sys, json; print(json.load(open('$CONFIG_FILE'))$1)" 2>/dev/null || echo ""
}

PROJECT_NAME=$(get_json_value "['project']['name']")
DEFAULT_BASE_BRANCH=$(get_json_value "['project']['defaultBaseBranch']")

if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH="$DEFAULT_BASE_BRANCH"
fi

if [ -z "$PROJECT_NAME" ]; then
  PROJECT_NAME=$(basename "$REPO_ROOT")
fi

# New naming convention: ../<AGENT_ID> (where AGENT_ID is repo-N)
# Legacy: ../<PROJECT_NAME>-<AGENT_ID> (where AGENT_ID was agent-N)
if [[ "$AGENT_ID" == "$PROJECT_NAME-"* ]]; then
  WORKTREE_PATH="$(dirname "$REPO_ROOT")/$AGENT_ID"
else
  WORKTREE_PATH="$(dirname "$REPO_ROOT")/$PROJECT_NAME-$AGENT_ID"
fi

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

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "   Branch exists, using existing branch"
    git worktree add -f "$WORKTREE_PATH" "$BRANCH"
else
    echo "   Creating new branch from $BASE_BRANCH"
    git worktree add -f "$WORKTREE_PATH" -b "$BRANCH" "$BASE_BRANCH"
fi

# Copy environment files
echo -e "${BLUE}📋 Copying environment files...${NC}"
python3 << PYTHON_SCRIPT |
import json
import sys

config_format = "$CONFIG_FORMAT"

try:
    with open("$CONFIG_FILE", "r") as f:
        data = json.load(f)

    files_to_copy = data.get('setup', {}).get('filesToCopy', [])

    if not isinstance(files_to_copy, list):
        sys.stderr.write(f"Error: filesToCopy must be an array, got {type(files_to_copy).__name__}\n")
        sys.exit(1)

    for entry in files_to_copy:
        if config_format == "v2":
            # v2 format: simple string array
            if not isinstance(entry, str):
                sys.stderr.write(f"Error: Each filesToCopy entry must be a string in v2 format, got {type(entry).__name__}\n")
                sys.exit(1)
            # Parse entry: "source" or "source:destination"
            if ':' in entry:
                parts = entry.split(':', 1)
                source = parts[0]
                destination = parts[1]
            else:
                source = destination = entry
        else:
            # v1 (legacy) format: can be string or object {source, destination}
            if isinstance(entry, str):
                # Parse entry: "source" or "source:destination"
                if ':' in entry:
                    parts = entry.split(':', 1)
                    source = parts[0]
                    destination = parts[1]
                else:
                    source = destination = entry
            elif isinstance(entry, dict):
                # Object format: {source: "...", destination: "..."}
                source = entry.get('source', '')
                destination = entry.get('destination', source)
                if not source:
                    sys.stderr.write("Error: Object entry missing 'source' field\n")
                    sys.exit(1)
            else:
                sys.stderr.write(f"Error: Each filesToCopy entry must be a string or object, got {type(entry).__name__}\n")
                sys.exit(1)

        # Output in format that bash can parse
        print(f"{source}:{destination}")

except json.JSONDecodeError as e:
    sys.stderr.write(f"Error: Failed to parse JSON config: {e}\n")
    sys.exit(1)
except KeyError:
    # filesToCopy not defined, that's OK
    pass
except Exception as e:
    sys.stderr.write(f"Error: {e}\n")
    sys.exit(1)
PYTHON_SCRIPT
while read -r file_spec; do
    if [ -n "$file_spec" ]; then
        SRC="${file_spec%%:*}"
        DST="${file_spec##*:}"
        if [ -f "$REPO_ROOT/$SRC" ]; then
            mkdir -p "$(dirname "$WORKTREE_PATH/$DST")"
            cp "$REPO_ROOT/$SRC" "$WORKTREE_PATH/$DST"
            echo "   Copied $SRC → $DST"
        else
            echo -e "${YELLOW}   Warning: $SRC not found${NC}"
        fi
    fi
done

# Copy minion mission files
# Assignments are now likely just in memory or config, but if spec files exist, copy them
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
fi

# Copy orchestrator signal rules
echo -e "${BLUE}📋 Copying orchestrator integration rules...${NC}"
# Rules are now bundled with the script in ../rules
RULES_SRC="$SCRIPT_DIR/../rules"
RULES_DST="$WORKTREE_PATH/minions/rules"

if [ -d "$RULES_SRC" ]; then
    mkdir -p "$RULES_DST"
    # Note: super-minion-rules.md is read directly from agent_framework, not copied to worktrees
    # Also copy agent rules if they exist
    if [ -f "$RULES_SRC/agent-rules.mdc" ]; then
        mkdir -p "$WORKTREE_PATH/.cursor/rules"
        cp "$RULES_SRC/agent-rules.mdc" "$WORKTREE_PATH/.cursor/rules/"
        echo "   Copied agent-rules.mdc"
    fi
fi

# Run post-setup commands
echo -e "${BLUE}🔧 Running post-setup commands...${NC}"
cd "$WORKTREE_PATH"
python3 -c "import sys, json; 
data = json.load(open('$CONFIG_FILE'))
try:
  for cmd in data['setup']['postSetupCommands']:
    print(cmd)
except: pass" | while read -r cmd; do
    if [ -n "$cmd" ]; then
        echo "   Running: $cmd"
        eval "$cmd" || echo -e "${YELLOW}   Warning: Command failed${NC}"
    fi
done

# For v2 format, ensure .minions/agents directory exists in main repo
# The GUI will write agent info there instead of .agent-info in worktree
if [ "$CONFIG_FORMAT" = "v2" ]; then
    echo -e "${BLUE}📁 Ensuring .minions/agents directory exists...${NC}"
    mkdir -p "$REPO_ROOT/.minions/agents"
    echo "   Created .minions/agents directory for agent state"
fi

# Note: .agent-info file (legacy) or .minions/agents/{id}.json (v2) is created by the GUI

echo ""
echo -e "${GREEN}✅ Minion ready for service!${NC}"
echo ""


