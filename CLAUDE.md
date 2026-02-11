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

**Minion Framework** is a general-purpose agent CLI orchestrator for running multiple AI coding agents in parallel on any folder. For git repositories, agents are isolated via git worktrees; non-git projects are also fully supported with agents working directly in the project directory.

### Core Features
- **GUI**: Electron desktop app for managing agents visually
- **Multi-tool support**: Claude Code, Cursor CLI, Codex CLI
- **Git worktree isolation**: Parallel work without conflicts (git projects)
- **Non-git project support**: Run agents on any folder without requiring git
- **Handoff Protocol**: Agents can hand off work to orchestrator or other agents (git projects only)

## Tech Stack

| Component | Technology |
|-----------|------------|
| GUI Framework | Electron 28.x with electron-vite |
| Frontend | React 18 + Zustand |
| Terminal | node-pty + xterm.js |
| Testing | Vitest (unit), Playwright (E2E) |
| Language | TypeScript (strict mode) |

### Runtime Requirements
- Node.js 20.x, npm
- Git (required for worktree-based isolation; optional for non-git projects)
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
├── minions/                  # Framework folder
│   ├── bin/                 # Management scripts
│   ├── rules/               # Agent behavior rules
│   ├── templates/           # Spec templates
│   └── config.json          # Project configuration
├── .agent-info              # Runtime state (gitignored)
└── CLAUDE.md                # Optional project-specific instructions
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
| `AgentService` | Agent lifecycle, worktrees (git) or direct (non-git), PRs, archiving, handoff |
| `TerminalService` | PTY management, tmux integration |
| `ProjectService` | Multi-project workspace management |
| `ClaudeSessionInfoService` | Parse Claude JSONL for state |
| `ClaudeConfigService` | Import Claude Code settings and plugins |
| `MinionsConfigService` | Read/write minions config |
| `SetupWizardService` | One-click project setup |
| `HandoffApiService` | HTTP API for agent handoff (port 19234) |
| `TeleportService` | Teleport session parsing |
| `TeleportMetadataService` | Teleport metadata management |
| `WorkflowService` | Workflow configuration |
| `SkillsLibraryService` | Scan commands/agents directories |
| `UnifiedSkillsService` | Combine all skill sources |
| `NotificationService` | System notifications |
| `PRPollingService` | GitHub PR status polling (git projects only) |
| `SettingsService` | App settings persistence |
| `TestEnvService` | Test environment terminals |
| `FileWatcherService` | File change monitoring |

### IPC Communication
- Handler names use colon-separated namespaces: `project:select`, `agents:list`
- Use `ipcMain.handle` for async request/response
- Use `ipcMain.on`/`send` for fire-and-forget events
- All APIs defined in `preload/index.ts` and typed in `preload/index.d.ts`

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
    ├── AgentService        # Agent lifecycle, worktrees (git) / direct (non-git), PRs
    ├── TerminalService     # PTY management, Claude sessions
    ├── ProjectService      # Multi-project workspace management
    ├── ClaudeSessionInfoService  # Parse Claude JSONL files
    ├── ClaudeConfigService # Import plugins from ~/.claude/
    ├── PRPollingService    # GitHub PR status polling
    ├── NotificationService # System notifications
    ├── MinionsConfigService  # Read/write minions config
    ├── SetupWizardService    # One-click setup wizard agent
    └── HandoffApiService     # HTTP API for /handoff and /spawn-super (port 19234)
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
- `defaultBaseBranch` is optional in `MinionsConfig.project` (omitted for non-git projects)

**SetupWizardService** manages the one-click setup experience:
- Detects if a project needs setup
- Spawns a Claude agent to analyze the project and generate configuration
- Optionally generates a project-specific CLAUDE.md

### Agent Lifecycle

**Git projects:**
1. **Create Assignment** - User provides prompt, tool, model, branch name
2. **Setup Worktree** - `setup.sh` creates git worktree for isolation
3. **Start Agent** - TerminalService spawns PTY with tool
4. **Monitor** - JSONL parsing for state (Claude), pattern matching (others)
5. **Teardown** - Clean up worktree when done

**Non-git projects:**
1. **Create Assignment** - User provides prompt, tool, model, label (no branch)
2. **Create Agent State** - Agent JSON written to `.minions/agents/`; no worktree or branch is created
3. **Start Agent** - TerminalService spawns PTY with tool in the project directory (`workingDirectory`)
4. **Monitor** - Same as git projects
5. **Teardown** - Archive agent and remove state file (no git cleanup needed)

The `ProjectState.isGitRepo` flag (detected at project-add time) controls which path is used. `AgentInfo.branch` is optional (absent for non-git agents), and `AgentInfo.workingDirectory` stores the working directory for non-git agents.

### Git Feature Gating

Several features are only available for git projects and are gated behind the `isGitRepo` check:

