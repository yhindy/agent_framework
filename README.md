# Agent Framework

A lightweight framework for running multiple AI coding agents in parallel on any codebase.

## Quick Start

```bash
# 1. Copy this framework into your project root
cp -r agent_framework/* /path/to/your/project/

# 2. Initialize the framework
./scripts/agents/init.sh

# 3. Create your first agent worktree
./scripts/agents/setup.sh agent-1 feature/agent-1/my-feature

# 4. Start working (choose your AI tool)
cd ../yourproject-agent-1
cursor .                    # Cursor IDE
claude "Read docs/agents/assignments/agent-1-*.md and implement the feature"  # Claude Code
aider                       # Aider
```

## What's Included

```
your-project/
├── scripts/agents/           # Agent management scripts
│   ├── init.sh              # One-time setup
│   ├── setup.sh             # Create agent worktree
│   ├── teardown.sh          # Remove agent worktree
│   ├── list.sh              # List all agent worktrees
│   └── preflight.sh         # Verify setup before running
├── docs/agents/              # Agent documentation
│   ├── README.md            # Main agent guide
│   ├── ASSIGNMENTS.md       # Track active assignments
│   └── templates/
│       └── FEATURE_SPEC.md  # Template for new features
└── .cursor/rules/
    └── agent-rules.mdc      # Cursor IDE rules for agents
```

## Creating Agent Assignments

1. Copy the template:
   ```bash
   cp docs/agents/templates/FEATURE_SPEC.md docs/agents/assignments/agent-1-my-feature.md
   ```

2. Fill in the feature requirements

3. Create the worktree:
   ```bash
   ./scripts/agents/setup.sh agent-1 feature/agent-1/my-feature
   ```

4. Point your AI agent at the assignment file

## Configuration

Edit `scripts/agents/config.sh` to customize:
- Project name (used for worktree folder names)
- Base branch (defaults to main)
- Files to copy to worktrees (env files, secrets, etc.)

## Supported AI Tools

| Tool | Command |
|------|---------|
| Cursor IDE | Open worktree folder, start background agent |
| Cursor CLI | `cursor --folder ../yourproject-agent-1` |
| Claude Code | `claude "Read assignment and implement"` |
| Aider | `aider` |
| Any AI tool | Just point it at the worktree |

## How It Works

The framework uses **git worktrees** to give each agent an isolated copy of your codebase:

- Each agent works in its own folder (`../yourproject-agent-1`, etc.)
- Agents share git history but have independent working directories
- No conflicts between agents working on different features
- Easy cleanup when done

## Best Practices

### For Humans Coordinating Agents

1. **Assign non-overlapping work** - Each agent should touch different files
2. **Keep assignments small** - Features completable in 1-2 hours work best
3. **Review frequently** - Check agent progress and course-correct early
4. **Merge often** - Don't let branches diverge too far

### For AI Agents

1. **Read your assignment first** - The spec file has requirements and boundaries
2. **Stay in your lane** - Only modify files in your allowlist
3. **Test before committing** - Run tests before every commit
4. **Commit frequently** - Small, focused commits are easier to review

## License

MIT - Use this however you want.
