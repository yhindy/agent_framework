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
- **Run smart tests before proposing commits** - use selective testing to save time and memory: `npm run test:changed`
- **Choose the right test type:**
  - **Unit tests** (`gui/src/main/services/__tests__/`): For service logic, utility functions, data transformations
  - **E2E tests** (`gui/e2e/`): For UI components, IPC handlers, user workflows, and integration points
- **When to write E2E tests:**
  - Adding or modifying IPC handlers in `gui/src/main/index.ts`
  - Adding UI components or changing user workflows
  - Adding `data-testid` attributes to components (see `gui/e2e/README.md` for patterns)
  - Modifying settings, navigation, or agent lifecycle flows
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

#### PTY and Process Cleanup Safety Pattern
When cleaning up resources (especially in terminal services and app shutdown):
- **Wrap cleanup operations in try-catch blocks** to handle processes that are already dead
  - PTY kill operations may fail if the process has already exited
  - Interval/timer clearing can fail if already cleared
  - Tmux session killing may fail if the session doesn't exist
- **Check window state before IPC sends** during shutdown to prevent crashes
  - Use `mainWindow.isDestroyed()` before calling `webContents.send()`
  - Handle cases where the main window is being closed while cleanup is still happening
- **Continue cleanup even if individual operations fail** - aggregate errors after all operations complete
  - Log failures at appropriate levels (debug for expected failures, error for unexpected ones)
  - Delete resources from tracking maps even if cleanup partially fails
- **Apply this pattern in**: `stopAgent()`, `cleanup()`, `terminal.onExit()`, and app shutdown handlers
  - See `TerminalService` for examples: `stopAgent()` (line 1129), `cleanup()` (line 1203), `stopPlainTerminal()` (line 1372)

---

## Project Overview

**Minion Framework** is a lightweight system for running multiple AI coding agents (minions) in parallel on any codebase.

### Core Features
- GUI (Agent Orchestrator): Electron desktop app for managing agents visually
- Minions CLI: Shell scripts for worktree management and agent setup
- Signal Protocol: Communication system between agents and the orchestrator
- Git worktree isolation for parallel agent work without conflicts
- Multi-tool support: Claude Desktop, Cursor CLI, and Codex CLI

## Tech Stack

### GUI (Electron App)
- **Framework**: Electron 28.x with electron-vite
- **Frontend**: React 18 with Zustand state management
- **Terminal**: node-pty + xterm.js
- **Testing**: Vitest (unit), Playwright (E2E)
- **Language**: TypeScript (strict mode)

### CLI (Minions)
- **Shell**: Bash scripts
- **Dependencies**: git, python3, gh (GitHub CLI)
- **Agent Tools**: Claude Desktop, Cursor CLI (cursor-cli), or Codex CLI (codex)

### Runtime Requirements
- Node.js 20.x
- npm (workspaces)
- Git (for worktrees)
- Python 3 (for JSON parsing in shell scripts)
- At least one agent tool: Claude Desktop, Cursor CLI, or Codex CLI

### Agent Tool Setup

The framework supports three agent tools. At least one must be installed:

#### Claude Code (CLI)
- Install: `npm install -g @anthropic-ai/claude-code`
- Command: `claude` (spawns in terminal with prompt)
- No additional configuration required

#### Cursor CLI
- Install: `npm install -g cursor-cli`
- Command: `cursor-cli "<prompt>"`
- Status detection: Pattern matching in terminal output
- Model selection: Available in GUI

#### Codex CLI
- Install: `npm install -g @openai/codex`
- Command: `codex --model gpt-5.2-codex "<prompt>"`
- Model: **gpt-5.2-codex (hardcoded, no selection available)**
- API Key: Set `OPENAI_API_KEY` environment variable
- Status detection: Pattern matching in terminal output
- Note: `install.sh` warns if `codex` command is not found in PATH

**Environment Variables for Codex:**
```bash
export OPENAI_API_KEY="your-api-key-here"
```

Add to `~/.zshrc` or `~/.bashrc` to persist across sessions.

## Dependency Management