| Feature | Git Projects | Non-Git Projects |
|---------|-------------|-----------------|
| Agent creation | Worktree-based isolation | Direct, agents share project directory |
| Branch assignment | Required (`AgentInfo.branch`) | Not used (label-only via `feature` field) |
| PR creation | Supported | Not available |
| Handoff (`/api/handoff`) | Supported | Not available |
| Spawn super (`/api/spawn-super`) | Supported | Not available |
| PR polling | Supported | Not available |
| Base branch agent | Created automatically | Not created |
| Agent teardown | Runs `teardown.sh`, removes worktree | Archives agent, removes state file |

The UI adapts to these differences: non-git projects show a label input instead of a branch input when creating agents, and PR-related buttons are hidden.

### Branch Modes (Git Projects Only)

| Mode | Description |
|------|-------------|
| **inherit** (default) | New agent branches from the source agent's current work (continues from same code state) |
| **fresh** | New agent branches from main/master (starts with clean baseline) |

**Auto-Detection of Branch Mode:**
If `branchMode` is not specified in the API request, it is detected from the plan text:
- Phrases like "clean start", "fresh start", "from scratch", "start fresh", or "clean slate" trigger `fresh` mode
- All other cases default to `inherit` mode

**Parent Context:**
When a handoff agent is created, its prompt is automatically prefixed with context about the parent feature:
```
You are continuing work that was handed off from another agent.
Parent feature branch: {parentBranchName}
Parent work description: {parentPrompt}

---

{newAgentPlan}
```

This helps the new agent understand the broader context of the work.

**Handoff API Service (Git Projects Only):**

The `HandoffApiService` provides a local HTTP server for programmatic agent creation. Handoff and spawn-super endpoints require a git project (`isGitRepo: true`) since they rely on git worktrees and branches:

- **Port**: `19234` (localhost only, bound to `127.0.0.1`)
- **Endpoints**:
  - `POST /api/handoff` - Create a handoff agent (single agent, inherits context)
  - `POST /api/spawn-super` - Spawn super minions (batch, workflow-driven)
  - `GET /api/health` - Health check

**Handoff API Request Format:**
```typescript
interface HandoffApiRequest {
  sourceAgentId: string      // ID of the agent initiating handoff
  plan: string               // Work description/plan for new agent
  branchMode?: 'inherit' | 'fresh'  // Optional, auto-detected from plan if omitted
  shortName?: string         // Optional custom branch suffix
}
```

**Handoff API Response:**
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

**Settings:**

Handoff behavior can be configured in Settings under "Agent Handoff":
- **YOLO Mode Inheritance**: When enabled (default), child agents inherit the parent's YOLO mode setting

**UI Indication:**
- Handoff agents appear indented under their parent in the sidebar
- A tree connector indicator shows the parent-child relationship
- Hovering shows the full lineage chain

**IPC Handler:**
- `agents:handoff` - Create a new agent via handoff from an existing agent

**Key Files:**
- `HandoffApiService.ts` - HTTP server for `/handoff` and `/spawn-super` APIs
- `AgentService.handoffAgent()` - Core handoff logic
- `AgentService.spawnSuperMinion()` - Core super minion spawning logic

### Super Minion Spawning (Git Projects Only)

Super minion spawning allows batch creation of workflow-driven agents from an existing agent. Unlike handoff (which continues related work with inherited context), super minions start fresh from main and follow structured workflows. This feature requires a git project since it relies on git worktrees.

**How to Trigger:**

Use the `/super-handoff` skill within an agent session. The skill:
1. Collects spawn details (plans, optional workflow IDs)
2. Calls the Spawn Super API to create agents in parallel
3. Reports results showing which agents were created

**Key Differences from Handoff:**

| Aspect | Handoff (`/api/handoff`) | Super Spawn (`/api/spawn-super`) |
|--------|-------------------------|----------------------------------|
| Branch mode | `inherit` or `fresh` | Always `fresh` (from main) |
| Context | Parent context included in prompt | Minimal context (just the plan) |
| Batch support | Single agent | Up to 10 agents per request |
| Workflow | None (regular agent) | Workflow-driven (planning mode) |

**Spawn Super API Request:**
```typescript
interface SpawnSuperApiRequest {
  sourceAgentId: string         // ID of the agent initiating spawns
  spawns: SpawnRequest[]        // Array of spawn requests (max 10)
}

interface SpawnRequest {
  plan: string                  // Work description for the super minion
  workflowId?: string           // Optional: specific workflow (auto-detected if omitted)
  shortName?: string            // Optional: custom branch suffix
}
```

**Spawn Super API Response:**
```typescript
interface SpawnSuperResponse {
  success: boolean              // true if ALL spawns succeeded
  partialSuccess: boolean       // true if SOME (but not all) succeeded
  results: SpawnResult[]        // Per-spawn results
  batchId: string               // Unique ID for this spawn batch
  totalRequested: number
  totalSucceeded: number
  totalFailed: number
}

interface SpawnResult {
  success: boolean
  agentId?: string
  workflowId?: string
  error?: string
}
```

