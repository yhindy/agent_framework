# Agent Orchestrator GUI

A desktop application for managing and orchestrating AI coding agents in your project.

## Features

- **Project Management**: Select and manage multiple projects with agent frameworks
- **Agent Dashboard**: Visual kanban-style view of all agent assignments
- **Live Terminal Integration**: Interactive terminal sessions for Claude and Cursor CLI agents
- **Signal Detection**: Agents can send special signals (PLAN_READY, DEV_COMPLETED, etc.) to update the UI
- **iMessage-style Sidebar**: Quick navigation between agents with unread indicators
- **Multi-tool Support**: Works with Claude, Cursor IDE, and Cursor CLI

## Prerequisites

- Node.js 18 or later
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
│   │   ├── index.ts       # Main entry point
│   │   └── services/      # Backend services
│   │       ├── ProjectService.ts
│   │       ├── AgentService.ts
│   │       ├── TerminalService.ts
│   │       └── FileWatcherService.ts
│   ├── preload/           # Preload scripts (IPC bridge)
│   │   └── index.ts
│   └── renderer/          # React frontend
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           └── components/
│               ├── ProjectPicker.tsx
│               ├── Sidebar.tsx
│               ├── Dashboard.tsx
│               ├── AgentView.tsx
│               └── Terminal.tsx
├── electron.vite.config.ts
├── package.json
└── README.md
```

## Usage

### 1. Select a Project

When you first open the app, you'll be prompted to select a project folder. The project must have:
- `docs/agents/` directory structure
- `assignments.json` file (or run migration script first)

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

If you have an existing `ASSIGNMENTS.md` file, migrate it to JSON:

```bash
node ../scripts/agents/migrate-assignments.js
```

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

### Assignments not loading

1. Verify `assignments.json` exists in `docs/agents/`
2. Check the JSON is valid
3. Try reloading the project

### Agent worktree not found

Run the setup script manually:
```bash
./scripts/agents/setup.sh agent-1 feature/agent-1/my-feature
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