### Workspace Structure
This project uses npm workspaces with `gui` and `minions` as separate packages, but they're all part of one monorepo (not separate published packages).

### Dependency Placement Convention
Since this is a single project, we don't need strict workspace isolation. Follow these rules for where to place dependencies:

**Root `package.json` (Shared Tools)**:
- Place dependencies here when they're used by build/test tools that need to resolve from the root
- Examples: `electron`, `electron-vite`, `vitest`, `@vitest/coverage-v8`
- **Why**: Tools like `electron-vite` (installed at root) need to resolve `electron` via Node's module resolution

**Workspace `package.json` (Workspace-Specific)**:
- Runtime dependencies for that workspace only
- Examples in `gui/`: `node-pty`, `electron-store`, `react`, `zustand`
- Examples in `minions/`: workspace-specific test utilities

**Key Rule**: If a root-level build tool needs to `require()` or `import` a package, that package must be in root devDependencies. This prevents module resolution issues where npm hoists packages to different locations.

### When Adding Dependencies
1. **Build/test tools used across workspaces** → Root `package.json`
2. **Runtime dependencies for a specific workspace** → Workspace `package.json`
3. **When in doubt** → Add to root if it's used during build/test, add to workspace if it's runtime-only

## Directory Structure

### Framework Repository
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
│   │   └── minions/            # Bundled framework assets
│   │       ├── bin/            # Shell scripts (setup.sh, teardown.sh, etc.)
│   │       ├── rules/          # Agent behavior rules
│   │       └── templates/      # Mission templates
│   ├── vitest.config.ts        # Main process test config
│   ├── vitest.config.renderer.ts  # Renderer test config
│   ├── playwright.config.ts    # E2E test configuration
│   └── e2e/                    # E2E tests (Playwright + Electron)
├── minions/                    # CLI framework source (bundled into app)
│   ├── bin/                    # Shell scripts source
│   ├── rules/                  # Agent behavior rules source
│   └── templates/              # Assignment templates source
├── .cursor/rules/              # Cursor IDE rules for agents
├── .github/
│   ├── workflows/ci.yml        # GitHub Actions CI
│   └── scripts/                # CI helper scripts
├── install.sh                  # Install framework into a project
└── uninstall.sh                # Remove framework from a project
```

### User Project Structure (New Format)
Projects using the new One-Click Setup Wizard have a minimal footprint:

```
your-project/
├── minions.json              # Single config file (version controlled)
├── .minions/                 # Runtime state folder (gitignored)
│   ├── agents/               # Per-agent state files
│   │   └── {agent-id}.json   # Individual agent state
│   ├── base-agent.json       # Base branch agent state
│   └── cache/                # Cached data
└── CLAUDE.md                 # Optional, generated by wizard
```

### User Project Structure (Legacy Format)
Older projects may still have the legacy structure:

```
your-project/
├── minions/                  # Copied framework folder
│   ├── config.json           # Project configuration
│   ├── bin/                  # Shell scripts
│   ├── rules/                # Agent behavior rules
│   └── templates/            # Mission templates
├── .agent-info               # Runtime state (gitignored)
└── .minions-base-info        # Base agent state (gitignored)
```

**Note:** The framework supports both formats. Legacy projects can be migrated to the new format via the GUI.

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
# RECOMMENDED: Run only tests affected by your changes (fast, memory-efficient)
npm run test:changed

# Run all tests (slower, more memory - only when needed)
npm test

# GUI tests only (smart selection)
npm run gui:test:changed
cd gui && npm run test:changed

# Minions tests only (smart selection)
cd minions && npm run test:changed

# Run specific test file (when debugging)
cd gui && npm test -- src/main/services/__tests__/AgentService.test.ts

# Run tests related to files you just edited
cd gui && npm run test:related src/main/services/AgentService.ts

# Run with coverage (CI only, memory-intensive)
cd gui && npm test -- --coverage
```

### E2E Testing (Electron App)

E2E tests use Playwright to launch and test the actual Electron application. These tests are designed to be run by AI agents to verify full application functionality.

