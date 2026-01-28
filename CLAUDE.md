# CLAUDE.md - AI Assistant Guide for Agent Framework

Essential context for AI assistants working with the Agent Framework codebase.

## Instructions for AI Assistants

### Git & Version Control
- **Never commit or push without explicit user approval.** Always ask before running `git commit` or `git push`.
- When proposing commits, show what files will be committed and the proposed commit message.
- Use conventional commit messages: `[type] description` (e.g., `[feat]`, `[fix]`, `[docs]`, `[test]`, `[refactor]`)
- Keep commits focused and atomic - one logical change per commit.

### Testing Requirements
- **Always write tests for new functionality.** No feature is complete without tests.
- **Run smart tests before commits**: `npm run test:changed` (fast, memory-efficient)
- **Choose the right test type:**
  - **Unit tests** (`gui/src/main/services/__tests__/`): Service logic, utilities, data transformations
  - **E2E tests** (`gui/e2e/`): UI components, IPC handlers, user workflows
- **When to write E2E tests:**
  - Adding or modifying IPC handlers in `gui/src/main/index.ts`
  - Adding UI components or changing user workflows
  - Adding `data-testid` attributes (see `gui/e2e/README.md`)
- Test quality goals: Isolated, Deterministic, Fast, Readable

### Code Quality
- Run type checking: `npm run typecheck -w gui`
- Follow existing patterns - consistency over preference
- Use TypeScript types throughout (strict mode)
- Prefer editing existing files over creating new ones

### Error Handling Pattern
When cleaning up PTY/terminal resources:
- Wrap cleanup in try-catch (processes may already be dead)
- Check `mainWindow.isDestroyed()` before IPC sends
- Continue cleanup even if individual operations fail
- See `TerminalService.ts` for examples: `stopAgent()`, `cleanup()`, `stopPlainTerminal()`

---

## Project Overview

**Minion Framework** is a system for running multiple AI coding agents in parallel on any codebase using git worktree isolation.

### Core Features
- **GUI**: Electron desktop app for managing agents visually
- **Multi-tool support**: Claude Code, Cursor CLI, Codex CLI
- **Git worktree isolation**: Parallel work without conflicts
- **Handoff Protocol**: Agents can hand off work to orchestrator or other agents

## Tech Stack

| Component | Technology |
|-----------|------------|
| GUI Framework | Electron 28.x with electron-vite |
| Frontend | React 18 + Zustand |
| Terminal | node-pty + xterm.js |
| Testing | Vitest (unit), Playwright (E2E) |
| Language | TypeScript (strict mode) |

### Runtime Requirements
- Node.js 20.x, npm, Git
- At least one: Claude Code (`claude`), Cursor CLI (`cursor-cli`), or Codex CLI (`codex`)

### Agent Tool Setup

| Tool | Install | Command | Notes |
|------|---------|---------|-------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude` | Model selection available |
| Cursor CLI | `npm install -g cursor-cli` | `cursor-cli "<prompt>"` | Model selection available |
| Codex CLI | `npm install -g @openai/codex` | `codex --model gpt-5.2-codex "<prompt>"` | Model hardcoded, requires `OPENAI_API_KEY` |

## Directory Structure

### Framework Repository
```
agent_framework/
├── gui/                         # Electron GUI application
│   ├── src/
│   │   ├── main/               # Main process (Node.js/Electron)
│   │   │   ├── index.ts        # Entry point, IPC handlers
│   │   │   └── services/       # Core services
│   │   ├── preload/            # IPC bridge
│   │   └── renderer/           # React frontend
│   │       └── src/
│   │           ├── components/ # React components
│   │           ├── contexts/   # React contexts
│   │           ├── hooks/      # Custom hooks
│   │           └── types/      # TypeScript types
│   ├── e2e/                    # E2E tests (Playwright)
│   └── resources/minions/      # Bundled shell scripts
├── minions/                    # CLI framework source
│   ├── bin/                    # Shell scripts (setup.sh, teardown.sh)
│   └── rules/                  # Agent behavior rules
├── install.sh                  # Install framework into a project
└── uninstall.sh                # Remove framework
```

### User Project Structure
```
your-project/
├── minions.json              # Config file (version controlled)
├── .minions/                 # Runtime state (gitignored)
│   ├── agents/               # Per-agent state files
│   │   └── {agent-id}.json   # Individual agent state
│   └── archive/              # Archived agent metadata
└── CLAUDE.md                 # Optional project-specific instructions
```

## Development Commands

```bash
# Install and run
npm install
npm run gui:dev

# Testing (prefer test:changed for efficiency)
npm run test:changed          # Run only affected tests
npm test                      # Run all tests
npm run test:e2e              # E2E tests
npm run test:e2e:headed       # E2E with visible browser

# Run specific test file
cd gui && npm test -- src/main/services/__tests__/AgentService.test.ts

