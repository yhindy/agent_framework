# CLAUDE.md - Agent Framework Guidelines

This document provides AI assistants with comprehensive guidance for working on this codebase.

## Project Overview

The **Minion Framework** is a lightweight system for running multiple AI coding agents (minions) in parallel on any codebase. It uses git worktrees to give each agent an isolated copy of the codebase, preventing conflicts between parallel workers.

**Key Components:**
- **GUI (Agent Orchestrator)**: Electron desktop app for managing agents visually
- **Minions CLI**: Shell scripts for worktree management and agent setup
- **Signal Protocol**: Communication system between agents and the orchestrator

## Repository Structure

```
agent_framework/
├── gui/                         # Electron GUI application
│   ├── src/
│   │   ├── main/               # Main process (Node.js/Electron)
│   │   │   ├── index.ts        # Entry point, IPC handlers
│   │   │   └── services/       # Core services
│   │   │       ├── AgentService.ts           # Agent lifecycle management
│   │   │       ├── TerminalService.ts        # PTY terminal management
│   │   │       ├── ProjectService.ts         # Project/workspace management
│   │   │       ├── ClaudeSessionInfoService.ts  # Claude session parsing
│   │   │       ├── PRPollingService.ts       # GitHub PR status polling
│   │   │       ├── NotificationService.ts    # System notifications
│   │   │       ├── FileWatcherService.ts     # File change detection
│   │   │       └── TestEnvService.ts         # Test environment management
│   │   ├── preload/            # Electron preload scripts (IPC bridge)
│   │   └── renderer/           # React frontend
│   │       └── src/
│   │           ├── components/ # React components (Dashboard, AgentView, etc.)
│   │           ├── contexts/   # React contexts
│   │           ├── hooks/      # Custom React hooks
│   │           └── types/      # TypeScript type definitions
│   ├── resources/              # App resources (icons, bundled scripts)
│   │   └── minions/           # Bundled minion scripts for distribution
│   ├── vitest.config.ts       # Main process test config
│   └── vitest.config.renderer.ts  # Renderer test config
├── minions/                    # CLI framework (installed into target projects)
│   ├── bin/                   # Shell scripts
│   │   ├── setup.sh           # Create agent worktree
│   │   ├── teardown.sh        # Remove agent worktree
│   │   ├── list.sh            # List worktrees
│   │   ├── dashboard.sh       # Launch GUI
│   │   ├── init.sh            # One-time setup
│   │   └── preflight.sh       # Verify environment
│   ├── rules/                 # Agent behavior rules
│   │   ├── orchestrator_signals.md  # Signal protocol documentation
│   │   └── super-minion-rules.md    # Super minion orchestration rules
│   └── templates/             # Assignment templates
├── .cursor/rules/             # Cursor IDE rules for agents
│   └── agent-rules.mdc        # Agent development guidelines
├── .github/
│   ├── workflows/ci.yml       # GitHub Actions CI
│   └── scripts/analyze-changes.js  # Intelligent test selection
├── install.sh                 # Install framework into a project
└── uninstall.sh               # Remove framework from a project
```

## Development Commands

### Root Level (npm workspaces)
```bash
npm install                  # Install all dependencies
npm test                     # Run all tests (gui + minions)
npm run gui:dev              # Start GUI in development mode
npm run gui:build            # Build GUI for production
npm run gui:test             # Run GUI tests only
npm run minions:test         # Run minions tests only
```

### GUI Package (`cd gui`)
```bash
npm run dev                  # Start Electron in dev mode (hot reload)
npm run build                # Build for production
npm run preview              # Preview production build
npm run typecheck            # TypeScript type checking
npm run rebuild              # Rebuild native modules (node-pty)
npm test                     # Run tests with Vitest
npm test -- --coverage       # Run tests with coverage
```

### Test Commands
```bash
# Run specific test file
npm test -- src/main/services/__tests__/AgentService.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run only changed tests (intelligent selection)
npm test -- --changed
```

