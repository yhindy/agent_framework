# Parallel Agent Development

This directory contains documentation and assignments for AI agents working on this project in parallel.

## Overview

The system supports multiple parallel agents, each working in isolated git worktrees. Agents can be:

- **Cursor IDE** (background agents)
- **Cursor CLI** (`cursor --folder <worktree>`)
- **Claude Code** (`claude` CLI)
- **Aider** or any other AI coding tool

## Quick Start

**1. Create an Agent Worktree**

```bash
./scripts/agents/setup.sh agent-1 feature/agent-1/my-feature
```

This creates an isolated copy of your codebase for the agent to work in.

**2. Start an AI Agent**

Give the agent its assignment file:

```bash
# Using Claude Code
cd ../yourproject-agent-1
claude "Read docs/agents/assignments/agent-1-*.md and implement the feature"

# Using Cursor CLI
cursor --folder ../yourproject-agent-1

# Using Cursor IDE
# Just open the worktree folder and start a background agent
```

## Directory Structure

```
docs/agents/
├── README.md                    # This file
├── ASSIGNMENTS.md               # Current feature assignments
├── templates/
│   └── FEATURE_SPEC.md          # Template for new assignments
└── assignments/
    ├── agent-1-feature.md       # Active assignment for agent-1
    ├── agent-2-bugfix.md        # Active assignment for agent-2
    └── ...
```

## Creating Assignments

1. Copy `templates/FEATURE_SPEC.md` to `assignments/agent-X-feature-name.md`
2. Fill in the feature requirements
3. Update `ASSIGNMENTS.md` with the assignment
4. Create the worktree: `./scripts/agents/setup.sh agent-X feature/agent-X/feature-name`
5. Point the AI agent at the assignment file

## Managing Worktrees

```bash
# List all agent worktrees
./scripts/agents/list.sh

# Remove a worktree when done
./scripts/agents/teardown.sh agent-1

# Force remove (discards uncommitted changes)
./scripts/agents/teardown.sh agent-1 --force
```

## Best Practices

### For Humans Coordinating Agents

1. **Assign non-overlapping work** - Each agent should work on files that others won't touch
2. **Keep assignments small** - Features that can be completed in 1-2 hours work best
3. **Review frequently** - Check agent progress and course-correct early
4. **Merge often** - Don't let branches diverge too far

### For AI Agents

1. **Read your assignment first** - The spec file has everything you need
2. **Stay in your lane** - Only modify files listed in your allowlist
3. **Test before committing** - Run tests before every commit
4. **Commit frequently** - Small, focused commits are easier to review
5. **Ask when stuck** - If requirements are unclear, document the question

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/agents/setup.sh` | Create new agent worktree |
| `scripts/agents/teardown.sh` | Remove agent worktree |
| `scripts/agents/list.sh` | List all agent worktrees |
| `scripts/agents/preflight.sh` | Verify setup before running |
| `scripts/agents/init.sh` | One-time framework setup |