# Building
npm run gui:build             # Production build
npm run typecheck -w gui      # Type check
cd gui && npm run rebuild     # Rebuild native modules (node-pty)
```

## Architecture

### Main Process Services

| Service | Purpose |
|---------|---------|
| `AgentService` | Agent lifecycle, worktrees, PRs, archiving, handoff |
| `TerminalService` | PTY management, tmux integration |
| `ProjectService` | Multi-project workspace management |
| `ClaudeSessionInfoService` | Parse Claude JSONL for state |
| `ClaudeConfigService` | Import Claude Code settings and plugins |
| `MinionsConfigService` | Read/write minions.json config |
| `SetupWizardService` | One-click project setup |
| `HandoffApiService` | HTTP API for agent handoff (port 19234) |
| `TeleportService` | Teleport session parsing |
| `TeleportMetadataService` | Teleport metadata management |
| `WorkflowService` | Workflow configuration |
| `SkillsLibraryService` | Scan commands/agents directories |
| `UnifiedSkillsService` | Combine all skill sources |
| `NotificationService` | System notifications |
| `PRPollingService` | GitHub PR status polling |
| `SettingsService` | App settings persistence |
| `TestEnvService` | Test environment terminals |
| `FileWatcherService` | File change monitoring |

### IPC Communication
- Handler names use colon-separated namespaces: `project:select`, `agents:list`
- Use `ipcMain.handle` for async request/response
- All APIs defined in `preload/index.ts` and typed in `preload/index.d.ts`

### Agent Lifecycle
1. **Create Assignment** - User provides prompt, tool, model
2. **Setup Worktree** - `setup.sh` creates git worktree
3. **Start Agent** - TerminalService spawns PTY with tool
4. **Monitor** - JSONL parsing for state (Claude), pattern matching (others)
5. **Teardown** - Clean up worktree when done

### Terminal Modes

| Mode | Description |
|------|-------------|
| `tmux` (default) | Agent runs in tmux session, auto-fallback if unavailable |
| `tabs` (legacy) | Each terminal is a separate PTY |

## Common Tasks

### Adding a New IPC Handler
1. Add handler in `gui/src/main/index.ts`:
   ```typescript
   ipcMain.handle('namespace:action', async (_, arg) => {
     return await services.someService.doSomething(arg);
   });
   ```
2. Add API method in `gui/src/preload/index.ts`:
   ```typescript
   namespaceAction: (arg: ArgType) => ipcRenderer.invoke('namespace:action', arg),
   ```
3. Update type in `gui/src/preload/index.d.ts`
4. Use via `window.electronAPI.namespaceAction()`

### Adding a New Service
1. Create `gui/src/main/services/NewService.ts`
2. Add to services object in `gui/src/main/index.ts`
3. Create tests in `gui/src/main/services/__tests__/NewService.test.ts`
4. Mock external dependencies (child_process, fs, Electron APIs)

### Writing E2E Tests
- See `gui/e2e/README.md` for comprehensive patterns
- Use `data-testid` attributes for reliable selectors
- Tests are in `gui/e2e/*.spec.ts`
- Use helper functions from `gui/e2e/helpers.ts`

## Key Files

| File | Purpose |
|------|---------|
| `gui/src/main/index.ts` | Entry point, IPC handlers |
| `gui/src/main/services/AgentService.ts` | Agent CRUD, worktrees, PRs |
| `gui/src/main/services/TerminalService.ts` | PTY management, tmux |
| `gui/src/main/services/HandoffApiService.ts` | HTTP API for handoff |
| `gui/src/preload/index.ts` | IPC bridge definitions |
| `gui/src/preload/index.d.ts` | IPC type definitions |
| `gui/src/shared/types/settings.ts` | Settings types (EditorType, etc.) |
| `gui/src/renderer/src/components/Dashboard.tsx` | Main UI component |
| `gui/src/renderer/src/store/` | Zustand state stores |
| `minions/bin/setup.sh` | Worktree creation |
| `minions/bin/teardown.sh` | Worktree cleanup |

## Troubleshooting

### Native Module Issues (node-pty)
```bash
cd gui && npm run rebuild
```

### Tests Fail in CI but Pass Locally
- Check Node.js version (must be 20.x)
- Verify native modules rebuilt for CI platform

### Claude Session Not Detected
- Check JSONL file exists in `~/.claude/projects/`
- Verify session ID matches in agent info

### E2E Test Issues
- Ensure app is built first: `npm run build -w gui`
- Check for stuck Electron processes
- Run with `--headed` flag for debugging

## CI/CD

GitHub Actions workflow runs:
1. **detect-changes**: Determine what to test based on changed files
2. **lint**: TypeScript type checking
3. **test-gui**: Unit tests (macOS for node-pty)
4. **test-minions**: Minions package tests
5. **build-gui**: Production build smoke test
6. **test-e2e**: E2E tests (when GUI changes)

CI uses intelligent test selection - only runs tests affected by changes.

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/<name>` or `claude/<session-id>`
- All tests must pass before merging
- Use `npm run test:changed` locally before pushing
