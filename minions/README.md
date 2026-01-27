# Parallel Minion Missions 🍌

This directory contains documentation and missions for AI minions working on this project in parallel.

## Overview

The system supports multiple parallel minions, each working in isolated git worktrees. Minions can be:

- **Cursor IDE** (background minions)
- **Cursor CLI** (`cursor --folder <worktree>`)
- **Claude Code** (`claude` CLI)
- **Aider** or any other AI coding tool

## Quick Start

**1. Create a Minion Worktree**

```bash
./minions/bin/setup.sh agent-1 feature/agent-1/my-feature
```

This creates an isolated copy of your codebase for the minion to work in.

**2. Start an AI Minion**

Give the minion its mission file:

```bash
# Using Claude Code
cd ../yourproject-agent-1
claude "Read minions/assignments/agent-1-*.md and implement the feature"

# Using Cursor CLI
cursor --folder ../yourproject-agent-1

# Using Cursor IDE
# Just open the worktree folder and start a background minion
```

## Directory Structure

**Note:** The framework now supports two configuration formats. This directory is used by the legacy format (v1). New projects use `minions.json` at the project root instead.

### Legacy Format (this directory)
```
minions/
├── README.md                    # This file
├── config.json                  # Project configuration
├── templates/
│   └── FEATURE_SPEC.md          # Template for new missions
├── rules/                       # Agent behavior rules
└── bin/                         # Management scripts
```

### New Format (v2.0)
```
your-project/
├── minions.json                 # Single config file (at project root)
└── .minions/                    # Runtime state folder
    └── agents/                  # Per-agent state files
```

## Creating Missions

1. Copy `templates/FEATURE_SPEC.md` to `assignments/agent-X-feature-name.md`
2. Fill in the feature requirements
3. Create the worktree: `./minions/bin/setup.sh agent-X feature/agent-X/feature-name`
4. Point the AI minion at the mission file

## Managing Worktrees

```bash
# List all minion worktrees
./minions/bin/list.sh

# Remove a worktree when done
./minions/bin/teardown.sh agent-1

# Force remove (discards uncommitted changes)
./minions/bin/teardown.sh agent-1 --force
```

## Best Practices

### For Humans Coordinating Minions

1. **Assign non-overlapping work** - Each minion should work on files that others won't touch
2. **Keep missions small** - Features that can be completed in 1-2 hours work best
3. **Review frequently** - Check minion progress and course-correct early
4. **Merge often** - Don't let branches diverge too far

### For AI Minions

1. **Read your mission first** - The spec file has everything you need
2. **Stay in your lane** - Only modify files listed in your allowlist
3. **Test before committing** - Run tests before every commit
4. **Commit frequently** - Small, focused commits are easier to review
5. **Ask when stuck** - If requirements are unclear, document the question

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `minions/bin/setup.sh` | Create new minion worktree |
| `minions/bin/teardown.sh` | Remove minion worktree |
| `minions/bin/list.sh` | List all minion worktrees |
| `minions/bin/preflight.sh` | Verify setup before running |
| `minions/bin/init.sh` | One-time framework setup |
| `minions/bin/dashboard.sh` | Launch GUI dashboard |