**Workflow Auto-Detection:**
If `workflowId` is omitted, it is detected from the plan text:
- 2+ debug keywords (debug, bug, fix, investigate, root cause, crash, broken, failing, error, issue) triggers `debug-workflow`
- Otherwise defaults to `default` (Standard Workflow)

**Data Model:**

The `spawnSource` field on `AgentInfo` tracks spawn lineage:
```typescript
interface SpawnSource {
  parentAgentId: string         // Agent that initiated the spawn
  spawnTimestamp: string        // ISO timestamp
  workflowId: string            // Which workflow was selected
  batchId?: string              // For tracking spawns from same request
}
```

**UI Events:**
- `agents:superSpawned` - Notifies renderer when spawns complete (includes batchId and results)

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
- View all skills grouped by source (Claude Plugins, Global Commands/Agents, Project Commands/Agents)
- Enable/disable individual skills
- See override relationships between project and global skills
- Manually trigger a refresh

### Skills Library

The Skills Library scans and discovers commands/agents from standard Claude Code locations.

**Supported Sources:**

| Source | Path | Format |
|--------|------|--------|
| Global Commands | `~/.claude/commands/` | `{name}.md` with optional YAML frontmatter |
| Global Agents | `~/.claude/agents/` | `{name}.md` with optional YAML frontmatter |
| Project Commands | `{project}/.claude/commands/` | Same format |
| Project Agents | `{project}/.claude/agents/` | Same format |
| Claude Code Plugins | `~/.claude/plugins/cache/` | Plugin manifest + agents folders |

**Skill File Format:**
```markdown
---
name: My Custom Skill
description: What this skill does
model: opus
---

Instructions for Claude when using this skill...
```

**Override Behavior:**
Project-local skills override global skills with the same name. This allows projects to customize skills for their specific needs while maintaining access to global skills.

**Configuration (SkillsLibrarySettings):**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commandsEnabled` | boolean | `true` | Enable ~/.claude/commands/ scanning |
| `agentsEnabled` | boolean | `true` | Enable ~/.claude/agents/ scanning |
| `projectSkillsEnabled` | boolean | `true` | Enable project-local commands/agents |
| `disabledSkillIds` | string[] | `[]` | Specific skill IDs to disable |

**Key Services:**
- **SkillsLibraryService**: Scans global and project commands/agents directories
- **UnifiedSkillsService**: Combines all skill sources with override resolution
- **WorkflowService**: Consumes skills as subagent types for workflows

**IPC Handlers:**
- `skillsLibrary:scan` - Scan commands/agents directories
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
| `gui/src/main/index.ts` | Electron entry point, IPC handlers |
| `gui/src/main/services/AgentService.ts` | Agent CRUD, worktrees (git) / direct (non-git), PRs, archiving, handoff |
| `gui/src/main/services/__tests__/AgentService.archive.test.ts` | Archive functionality tests |
| `gui/src/main/services/__tests__/AgentService.handoff.test.ts` | Handoff functionality tests |
| `gui/src/main/services/__tests__/AgentService.nonGit.test.ts` | Non-git project agent lifecycle tests |
| `gui/src/main/services/HandoffApiService.ts` | HTTP server for /handoff and /spawn-super APIs (localhost:19234) |
| `gui/src/main/services/__tests__/HandoffApiService.test.ts` | Handoff API service tests |
| `gui/resources/minions/rules/super-handoff.md` | Super handoff skill definition for spawning super minions |
| `gui/src/main/services/TerminalService.ts` | PTY management, tmux integration, cleanup safety patterns |
| `gui/src/main/services/__tests__/TerminalService.tmux.test.ts` | Tmux integration tests |
| `gui/src/main/services/__tests__/TerminalService.handoff.test.ts` | Handoff signal detection tests |
| `gui/src/main/services/__tests__/TerminalService.nongit.test.ts` | Non-git terminal/worktree path tests |
| `gui/src/main/services/MinionsConfigService.ts` | Read/write minions.json, migration |
| `gui/src/main/services/SetupWizardService.ts` | One-click setup wizard agent |
| `gui/src/main/services/ClaudeConfigService.ts` | Import plugins from ~/.claude/ as workflow agents |
| `gui/src/main/services/SkillsLibraryService.ts` | Scan global and project-local commands/agents |
| `gui/src/main/services/UnifiedSkillsService.ts` | Combine all skill sources with override resolution |
| `gui/src/main/services/types/MinionsConfig.ts` | TypeScript types for config schema |
| `gui/src/main/services/types/ClaudeConfigTypes.ts` | TypeScript types for Claude config import |
| `gui/src/main/services/types/SkillsLibraryTypes.ts` | TypeScript types for Skills Library |
| `gui/src/preload/index.ts` | IPC bridge (all renderer APIs) |
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
