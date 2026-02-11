# Minion Orchestrator GUI

See the main [README.md](../README.md) for full documentation, including GUI features, keyboard shortcuts, project structure, and troubleshooting.

## Development

```bash
cd gui
npm install
npm run dev
```

## Building

```bash
npm run build
```

## Testing

```bash
npm test                    # Unit tests
npm run test:e2e            # E2E tests
npm run test:e2e:headed     # E2E with visible browser
```

## Usage

### 1. Select a Project

When you first open the app, you'll be prompted to select a project folder. The project can be a git repository or any directory. Git projects get full feature support (worktree isolation, branches, PRs); non-git projects support agent creation and management without git operations. The framework supports two config formats:

**New Format (v2.0)**:
- `minions.json` at project root

**Legacy Format (v1)**:
- `minions/` directory structure

If neither exists, the setup wizard will help configure the project.

### 2. View Assignments

The home dashboard shows all your assignments organized by status:
- Pending
- In Progress
- Review
- Completed

### 3. Create an Assignment

Click "New Assignment" to:
1. Select an available agent ID
2. Enter a feature description (the branch name is auto-generated)
3. Choose tool (Claude, Cursor, Cursor CLI)
4. Click "Create"

The branch name is automatically generated from the agent ID and feature description (e.g., `feature/agent-1/user-authentication-system`).

For git projects, this also runs `setup.sh` to create the agent worktree. For non-git projects, the agent works directly in the project directory.

### 4. Work with Agents

Click an agent in the sidebar to:
- View the agent's terminal (for Claude/Cursor CLI)
- Start/Stop the agent
- Change mode (Planning/Dev)
- Open the worktree in Cursor

### 5. Agent Signals

When agents output special signals like:
```
===SIGNAL:PLAN_READY===
```

The UI will automatically:
- Show a notification banner
- Update the agent status
- Mark the agent as needing attention

## Migration

### Legacy to New Format

Projects using the legacy `minions/` folder structure can be migrated to the new `minions.json` format:

1. Open the project in the GUI
2. The GUI will detect the legacy format and offer migration
3. Click "Migrate" to update to the new format

The migration preserves all configuration and agent state.

## Configuration

The app stores its state in:
- **macOS**: `~/Library/Application Support/agent-orchestrator/`
- **Windows**: `%APPDATA%/agent-orchestrator/`
- **Linux**: `~/.config/agent-orchestrator/`

State includes:
- Recent projects
- Current project selection
- Agent session data

## Keyboard Shortcuts

- **Cmd/Ctrl + 1-5**: Switch between agents
- **Cmd/Ctrl + H**: Go to home dashboard

See [TESTING.md](TESTING.md) for comprehensive test scenarios.

## Troubleshooting

### "Cannot find module pty.node" error

Rebuild native modules for Electron:

```bash
npm run rebuild
npm run dev
```

### Clean reinstall

```bash
rm -rf node_modules package-lock.json
npm install
npm run rebuild
npm run dev
```

For more troubleshooting, see [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