For detailed documentation, see `gui/e2e/README.md`.

```bash
# Run all E2E tests
npm run test:e2e

# Run with visible browser (debugging)
npm run test:e2e:headed

# Run specific test suites
npm run test:e2e:smoke    # Quick smoke tests
npm run test:e2e:flow     # User flow tests
npm run test:e2e:settings # Settings page tests
npm run test:e2e:errors   # Error handling tests

# Run specific tests by name
cd gui && npm run test:e2e -- --grep "project selection"

# Debug mode (step through tests)
cd gui && npm run test:e2e:debug

# View HTML report after running
cd gui && npm run test:e2e:report
```

#### E2E Test Files

| File | Purpose |
|------|---------|
| `gui/e2e/app-lifecycle.e2e.ts` | App launch, window creation, shutdown |
| `gui/e2e/user-flows.e2e.ts` | Project selection, agent creation flows |
| `gui/e2e/ipc-communication.e2e.ts` | IPC round-trips, API verification |
| `gui/e2e/terminal.e2e.ts` | Terminal rendering and I/O |
| `gui/e2e/settings.e2e.ts` | Settings page navigation and persistence |
| `gui/e2e/error-scenarios.e2e.ts` | Error handling and recovery |

#### E2E Test Helpers

Test helpers are located in `gui/e2e/helpers/`:

| Helper | Purpose |
|--------|---------|
| `createIPCHelpers(appPage)` | Typed IPC wrappers for all main process calls |
| `waitForDashboard(page)` | Wait for dashboard to be visible |
| `waitForSettingsPage(page)` | Wait for settings page to be visible |
| `clickSettingsLink(page)` | Navigate to settings page |
| `getVisibleAgentCount(page)` | Count visible agent cards |

Example usage:
```typescript
import { createIPCHelpers, waitForDashboard } from './helpers'

const ipc = createIPCHelpers(appPage)
await ipc.selectProject(testProject)
await waitForDashboard(appPage.page)

const settings = await ipc.getSettings()
await ipc.updateSettings({ notifications: { enabled: false } })
```

#### E2E Test Results

After running E2E tests, results are available in:
- `gui/e2e-results.json` - JSON results (agent-parseable)
- `gui/e2e-report/` - HTML report
- `gui/e2e-results/` - Screenshots and traces on failure

#### Writing E2E Tests

```typescript
import { test, expect, createAppPage } from './fixtures'
import { createIPCHelpers, waitForDashboard } from './helpers'

test('should complete user flow', async ({ electronApp, testProject }) => {
  const appPage = createAppPage(electronApp)
  const ipc = createIPCHelpers(appPage)

  // Select project via IPC (bypasses file dialog)
  await ipc.selectProject(testProject)
  await waitForDashboard(appPage.page)

  // Create assignment
  const assignment = await ipc.createAssignment({
    prompt: 'Test prompt',
    tool: 'claude',
  })

  expect(assignment.id).toBeTruthy()
})
```

#### When to Run E2E Tests

- After making UI changes
- After modifying IPC handlers
- After changes to main process services
- Before major releases
- When unit tests pass but behavior seems incorrect

#### When to Run Full Tests

Run the full test suite (`npm test`) only when:
- You modified test configuration files (`vitest.config.ts`, `package.json`)
- You changed shared types or interfaces used across many files
- You're preparing a final commit to main/master
- Selective tests pass but you want extra confidence

#### Memory Management
- Tests are configured to use max 4 concurrent workers
- Node heap limited to 2GB via `NODE_OPTIONS`
- Use `test:changed` to minimize memory usage
- If system is slow, close other applications during test runs

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
    ├── ClaudeConfigService # Import plugins from ~/.claude/
    ├── PRPollingService    # GitHub PR status polling
    ├── NotificationService # System notifications
    ├── MinionsConfigService  # Read/write minions.json config
    ├── SetupWizardService    # One-click setup wizard agent
    └── HandoffApiService     # HTTP API for /handoff command (port 19234)
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
    ├── PlanApproval        # Super minion plan review
    └── ImportedAgentsSettings  # Claude Code plugin imports UI