## Architecture Overview

### Electron Architecture (gui/)

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Node.js)                   │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │AgentService │  │TerminalSvc │  │ClaudeSessionInfoSvc │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ProjectService│ │PRPollingSvc │  │NotificationService  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                             │
│                    ▲ IPC (ipcMain.handle) ▲                 │
└─────────────────────────────────────────────────────────────┘
                              │
                     ipcRenderer.invoke
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Preload Script                            │
│              (contextBridge.exposeInMainWorld)              │
│                   window.electronAPI                         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Renderer Process (React)                   │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Dashboard  │  │  AgentView  │  │   PlanApproval      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                             │
│  Uses: React, Zustand (state), xterm.js (terminals)        │
└─────────────────────────────────────────────────────────────┘
```

### Key Services

| Service | Purpose |
|---------|---------|
| `AgentService` | CRUD for agents, worktree creation, PR management |
| `TerminalService` | PTY management, Claude session lifecycle |
| `ProjectService` | Multi-project workspace management |
| `ClaudeSessionInfoService` | Parse Claude JSONL session files |
| `PRPollingService` | Poll GitHub for PR status updates |
| `NotificationService` | System notifications (macOS/Windows) |

### Agent Lifecycle

1. **Create Assignment** - User creates via GUI with prompt, tool, model
2. **Setup Worktree** - `setup.sh` creates git worktree for isolation
3. **Start Agent** - TerminalService spawns PTY with Claude/Cursor
4. **Monitor** - ClaudeSessionInfoService watches JSONL for state changes
5. **Signals** - Agent outputs `===SIGNAL:XXX===` for orchestrator events
6. **Teardown** - Clean up worktree when done

## Code Conventions

### TypeScript
- Use strict TypeScript (`"strict": true` in tsconfig)
- Prefer `interface` over `type` for object shapes
- Export types alongside implementations
- Use explicit return types for public functions

### File Organization
- One service class per file in `services/`
- Tests in `__tests__/` subdirectories
- Test fixtures in `__tests__/fixtures/`

### Naming Conventions
- Services: `PascalCase` + `Service` suffix (e.g., `AgentService`)
- Components: `PascalCase` (e.g., `AgentView.tsx`)
- Hooks: `camelCase` with `use` prefix (e.g., `useAgentState`)
- Test files: `*.test.ts` or `*.spec.ts`

### IPC Communication
- Handler names use colon-separated namespaces: `project:select`, `agents:list`
- Use `ipcMain.handle` for async request/response
- Use `ipcMain.on`/`send` for fire-and-forget events
- All IPC APIs defined in `preload/index.ts`

### Error Handling
- Wrap IPC handlers in try/catch
- Log errors with `console.error` including context
- Return meaningful error messages to renderer

## Testing Guidelines

### Test Structure
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('ServiceName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('methodName', () => {
    it('should do expected behavior', () => {
      // Arrange
      // Act
      // Assert
    })
  })
})
```

### Mocking
- Use `vi.mock()` for module mocking
- Use `vi.spyOn()` for method spying
- Mock `child_process`, `fs`, and Electron modules in tests

### Coverage Thresholds
- GUI Main Process: 60% (lines, functions, branches, statements)
- GUI Renderer: 50%
- Minions: 70% lines/functions, 60% branches

### Test Categories
- Unit tests: `*.test.ts` (fast, isolated)
- Integration tests: `*.integration.test.ts` (slower, more realistic)

## Git Workflow

### Branching Strategy
```
main (protected)
  └── feature branches
        ├── feature/agent-1/user-profile
        ├── feature/agent-2/search-api
        └── claude/... (AI agent branches)
```

### Commit Message Format
```
[area] brief description

- Detail 1
- Detail 2
```

**Areas:** `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `chore`

### Example Commits
```
[feat] add user profile page

- Create ProfileCard component
- Add profile route
- Connect to user API

[fix] resolve login redirect issue

