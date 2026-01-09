# CLAUDE.md - AI Assistant Guide for Agent Framework

This document provides essential context for AI assistants working with the Agent Framework codebase.

## Instructions for AI Assistants

### Git & Version Control
- **Never commit or push without explicit user approval.** Always ask before running `git commit` or `git push`.
- When proposing commits, show the user what files will be committed and the proposed commit message.
- Use conventional commit messages: `[type] description` (e.g., `[feat]`, `[fix]`, `[docs]`, `[test]`, `[refactor]`).
- Keep commits focused and atomic - one logical change per commit.

### Testing Requirements
- **Always write tests for new functionality.** No feature is complete without tests.
- **Run tests before proposing commits** to ensure nothing is broken: `npm test` or target specific tests.
- Follow existing test patterns in `gui/src/main/services/__tests__/` - use the established fixtures.
- For new services:
  - Add unit tests for new functions/methods
  - Mock external dependencies (child_process, fs, Electron APIs)
- Aim for tests that are:
  - **Isolated**: Don't depend on external state or other tests
  - **Deterministic**: Same input always produces same output
  - **Fast**: Mock slow operations (network, file system where appropriate)
  - **Readable**: Clear test names that describe the expected behavior

### Documentation Maintenance
- **Update this CLAUDE.md file** when making significant changes to:
  - Architecture or system design
  - New services or major components
  - Development workflows or commands
  - Environment variables or configuration
  - Directory structure
- Keep the Key Files Reference table current when adding important new files.
- Document non-obvious decisions in code comments or relevant docs.

### Code Quality Standards
- Run type checking before committing: `npm run typecheck -w gui`
- Follow existing patterns in the codebase - consistency over personal preference.
- Don't introduce new dependencies without discussing with the user first.
- Prefer editing existing files over creating new ones when reasonable.
- Keep functions focused and reasonably sized.
- Use TypeScript types throughout - this is a strictly typed codebase.

### Communication
- Explain your reasoning for significant decisions.
- When you encounter ambiguity, ask clarifying questions rather than assuming.
- If you notice potential issues or improvements outside the current task scope, mention them but don't act without approval.
- Summarize what you've done after completing a task.

### Error Handling
- When tests fail, investigate and fix the root cause - don't just skip or delete tests.
- If you break something, acknowledge it and fix it before moving on.
- When encountering unexpected behavior, investigate before making changes.

---

## Project Overview

**Minion Framework** is a lightweight system for running multiple AI coding agents (minions) in parallel on any codebase. Users can text articles, links, reminders, and other content to save for later.

### Core Features
- GUI (Agent Orchestrator): Electron desktop app for managing agents visually
- Minions CLI: Shell scripts for worktree management and agent setup
- Signal Protocol: Communication system between agents and the orchestrator
- Git worktree isolation for parallel agent work without conflicts

## Tech Stack

### GUI (Electron App)
- **Framework**: Electron 28.x with electron-vite
- **Frontend**: React 18 with Zustand state management
- **Terminal**: node-pty + xterm.js
- **Testing**: Vitest
- **Language**: TypeScript (strict mode)

### CLI (Minions)
- **Shell**: Bash scripts
- **Dependencies**: git, python3, gh (GitHub CLI)

### Runtime Requirements
- Node.js 20.x
- npm (workspaces)
- Git (for worktrees)
- Python 3 (for JSON parsing in shell scripts)

## Directory Structure

```
agent_framework/
├── gui/                         # Electron GUI application
│   ├── src/
│   │   ├── main/               # Main process (Node.js/Electron)
│   │   │   ├── index.ts        # Entry point, IPC handlers
│   │   │   └── services/       # Core services
│   │   ├── preload/            # Electron preload scripts (IPC bridge)
│   │   └── renderer/           # React frontend
│   │       └── src/
│   │           ├── components/ # React components
│   │           ├── contexts/   # React contexts
│   │           ├── hooks/      # Custom React hooks
│   │           └── types/      # TypeScript type definitions
│   ├── resources/              # App resources (icons, bundled scripts)
│   ├── vitest.config.ts        # Main process test config
│   └── vitest.config.renderer.ts  # Renderer test config
├── minions/                    # CLI framework (installed into target projects)
│   ├── bin/                    # Shell scripts (setup.sh, teardown.sh, etc.)
│   ├── rules/                  # Agent behavior rules
│   └── templates/              # Assignment templates
├── .cursor/rules/              # Cursor IDE rules for agents
├── .github/
│   ├── workflows/ci.yml        # GitHub Actions CI
│   └── scripts/                # CI helper scripts
├── install.sh                  # Install framework into a project
└── uninstall.sh                # Remove framework from a project
```