```

### Configuration Management

The framework supports two configuration formats:

| Format | Config File | Agent State | Detection |
|--------|------------|-------------|-----------|
| **New (v2.0)** | `minions.json` | `.minions/agents/*.json` | Preferred |
| **Legacy (v1)** | `minions/config.json` | `.agent-info` | Fallback |

**MinionsConfigService** handles reading/writing configuration with automatic format detection:
- Checks `minions.json` first, falls back to `minions/config.json`
- Provides migration utilities for legacy projects

**SetupWizardService** manages the one-click setup experience:
- Detects if a project needs setup or migration
- Spawns a Claude agent to analyze the project and generate configuration
- Parses wizard output to create `minions.json`
- Optionally generates a project-specific CLAUDE.md

### Agent Lifecycle
1. **Create Assignment** - User creates via GUI with prompt, tool (claude/cursor-cli/codex), model
2. **Setup Worktree** - `setup.sh` creates git worktree for isolation
3. **Start Agent** - TerminalService spawns PTY with selected tool (Claude/Cursor/Codex)
4. **Monitor** - ClaudeSessionInfoService watches JSONL for state changes (Claude only)
5. **Signals** - Agent outputs `===SIGNAL:XXX===` for orchestrator events
6. **Teardown** - Clean up worktree when done

### Agent Archive
When an agent is deleted, its metadata is preserved in an archive for historical reference.

- **Storage Location**: `.minions/archive/` directory in the project
- **Archive Format**: JSON files named `{agentId}.json`
- **Preserved Data** (ArchivedAgent interface):
  - `id`, `branchName`, `prompt`, `status`, `tool`, `model`
  - `createdAt`, `archivedAt` timestamps
  - `prUrl` (if a PR was created)
  - `historyContext` (conversation/session context)
- **IPC Handlers**:
  - `archive:list` - Returns all archived agents for current project
  - `archive:get` - Returns a specific archived agent by ID
- **Behavior**: The git worktree is still deleted during teardown, but the archive preserves agent metadata for future reference and audit trails.

### Terminal Mode (Tmux Integration)

The framework supports two terminal modes for agent terminals:

| Mode | Description | Multiple Terminals | Window Management |
|------|-------------|-------------------|-------------------|
| **tmux** (default) | Agent runs inside tmux session | Use tmux keybindings | Tmux manages windows |
| **tabs** (legacy) | Each terminal is a separate PTY | "Add Terminal" button in GUI | GUI manages tabs |

**Configuration:**
- Setting: `terminal.terminalMode` in AppSettings (Settings screen in GUI)
- Default: `tmux` (with automatic fallback to `tabs` if tmux is not installed)
- IPC: `terminal:checkTmux` returns whether tmux is available

**Automatic Fallback:**
When `tmux` mode is configured but tmux is not installed on the system, the framework automatically falls back to `tabs` mode. The availability check runs once on startup and caches the result.

**Tmux Mode Benefits:**
- Session persistence: Detach/reattach without losing state
- Native window management: Use familiar tmux keybindings
- Respects user's `~/.tmux.conf` configuration
- Single session per agent named `minion-{agentId}`
- Consistent experience for users already familiar with tmux

**Essential Tmux Keybindings:**
When in tmux mode, use these keybindings (default prefix is `Ctrl+B`):

| Keybinding | Action |
|------------|--------|
| `Ctrl+B c` | Create new window |
| `Ctrl+B n` | Next window |
| `Ctrl+B p` | Previous window |
| `Ctrl+B 0-9` | Switch to window by number |
| `Ctrl+B w` | List all windows |
| `Ctrl+B d` | Detach from session (agent continues running) |
| `Ctrl+B %` | Split pane vertically |
| `Ctrl+B "` | Split pane horizontally |
| `Ctrl+B x` | Close current pane |
| `Ctrl+B [` | Enter scroll/copy mode (use arrows, `q` to exit) |

**Note:** If you have customized your tmux prefix key in `~/.tmux.conf`, use your custom prefix instead of `Ctrl+B`.

**Tmux Session Naming:**
- Pattern: `minion-{sanitizedAgentId}`
- Special characters (`.`, `:`, `/`, `\`) are replaced with underscores
- Example: `agent-123` becomes `minion-agent-123`
- Example with project prefix: `myproject-5` becomes `minion-myproject-5`

**Lifecycle:**
1. **Session creation**: On agent start, tmux session is created via `tmux new-session -A -s <name>` (creates or attaches)
2. **Running**: Agent CLI command is sent to the tmux session
3. **Stop/Delete**: Session is killed via `tmux kill-session -t <name>`
4. **Teardown**: `teardown.sh` includes tmux cleanup before worktree removal
5. **App Exit**: All tmux sessions are cleaned up when the app closes

**UI Changes in Tmux Mode:**
- "Add Terminal" button remains visible (creates a separate GUI terminal tab)
- Plain terminal tabs remain visible (these run outside the main tmux session)
- Test environment tabs remain visible (these run outside tmux)
- The main terminal shows the tmux session; tmux status bar appears at the bottom
- You can also create tmux windows inside the main session with `Ctrl+B c`

### Tool Selection

The GUI allows selecting from three agent tools when creating an assignment:

| Tool | Model Selection | Status Detection | Command |
|------|-----------------|------------------|---------|
| **claude** | Yes (multiple models) | JSONL file parsing | `claude` CLI command |
| **cursor-cli** | Yes (multiple models) | Pattern matching | `cursor-cli "<prompt>"` |
| **codex** | No (hardcoded to gpt-5.2-codex) | Pattern matching | `codex --model gpt-5.2-codex "<prompt>"` |

**Note:** Codex always uses the `gpt-5.2-codex` model. This is hardcoded in the CLI command and cannot be changed from the GUI.

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

### Agent Handoff

The Agent Handoff feature allows you to spawn new agents to continue related work, creating a "passing the baton" workflow with lineage tracking. Use this when scope creep occurs and you want to delegate new work to a separate agent.

**How to Trigger Handoff:**

Use the `/handoff` command within an agent session. The command instructs the agent to:
1. Commit all current changes
2. Create a detailed plan for the new agent
3. Call the Handoff API to spawn the new agent

**Branch Modes:**

| Mode | Description |
|------|-------------|
| **inherit** | New agent branches from the source agent's current work (continues from same code state) |
| **fresh** | New agent branches from main/master (starts with clean baseline) |

**Handoff API Service:**

The `HandoffApiService` provides a local HTTP server for programmatic handoff creation:

- **Port**: `19234` (localhost only, bound to `127.0.0.1`)
- **Endpoints**:
  - `POST /api/handoff` - Create a handoff agent
  - `GET /api/health` - Health check

**API Request Format:**
```typescript
interface HandoffApiRequest {
  sourceAgentId: string      // ID of the agent initiating handoff
  plan: string               // Work description/plan for new agent
  branchMode: 'inherit' | 'fresh'
  shortName?: string         // Optional custom branch suffix
}
```

**API Response:**
```typescript
interface HandoffApiResponse {
  success: boolean
  newAgentId?: string        // ID of the created agent (on success)
  error?: string             // Error message (on failure)
}
```

**Data Model:**

The `handoffSource` field on `AgentInfo` tracks handoff lineage:
```typescript
interface HandoffSource {
  agentId: string           // Source agent that initiated the handoff
  branchMode: 'inherit' | 'fresh'
  originalBranch: string    // Branch name of the source agent
  handoffTimestamp: string  // ISO timestamp when handoff occurred
}
```

**UI Indication:**
- Handoff agents appear indented under their parent in the sidebar
- A tree connector indicator shows the parent-child relationship
- Hovering shows the full lineage chain

**IPC Handler:**
- `agents:handoff` - Create a new agent via handoff from an existing agent

**Key Files:**
- `HandoffApiService.ts` - HTTP server for `/handoff` command API
- `AgentService.handoffAgent()` - Core handoff logic

### Claude Code Config Import

The framework can import agents and skills from Claude Code plugins to use as workflow subagent types. This allows reusing Claude Code's plugin ecosystem within the Agent Framework.

**What it does:**
- Discovers installed Claude Code plugins from `~/.claude/plugins/cache/`
- Extracts agent definitions (`.md` files in `agents/` directories)
- Extracts skill definitions (`SKILL.md` files in `skills/` directories)
- Makes them available as subagent types in workflows
- Detects naming conflicts with built-in agents and auto-renames

**How it works:**

1. **ClaudeConfigService** scans the Claude Code plugins cache directory
2. For each plugin, it reads the plugin manifest (`plugin.json`) and discovers agent/skill files
3. Agent/skill `.md` files are parsed for YAML frontmatter (name, description) and prompt content
4. File watching via `chokidar` detects plugin changes and auto-refreshes
5. Results are cached and sent to the renderer via IPC events

**Plugin Discovery Path:**
```
~/.claude/
└── plugins/
    └── cache/
        └── {marketplace}/          # e.g., 'anthropic', 'community'
            └── {plugin-name}/
                └── {version}/      # Uses latest version
                    └── .claude-plugin/
                        ├── plugin.json
                        ├── agents/
                        │   └── *.md
                        └── skills/
                            └── {skill-name}/
                                └── SKILL.md
```

**Configuration (ClaudeConfigSettings):**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Master toggle for imports |
| `enabledPlugins` | string[] | `[]` | Plugin IDs to enable (empty = all) |
| `disabledAgentIds` | string[] | `[]` | Specific agent IDs to skip |
| `autoRefresh` | boolean | `true` | Watch for config changes |
| `refreshIntervalMs` | number | `30000` | Polling interval (ms) |

**IPC Handlers:**
- `claudeConfig:getScanResult` - Get cached scan result
- `claudeConfig:refresh` - Force a rescan
- `claudeConfig:getSettings` - Get current settings
- `claudeConfig:setEnabled` - Update settings
- `claudeConfig:updated` (event) - Notifies renderer of changes

**Conflict Resolution:**
When an imported agent name conflicts with a built-in agent (e.g., `test`, `review`, `implement`), the imported agent is automatically renamed with an `-imported` suffix to avoid collisions.

**UI Access:**
Skills and imported agents are accessible via the dedicated **Skills** page in the sidebar. Users can:
- View all skills grouped by source (Claude Plugins, Vercel Skills, Project Skills)
- Enable/disable individual skills
- See override relationships between project and global skills
- Manually trigger a refresh

### Skills Library

The Skills Library feature extends the framework to support skills from multiple sources beyond Claude Code plugins.

**Supported Sources:**

| Source | Path | Format |
|--------|------|--------|
| Claude Code Plugins | `~/.claude/plugins/cache/` | Plugin manifest + agents/skills folders |
| Vercel Skills | `~/.claude/skills/` | `{skill-name}/SKILL.md` + optional scripts/ |
| Project Skills | `{project}/.claude/skills/` | Same as Vercel Skills |

**Vercel Skills Structure:**
```
~/.claude/skills/
└── {skill-name}/
    ├── SKILL.md           # Skill definition with frontmatter
    ├── scripts/           # Optional executable scripts
    │   └── *.sh
    └── references/        # Optional reference files
        └── *.md
```

**Installing Vercel Skills:**
```bash
npx add-skill vercel-labs/agent-skills
```

**Override Behavior:**
Project-local skills override global skills with the same name. This allows projects to customize skills for their specific needs while maintaining access to global skills.

**Configuration (SkillsLibrarySettings):**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vercelSkillsEnabled` | boolean | `true` | Enable ~/.claude/skills/ scanning |
| `projectSkillsEnabled` | boolean | `true` | Enable project-local skills |
| `disabledSkillIds` | string[] | `[]` | Specific skill IDs to disable |

**Key Services:**
- **SkillsLibraryService**: Scans Vercel and project skills directories
- **UnifiedSkillsService**: Combines all skill sources with override resolution
- **WorkflowService**: Consumes skills as subagent types for workflows

**IPC Handlers:**
- `skillsLibrary:scan` - Scan Vercel/project skills
- `skillsLibrary:refresh` - Force a rescan
- `unifiedSkills:getScanResult` - Get all skills from all sources
- `unifiedSkills:setSkillEnabled` - Enable/disable a specific skill

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **detect-changes**: Determines which packages changed
2. **lint**: TypeScript type checking
3. **test-gui**: Runs GUI unit tests (macOS runner for node-pty)
4. **test-minions**: Runs minions package tests
5. **build-gui**: Smoke test the production build
   - **Purpose**: Smoke test the production build
   - **Runner**: ubuntu-latest (Linux/x64)
   - **Timeout**: 10 minutes
   - **Dependencies**: Requires lint, test-gui, test-minions to pass or be skipped
   - **Key steps**:
     1. Install dependencies: `npm ci`
     2. Build: `npm run build -w gui`
     3. Verify artifacts created (main, preload, renderer bundles)
     4. Upload artifacts (7-day retention)
6. **test-e2e**: Runs E2E tests against the built Electron app (smart detection)
   - **Purpose**: Verify full application functionality
   - **Runner**: macos-latest (required for node-pty and Electron)
   - **Timeout**: 30 minutes
   - **Trigger**: Only runs when GUI source code changes (not docs or tests)
   - **Selective Testing**: Maps changed files to relevant E2E tests:
     - `main/index.ts` → `app-lifecycle.e2e.ts`, `ipc-communication.e2e.ts`
     - `services/TerminalService.ts` → `terminal.e2e.ts`
     - `services/AgentService.ts` → `user-flows.e2e.ts`
     - `preload/*` → `ipc-communication.e2e.ts`
     - `renderer/*` → `user-flows.e2e.ts`
   - **Key steps**:
     1. Check if E2E tests are needed based on changed files
     2. Install dependencies and rebuild native modules
     3. Download build artifacts from build-gui job
     4. Run selective E2E tests (or all if infrastructure changed)
     5. Upload test results and HTML report

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

### Running the Setup Wizard
When a user selects a new project without `minions.json`:
1. The GUI detects the project needs setup via `SetupWizardService.needsWizard()`
2. A Claude agent is spawned to analyze the project
3. The agent asks questions and generates configuration
4. Output containing `===MINIONS_CONFIG_START===` markers is parsed
5. `minions.json` is written and `.minions/` folder is created

### Migrating Legacy Projects
For projects with the old `minions/` folder structure:
1. The GUI detects legacy structure via `SetupWizardService.hasLegacyStructure()`
2. User is prompted to migrate
3. `MinionsConfigService.migrateFromLegacy()` performs the migration:
   - Creates `minions.json` from `minions/config.json`
   - Creates `.minions/` folder structure
   - Migrates agent state from `.agent-info` to `.minions/agents/`
   - Updates `.gitignore`
4. Legacy files are preserved as `minions.deprecated/` until manually removed

## Key Files Reference

| File | Purpose |
|------|---------|
| `gui/src/main/index.ts` | Electron entry point, IPC handlers |
| `gui/src/main/services/AgentService.ts` | Agent CRUD, worktrees, PRs, archiving, handoff |
| `gui/src/main/services/__tests__/AgentService.archive.test.ts` | Archive functionality tests |
| `gui/src/main/services/__tests__/AgentService.handoff.test.ts` | Handoff functionality tests |
| `gui/src/main/services/HandoffApiService.ts` | HTTP server for /handoff command API (localhost:19234) |
| `gui/src/main/services/__tests__/HandoffApiService.test.ts` | Handoff API service tests |
| `gui/src/main/services/TerminalService.ts` | PTY management, tmux integration, cleanup safety patterns |
| `gui/src/main/services/__tests__/TerminalService.tmux.test.ts` | Tmux integration tests |
| `gui/src/main/services/__tests__/TerminalService.handoff.test.ts` | Handoff signal detection tests |
| `gui/src/main/services/MinionsConfigService.ts` | Read/write minions.json, migration |
| `gui/src/main/services/SetupWizardService.ts` | One-click setup wizard agent |
| `gui/src/main/services/ClaudeConfigService.ts` | Import plugins from ~/.claude/ as workflow agents |
| `gui/src/main/services/SkillsLibraryService.ts` | Scan Vercel and project-local skills |
| `gui/src/main/services/UnifiedSkillsService.ts` | Combine all skill sources with override resolution |
| `gui/src/main/services/types/MinionsConfig.ts` | TypeScript types for config schema |
| `gui/src/main/services/types/ClaudeConfigTypes.ts` | TypeScript types for Claude config import |
| `gui/src/main/services/types/SkillsLibraryTypes.ts` | TypeScript types for Skills Library |
| `gui/src/shared/types/settings.ts` | Settings types: EditorType, EditorSettings, EDITOR_DISPLAY_NAMES, etc. |
| `gui/src/preload/index.ts` | IPC bridge (all renderer APIs) |
| `gui/src/renderer/src/components/Dashboard.tsx` | Main UI component |
| `gui/src/renderer/src/components/skills/SkillsPage.tsx` | Skills Library UI page |
| `gui/src/renderer/src/components/ImportedAgentsSettings.tsx` | Settings UI for Claude Code plugin imports |
| `gui/playwright.config.ts` | E2E test configuration |
| `gui/e2e/README.md` | E2E testing guide and documentation |
| `gui/e2e/fixtures.ts` | E2E test fixtures and AppPage class |
| `gui/e2e/electron-app.ts` | Electron app launch utilities |
| `gui/e2e/helpers/` | E2E test helpers (IPC wrappers, UI utilities) |
| `gui/e2e/settings.e2e.ts` | Settings page E2E tests |
| `gui/e2e/error-scenarios.e2e.ts` | Error handling E2E tests |
| `minions/bin/setup.sh` | Worktree creation script |
| `minions/rules/orchestrator_signals.md` | Signal protocol docs |
| `.github/scripts/analyze-changes.js` | CI test selection logic (reference for selective testing) |

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

### Build-GUI CI Failure (electron package not found)
If build-gui fails with "Cannot find module 'electron/package.json'":
- Verify `electron` is in root `package.json` devDependencies (required for electron-vite)
- Check that `electron` is installed at root: `ls node_modules/electron/package.json`
- Run `npm ci` to ensure all dependencies are properly installed
- See the "Dependency Management" section for the convention on where to place dependencies

### Codex Tool Issues

**Codex Command Not Found:**
- Verify Codex CLI is installed: `which codex`
- Install if missing: `npm install -g @openai/codex`
- Check PATH includes npm global bin directory: `npm bin -g`
- The `install.sh` script warns if `codex` is not found but does not block installation

**API Key Not Working:**
- Verify environment variable is set: `echo $OPENAI_API_KEY`
- Ensure variable is exported in shell config (`~/.zshrc` or `~/.bashrc`)
- Restart terminal or source config file: `source ~/.zshrc`
- Test directly: `codex --model gpt-5.2-codex "test prompt"`

**Model Selection Not Available:**
- This is expected behavior - Codex always uses `gpt-5.2-codex`
- Model selection is hardcoded in the TerminalService
- Cannot be changed from GUI (by design)

### E2E Test Issues

**Tests hang or timeout:**
- Ensure the app is built first: `npm run build -w gui`
- Check if a previous Electron process is still running
- Increase timeout in `playwright.config.ts` if needed

**Cannot find electronAPI:**
- The app may not have fully loaded
- Check that `waitForAppReady()` is called in the test

**Tests fail in CI but pass locally:**
- CI uses macOS runner - check for platform-specific issues
- Verify Playwright browsers are installed: `npx playwright install chromium`
- Check E2E artifacts in GitHub Actions for screenshots and traces

**Screenshot/trace not captured:**
- Screenshots are only captured on failure
- Check `gui/e2e-results/` directory after test run

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/<name>` or `claude/<session-id>`
- All tests must pass before merging
- CI runs on all PRs to main