- Fix redirect URL encoding
- Add error handling for invalid tokens
```

### Rules
- One feature/fix per commit
- All tests must pass before committing
- Never commit: secrets, node_modules, build outputs, IDE files

## CI/CD Pipeline

The CI workflow (`.github/workflows/ci.yml`) runs on PRs and pushes to main.

### Jobs
1. **detect-changes**: Analyze changed files for intelligent test selection
2. **lint**: TypeScript type checking
3. **test-gui**: Run GUI tests (macOS runner for node-pty)
4. **test-minions**: Run minions package tests
5. **build-gui**: Smoke test the production build

### Intelligent Test Selection
- Changes to CI config → full test run
- Changes to `gui/**` → run GUI tests
- Changes to `minions/**` → run minions tests
- Feature branch commits are 50-70% faster

## Signal Protocol

Agents communicate with the orchestrator via stdout signals:

```bash
===SIGNAL:PLAN_READY===     # Plan needs human review
===SIGNAL:DEV_COMPLETED===  # Implementation complete
===SIGNAL:BLOCKER===        # Blocked, needs intervention
===SIGNAL:QUESTION===       # Has a question (non-blocking)
===SIGNAL:WORKING===        # Actively working
===SIGNAL:PLANS_READY===    # Super minion has plans for approval
```

**Rules:**
- Signals must be on their own line
- Output context before the signal
- One signal per milestone

## Super Minion Protocol

Super minions orchestrate child agents by:

1. Writing `.pending-plans.json` with task breakdowns
2. Outputting `===SIGNAL:PLANS_READY===`
3. Monitoring `.children-status.json` for child progress
4. NOT using the Task tool (bypasses orchestration)

## Key Configuration Files

| File | Purpose |
|------|---------|
| `minions/config.json` | Project-specific agent config (installed per-project) |
| `.agent-info` | Agent metadata (created per worktree) |
| `.claude/settings.local.json` | Claude Code permissions |
| `electron-builder.json` | Electron build config |
| `electron.vite.config.ts` | Vite config for Electron |

## Common Tasks

### Adding a New IPC Handler
1. Add handler in `gui/src/main/index.ts` (setupIPC function)
2. Add API method in `gui/src/preload/index.ts`
3. Update type in `gui/src/preload/index.d.ts`
4. Use in renderer via `window.electronAPI.methodName()`

### Adding a New Service
1. Create `gui/src/main/services/NewService.ts`
2. Add to services object in `gui/src/main/index.ts`
3. Create tests in `gui/src/main/services/__tests__/NewService.test.ts`

### Adding a New React Component
1. Create `gui/src/renderer/src/components/ComponentName.tsx`
2. Create styles in `ComponentName.css`
3. Export from component or use directly

## Dependencies

### GUI Key Dependencies
- **electron**: Desktop app framework
- **electron-vite**: Build tooling for Electron
- **react**: UI framework
- **zustand**: State management
- **node-pty**: Terminal emulation
- **chokidar**: File watching
- **xterm**: Terminal rendering
- **vitest**: Testing framework

### Shell Dependencies (minions scripts)
- `bash`: Shell execution
- `git`: Worktree management
- `python3`: JSON parsing in shell scripts
- `gh`: GitHub CLI for PR operations

## Troubleshooting

### Native Module Issues (node-pty)
```bash
cd gui && npm run rebuild
```

### Tests Fail in CI but Pass Locally
- Check Node.js version (must be 20.x)
- Verify native modules rebuilt for CI platform
- Check for platform-specific path issues

### Claude Session Not Detected
- Check JSONL file exists in `~/.claude/projects/`
- Verify session ID matches in `.agent-info`
- Check ClaudeSessionInfoService logs

## Links

- [GUI README](gui/README.md) - Detailed GUI documentation
- [Minions README](minions/README.md) - CLI usage guide
- [CI Documentation](.github/CI_README.md) - CI pipeline details
- [Testing Guide](gui/TESTING.md) - Comprehensive testing docs