## Development Commands

### Running Locally
```bash
# Install dependencies (root)
npm install

# Start GUI in development mode
npm run gui:dev
```

### Testing
```bash
# Run all tests
npm test

# GUI tests only
npm run gui:test
cd gui && npm test

# Minions tests only
npm run minions:test

# Run specific test file
cd gui && npm test -- src/main/services/__tests__/AgentService.test.ts

# Run with coverage
cd gui && npm test -- --coverage
```

### Building
```bash
# Build GUI for production
npm run gui:build

# Type check
cd gui && npm run typecheck

# Rebuild native modules (node-pty)
cd gui && npm run rebuild
```

## Code Style

### TypeScript
- Strict mode enabled
- Prefer `interface` over `type` for object shapes
- Explicit return types for public functions
- Use `vi.mock()` and `vi.spyOn()` for test mocking

### File Organization
- Services: One class per file in `services/`
- Tests: `__tests__/` subdirectories with `*.test.ts` files
- Components: PascalCase naming (e.g., `AgentView.tsx`)

### IPC Communication
- Handler names: colon-separated namespaces (`project:select`, `agents:list`)
- Use `ipcMain.handle` for async request/response
- Use `ipcMain.on`/`send` for fire-and-forget events
- All APIs defined in `preload/index.ts`

## Testing Conventions

### Vitest (GUI)
- Test files: `src/main/services/__tests__/*.test.ts`
- Use `describe`/`it`/`expect` from vitest
- Mock external modules with `vi.mock()`
- Clear mocks in `beforeEach`

### Coverage Thresholds
- GUI Main Process: 60% (lines, functions, branches, statements)
- GUI Renderer: 50%
- Minions: 70% lines/functions, 60% branches

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

## Architecture Patterns

### Electron Process Model
```
Main Process (Node.js)
    ├── AgentService        # Agent lifecycle, worktrees, PRs
    ├── TerminalService     # PTY management, Claude sessions
    ├── ProjectService      # Multi-project workspace management
    ├── ClaudeSessionInfoService  # Parse Claude JSONL files
    ├── PRPollingService    # GitHub PR status polling
    └── NotificationService # System notifications
         │
         │ IPC (ipcMain.handle)
         ▼
Preload Script (contextBridge)
         │
         │ window.electronAPI
         ▼
Renderer Process (React)
    ├── Dashboard           # Main view
    ├── AgentView           # Agent details + terminal
    └── PlanApproval        # Super minion plan review
```

### Agent Lifecycle
1. **Create Assignment** - User creates via GUI with prompt, tool, model
2. **Setup Worktree** - `setup.sh` creates git worktree for isolation
3. **Start Agent** - TerminalService spawns PTY with Claude/Cursor
4. **Monitor** - ClaudeSessionInfoService watches JSONL for state changes
5. **Signals** - Agent outputs `===SIGNAL:XXX===` for orchestrator events
6. **Teardown** - Clean up worktree when done

### Signal Protocol
Agents communicate with the orchestrator via stdout signals:
```bash
===SIGNAL:PLAN_READY===     # Plan needs human review
===SIGNAL:DEV_COMPLETED===  # Implementation complete
===SIGNAL:BLOCKER===        # Blocked, needs intervention
===SIGNAL:QUESTION===       # Has a question (non-blocking)
===SIGNAL:WORKING===        # Actively working
===SIGNAL:PLANS_READY===    # Super minion has plans for approval
```

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **detect-changes**: Determines which packages changed
2. **lint**: TypeScript type checking
3. **test-gui**: Runs GUI tests (macOS runner for node-pty)
4. **test-minions**: Runs minions package tests
5. **build-gui**: Smoke test the production build

CI uses intelligent test selection - only runs tests related to changed files.

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

## Key Files Reference

| File | Purpose |
|------|---------|
| `gui/src/main/index.ts` | Electron entry point, IPC handlers |
| `gui/src/main/services/AgentService.ts` | Agent CRUD, worktrees, PRs |
| `gui/src/main/services/TerminalService.ts` | PTY management |
| `gui/src/preload/index.ts` | IPC bridge (all renderer APIs) |
| `gui/src/renderer/src/components/Dashboard.tsx` | Main UI component |
| `minions/bin/setup.sh` | Worktree creation script |
| `minions/rules/orchestrator_signals.md` | Signal protocol docs |

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

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/<name>` or `claude/<session-id>`
- All tests must pass before merging
- CI runs on all PRs to main
