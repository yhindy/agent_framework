# Minion Orchestrator GUI 🍌

A desktop application for managing and orchestrating AI coding minions in your project.

## Features

- **Project Management**: Select and manage multiple projects with minion frameworks
- **Missions Dashboard**: Visual kanban-style view of all minion missions
- **Live Terminal Integration**: Interactive terminal sessions for Claude and Cursor CLI minions
- **Signal Detection**: Minions can send special signals (PLAN_READY, DEV_COMPLETED, etc.) to update the UI
- **iMessage-style Sidebar**: Quick navigation between minions with unread indicators
- **Multi-tool Support**: Works with Claude, Cursor IDE, and Cursor CLI

## Prerequisites

- Node.js 20.x or later
- npm or yarn

## Installation

```bash
cd gui
npm install
```

## Development

Run the app in development mode:

```bash
npm run dev
```

This will start the Electron app with hot-reloading enabled.

## Building

Build the app for production:

```bash
npm run build
```

## Project Structure

```
gui/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Main entry point, IPC handlers
│   │   └── services/      # Backend services (16 total)
│   │       ├── AgentService.ts
│   │       ├── TerminalService.ts
│   │       ├── ProjectService.ts
│   │       ├── ClaudeSessionInfoService.ts
│   │       ├── MinionsConfigService.ts
│   │       ├── SetupWizardService.ts
│   │       ├── NotificationService.ts
│   │       ├── PRPollingService.ts
│   │       └── ...
│   ├── preload/           # Preload scripts (IPC bridge)
│   │   └── index.ts
│   └── renderer/          # React frontend
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── store/     # Zustand state management
│           └── components/ # React components (23+)
├── e2e/                   # E2E tests (Playwright)
├── vitest.config.ts       # Unit test configuration
├── playwright.config.ts   # E2E test configuration
├── electron.vite.config.ts
├── package.json
└── README.md
```

## Usage

### 1. Select a Project

When you first open the app, you'll be prompted to select a project folder. The project must be a git repository. The framework supports two formats:

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

This will also run `setup.sh` to create the agent worktree.

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

## Troubleshooting

### "Cannot find module pty.node" error

This means native modules need to be rebuilt for Electron:

```bash
cd gui
npm install --save-dev @electron/rebuild
npx @electron/rebuild
npm run dev
```

### "require() of ES Module" error

If you see ESM import errors, make sure you have the CommonJS-compatible dependencies:
- `strip-ansi` should be v6.x (not v7+)

### Terminal not showing output

Make sure:
1. The agent worktree exists
2. The tool (claude/cursor) is installed and in PATH
3. Check the main process logs in the Electron developer console

### Agents not loading

1. For new format: Verify `minions.json` exists at project root
2. For legacy format: Verify `minions/config.json` exists
3. Check the JSON is valid
4. Try reloading the project

### Agent worktree not found

Run the setup script manually:
```bash
./minions/bin/setup.sh agent-1 feature/agent-1/my-feature
```

### Clean reinstall

If all else fails:
```bash
cd gui
rm -rf node_modules package-lock.json
npm install
npx @electron/rebuild
npm run dev
```

## License

MIT

