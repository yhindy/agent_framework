# Minion Framework 🍌

A lightweight framework for running multiple AI coding minions in parallel on any codebase.

## Quick Start

```bash
# 1. Install the framework into your project
./install.sh /path/to/your/project

# 2. Go to your project and initialize
cd /path/to/your/project
./minions/bin/init.sh

# 3. Create your first minion worktree
./minions/bin/setup.sh agent-1 feature/agent-1/my-feature

# 4. Start working (choose your AI tool)
cd ../yourproject-agent-1
cursor .                    # Cursor IDE
claude "Read minions/assignments/agent-test-*.md and implement"  # Claude Code
aider                       # Aider
```

## What's Included

```
your-project/
├── minions/                  # Minion Framework
│   ├── bin/                 # Management scripts
│   │   ├── init.sh          # One-time setup
│   │   ├── setup.sh         # Create minion worktree
│   │   ├── teardown.sh      # Remove minion worktree
│   │   ├── list.sh          # List all minion worktrees
│   │   ├── dashboard.sh     # Launch GUI dashboard
│   │   └── ...
│   ├── assignments/         # Minion mission files
│   ├── rules/               # Orchestrator signals
│   ├── templates/           # Spec templates
│   ├── assignments.json     # Track active missions
│   └── README.md            # Minion guide
├── gui/                     # GUI Orchestrator source (optional)
└── .cursor/rules/
    └── agent-rules.mdc      # Cursor IDE rules for minions
```

## Installation & Removal

### Install
```bash
./install.sh /path/to/your/project
```

### Uninstall
```bash
./uninstall.sh /path/to/your/project
```

## Creating Minion Missions

1. Copy the template:
   ```bash
   cp minions/templates/FEATURE_SPEC.md minions/assignments/agent-1-my-feature.md
   ```

2. Fill in the feature requirements

3. Create the worktree:
   ```bash
   ./minions/bin/setup.sh agent-1 feature/agent-1/my-feature
   ```

4. Point your AI minion at the mission file

## Configuration

Edit `minions/bin/config.sh` to customize:
- Project name (used for worktree folder names)
- Base branch (defaults to main)
- Files to copy to worktrees (env files, secrets, etc.)

## Supported AI Tools

| Tool | Command |
|------|---------|
| Cursor IDE | Open worktree folder, start background minion |
| Cursor CLI | `cursor --folder ../yourproject-agent-1` |
| Claude Code | `claude "Read mission and implement"` |
| Aider | `aider` |
| Any AI tool | Just point it at the worktree |

## GUI Orchestrator (Optional)

A desktop app for managing minions with a visual interface:

```bash
# Launch from the framework root
./minions/bin/dashboard.sh
```

Features:
- Dashboard view of all missions
- Live terminal integration for minions
- iMessage-style sidebar with notifications
- Signal detection for minion status updates

See [`gui/README.md`](gui/README.md) for details.

## How It Works

The framework uses **git worktrees** to give each minion an isolated copy of your codebase:

- Each minion works in its own folder (`../yourproject-agent-1`, etc.)
- Minions share git history but have independent working directories
- No conflicts between minions working on different features
- Easy cleanup when done

## Best Practices

### For Humans Coordinating Minions

1. **Assign non-overlapping work** - Each minion should touch different files
2. **Keep missions small** - Features completable in 1-2 hours work best
3. **Review frequently** - Check minion progress and course-correct early
4. **Merge often** - Don't let branches diverge too far

### For AI Minions

1. **Read your mission first** - The spec file has requirements and boundaries
2. **Stay in your lane** - Only modify files in your allowlist
3. **Test before committing** - Run tests before every commit
4. **Commit frequently** - Small, focused commits are easier to review

## License

MIT - Use this however you want.
