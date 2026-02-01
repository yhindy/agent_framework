# Minion Framework 🍌

[![CI](https://github.com/yhindy/agent_framework/workflows/CI/badge.svg)](https://github.com/yhindy/agent_framework/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yhindy/agent_framework/branch/main/graph/badge.svg)](https://codecov.io/gh/yhindy/agent_framework)

A lightweight framework for running multiple AI coding minions in parallel on any codebase.

---

## 👋 New Here?

**First time using Agent Framework?** Start here:

1. **Setup** (one-time): `./setup.sh`
2. **Launch GUI**: `./run.sh`
3. **Read the guide**: [GETTING_STARTED.md](GETTING_STARTED.md) 📖

The getting started guide walks you through everything step-by-step!

**Having issues?** Check the [Troubleshooting Guide](TROUBLESHOOTING.md) for common problems and solutions.

---

## Quick Reference

For experienced users - quick commands to get started:

### Using the GUI (Recommended)
```bash
./run.sh  # Launch the desktop app
# Then: Select a project → Add agents → Assign missions
```

### Using the CLI
```bash
# Install framework into your project
./install.sh /path/to/your/project

# Create an agent
cd /path/to/your/project
./minions/bin/setup.sh agent-1 feature/agent-1/my-feature

# Clean up when done
./minions/bin/teardown.sh agent-1
```

## What Gets Installed

When you install the framework into a project, it creates:

```
your-project/
├── minions/                  # Framework folder
│   ├── bin/                 # Management scripts
│   │   ├── setup.sh         # Create minion worktree
│   │   ├── teardown.sh      # Remove minion worktree
│   │   ├── list.sh          # List all minion worktrees
│   │   └── ...
│   ├── rules/               # Agent behavior rules
│   ├── templates/           # Spec templates
│   └── config.json          # Project configuration
└── .agent-info              # Runtime state (gitignored)
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

## Creating Minions

**GUI Method (Recommended):**
1. Click "+" next to your project in the sidebar
2. Fill in branch name, task description, tool, and model
3. Click "Create Mission"

**CLI Method:**
```bash
# Create agent worktree manually
./minions/bin/setup.sh agent-1 feature/agent-1/my-feature

# Then start your AI tool in the worktree
cd ../yourproject-agent-1
claude "Implement the user authentication feature"
```

## Configuration

Edit `minions/config.json` in your project to customize:
- Project name (used for worktree folder names)
- Base branch (defaults to main)
- Files to copy to worktrees (env files, secrets, etc.)

## Supported AI Tools

| Tool | Command |
|------|---------|
| Claude Code | `claude "Read mission and implement"` |
| Cursor CLI | `cursor --folder ../yourproject-agent-1` |
| Cursor IDE | Open worktree folder, start background minion |
| Codex CLI | `codex "Read mission and implement"` |
| Any AI tool | Just point it at the worktree |

## GUI Desktop App

The framework includes a desktop app for managing minions visually:

```bash
# Launch from the framework root
./run.sh

# Or for development
npm run gui:dev
```

### Features
- **Global Project Manager**: Manage multiple projects from one window
- **Auto-Install**: Initialize the framework in new projects via the GUI
- **Dashboard**: View all missions and agents
- **Live Terminal Integration**: Interactive terminal sessions for agents
- **Signal Detection**: Agents send signals (PLAN_READY, DEV_COMPLETED, etc.) to update the UI
- **Status Tracking**: Real-time agent status and notifications
- **Multi-tool Support**: Works with Claude, Cursor IDE, Cursor CLI, and Codex

### GUI Project Structure

```
gui/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Main entry point, IPC handlers
│   │   └── services/      # Backend services
│   ├── preload/           # Preload scripts (IPC bridge)
│   │   └── index.ts
│   └── renderer/          # React frontend
│       └── src/
│           ├── App.tsx
│           ├── contexts/  # React contexts (state management)
│           ├── hooks/     # Custom hooks
│           └── components/ # React components
├── e2e/                   # E2E tests (Playwright)
├── vitest.config.ts       # Unit test configuration
├── playwright.config.ts   # E2E test configuration
└── package.json
```

### Keyboard Shortcuts

- **Cmd/Ctrl + N**: New Minion
- **Cmd/Ctrl + Shift + N**: New Super Minion
- **Cmd/Ctrl + O**: Open Project
- **Cmd/Ctrl + T**: Teleport from Cloud
- **Cmd/Ctrl + Up**: Previous Minion
- **Cmd/Ctrl + Down**: Next Minion
- **Cmd/Ctrl + /**: Show Shortcuts Help
- **Escape**: Close Dialog

### App Data Location

The GUI stores its state in:
- **macOS**: `~/Library/Application Support/agent-orchestrator/`
- **Windows**: `%APPDATA%/agent-orchestrator/`
- **Linux**: `~/.config/agent-orchestrator/`

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
