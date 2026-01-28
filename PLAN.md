# Super Minion Spawning - Engineering Design Plan

## Executive Summary

This feature enables agents to spawn multiple "Super Minions" (workflow-driven agents) in parallel via an API endpoint and natural language recognition. Super Minions are specialized agents that run workflows (like Debug Workflow or Standard Workflow) with minimal context and fresh worktrees from main.

---

## Design Decisions (Addressing Review Concerns)

### 1. Race Condition Mitigation - Worktree Creation Mutex

**Problem:** Multiple `git worktree add` operations running in parallel can conflict when modifying `.git/worktrees/`.

**Solution:** Use a mutex to serialize worktree creation while parallelizing other operations.

```typescript
import { Mutex } from 'async-mutex'

class AgentService {
  private worktreeMutex = new Mutex()

  async spawnSuperMinion(...): Promise<SpawnResult> {
    // Acquire lock only for worktree creation
    const release = await this.worktreeMutex.acquire()
    try {
      await this.createWorktree(...)
    } finally {
      release()
    }
    // Rest of spawn logic runs in parallel
    await this.startAgent(...)
  }
}
```

**Dependency:** Add `async-mutex` package to gui/package.json.

### 2. Conservative Workflow Detection

**Problem:** Single-keyword matching is too aggressive (e.g., "Add error handling" → Debug workflow).

**Solution:** Require **2+ strong debug indicators** OR explicit `workflowId` (recommended).

```typescript
detectWorkflowFromPlan(plan: string): { workflowId: string; confidence: 'high' | 'low' } {
  const strongIndicators = [
    /\bdebug\b/i,
    /\bbug\b/i,
    /\bfix\s+(the\s+)?bug/i,
    /\binvestigate\b/i,
    /\broot\s*cause/i
  ]

  const matches = strongIndicators.filter(re => re.test(plan))

  if (matches.length >= 2) {
    return { workflowId: 'debug-workflow', confidence: 'high' }
  } else if (matches.length === 1) {
    // Single match - default to Standard but log warning
    console.warn(`Plan contains single debug keyword, using Standard workflow. Use explicit workflowId for Debug.`)
    return { workflowId: 'default', confidence: 'low' }
  }

  return { workflowId: 'default', confidence: 'high' }
}
```

**Recommendation:** Users should specify explicit `workflowId` for reliability.

### 3. Partial Failure Handling

**Problem:** What happens to successful spawns when some fail?

**Solution:** **Keep successful spawns** - do not rollback. Add `partialSuccess` flag.

```typescript
export interface SpawnSuperResponse {
  success: boolean              // true only if ALL spawns succeeded
  partialSuccess: boolean       // true if SOME (but not all) succeeded
  results: SpawnResult[]
  batchId: string
  totalRequested: number
  totalSucceeded: number
  totalFailed: number
}
```

**Behavior:**
- `success=true, partialSuccess=false` → All spawns succeeded
- `success=false, partialSuccess=true` → Some succeeded, some failed (keep successful ones)
- `success=false, partialSuccess=false` → All spawns failed

### 4. Request Size Limit

**Validation:** Maximum **10 spawns per request** to prevent resource exhaustion.

```typescript
private validateSpawnSuperRequest(request: SpawnSuperApiRequest): { valid: boolean; error?: string } {
  if (!request.sourceAgentId) {
    return { valid: false, error: 'Missing required field: sourceAgentId' }
  }
  if (!request.spawns || request.spawns.length === 0) {
    return { valid: false, error: 'spawns array must not be empty' }
  }
  if (request.spawns.length > 10) {
    return { valid: false, error: 'Maximum 10 spawns per request' }
  }
  // ... validate each spawn
}
```

### 5. Structured Logging

```typescript
// On batch spawn start
log.info('Spawn batch initiated', {
  batchId,
  sourceAgentId,
  spawnCount: spawns.length,
  workflowIds: spawns.map(s => s.workflowId || 'auto-detect')
})

// On individual spawn
log.debug('Spawning super minion', {
  batchId,
  index: i,
  workflowId,
  branchName
})

// On batch complete
log.info('Spawn batch completed', {
  batchId,
  totalSucceeded,
  totalFailed,
  durationMs
})
```

### 6. SpawnSource vs HandoffSource Distinction

```typescript
/**
 * SpawnSource: Used for super minion batch spawns via /api/spawn-super
 * - Always branches fresh from main
 * - Workflow-driven (debug or standard workflow)
 * - Minimal context (just the plan)
 * - Can be part of a batch (has batchId)
 *
 * HandoffSource: Used for agent-to-agent delegation via /api/handoff
 * - Can inherit (branch from parent) or start fresh
 * - Continues related work
 * - Inherits parent context (branch, prompt)
 * - Always single agent
 */
```

### 7. GUI Update Timing (<2s Guarantee)

**Mechanism:** Event-driven updates via IPC, no polling required.

```
1. spawnSuperMinion() completes
2. IPC event 'agents:superSpawned' sent to renderer
3. Zustand store updates agents list
4. React re-renders sidebar immediately

Timeline:
- Worktree creation: ~500ms (serialized via mutex)
- Agent start: ~200ms
- IPC event: <10ms
- React render: <50ms
Total: <1s per spawn (within 2s guarantee)
```

**Implementation in Sidebar:**
```typescript
// In Dashboard or App component
useEffect(() => {
  const unsubscribe = window.electronAPI.onSuperMinionsSpawned((data) => {
    // Trigger immediate re-fetch of agents list
    refetchAgents()
  })
  return unsubscribe
}, [])
```

## Architecture Overview

### Data Flow Diagram

```
Agent (in session)
    │
    │ Natural language: "spawn super minions for these tasks"
    │ or explicit: /super-handoff
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Claude Code detects spawn intent                            │
│ → Calls POST /api/spawn-super on localhost:19234            │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ HandoffApiService.handleSpawnSuper()                        │
│ ├─ Validate request                                         │
│ ├─ Auto-detect workflow if not specified                    │
│ ├─ Process spawns in parallel (Promise.allSettled)          │
│ └─ Return per-spawn results                                 │
└─────────────────────────────────────────────────────────────┘
    │
    │ For each spawn:
    ▼
┌─────────────────────────────────────────────────────────────┐
│ AgentService.spawnSuperMinion()                             │
│ ├─ Create fresh worktree from main                          │
│ ├─ Set isSuperMinion: true                                  │
│ ├─ Set spawnSource metadata (parentId, timestamp)           │
│ └─ Write minimal .agent-info                                │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ TerminalService.startAgent()                                │
│ ├─ Generate workflow rules via WorkflowService              │
│ ├─ Write to worktree/minions/dynamic-rules.md               │
│ ├─ Start claude with --system-prompt-file                   │
│ └─ Pass only the plan as prompt (minimal context)           │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ GUI Updates                                                 │
│ ├─ IPC: agents:updated, agents:superSpawned                 │
│ ├─ Sidebar: new agents appear with workflow badge           │
│ ├─ Toast notification for batch spawn                       │
│ └─ Visual grouping via spawnSource lineage                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Type Definitions

### New Types (`gui/src/main/services/types/ProjectConfig.ts`)

```typescript
/**
 * Tracks the spawn origin of a super minion.
 * Similar to HandoffSource but specific to super minion spawning.
 */
export interface SpawnSource {
  parentAgentId: string         // Agent that initiated the spawn
  spawnTimestamp: string        // ISO timestamp
  workflowId: string            // Which workflow was selected
  batchId?: string              // For tracking spawns from same request
}

/**
 * Result of a single spawn operation
 */
export interface SpawnResult {
  success: boolean
  agentId?: string
  workflowId?: string
  error?: string
}

/**
 * Full response from spawn-super endpoint
 */
export interface SpawnSuperResponse {
  success: boolean              // true if ALL spawns succeeded
  partialSuccess: boolean       // true if SOME (but not all) succeeded
  results: SpawnResult[]        // Per-spawn results
  batchId: string               // Unique ID for this spawn batch
  totalRequested: number
  totalSucceeded: number
  totalFailed: number
}
```

### New API Types (`gui/src/main/services/HandoffApiService.ts`)

```typescript
/**
 * Single spawn request within a batch
 */
export interface SpawnRequest {
  plan: string                  // Work description/plan for the super minion
  workflowId?: string          // Optional: specific workflow (auto-detected if omitted)
  shortName?: string           // Optional: custom branch suffix
}

/**
 * API request body for spawn-super endpoint
 */
export interface SpawnSuperApiRequest {
  sourceAgentId: string         // ID of the agent initiating spawns
  spawns: SpawnRequest[]        // Array of spawn requests (parallel execution)
}
```

### Updated AgentInfo (`gui/src/main/services/types/ProjectConfig.ts`)

Add to existing `AgentInfo` interface:
```typescript
export interface AgentInfo {
  // ... existing fields ...

  // New spawn source tracking (for super minions spawned via API)
  spawnSource?: SpawnSource
}
```

---

## File Modifications

### 1. `gui/src/main/services/HandoffApiService.ts`

**Changes:**
- Add new endpoint: `POST /api/spawn-super`
- Add workflow auto-detection method
- Add batch spawn handling with `Promise.allSettled`

**New Methods:**

```typescript
/**
 * Handle spawn-super endpoint for batch super minion creation
 */
private async handleSpawnSuper(req: IncomingMessage, res: ServerResponse): Promise<void>

/**
 * Auto-detect workflow based on plan content keywords
 * Returns 'debug-workflow' for debug keywords, 'default' otherwise
 */
private detectWorkflow(plan: string): string

/**
 * Validate spawn-super request
 */
private validateSpawnSuperRequest(request: SpawnSuperApiRequest): { valid: boolean; error?: string }
```

**Routing Update:**
```typescript
// In handleRequest()
if (req.method === 'POST' && req.url === '/api/spawn-super') {
  this.handleSpawnSuper(req, res)
}
```

### 2. `gui/src/main/services/AgentService.ts`

**New Method:**

```typescript
/**
 * Spawn a super minion with minimal context.
 * Creates fresh worktree from main, sets up workflow, starts agent.
 *
 * @param projectPath - Project to spawn in
 * @param plan - Work description (minimal context)
 * @param workflowId - Which workflow to use
 * @param sourceAgentId - Parent agent ID for lineage
 * @param batchId - Batch ID for tracking
 * @param shortName - Optional branch suffix
 */
async spawnSuperMinion(
  projectPath: string,
  plan: string,
  workflowId: string,
  sourceAgentId: string,
  batchId: string,
  shortName?: string
): Promise<SpawnResult>
```

**Implementation Details:**
- Always use `branchMode: 'fresh'` (worktree from main)
- Set `isSuperMinion: true`
- Set `mode: 'planning'` for workflow execution
- Set `spawnSource` metadata
- Generate branch name: `feature/{projectName}-{hash}/super-{shortName || auto}`

### 3. `gui/src/main/services/types/ProjectConfig.ts`

**Add:**
- `SpawnSource` interface
- `SpawnResult` interface
- `SpawnSuperResponse` interface
- Update `AgentInfo` with optional `spawnSource` field

### 4. `gui/src/main/services/WorkflowService.ts`

**New Method:**

```typescript
/**
 * Detect workflow from plan text based on keywords.
 * Used by spawn-super API for auto-detection.
 */
detectWorkflowFromPlan(plan: string): WorkflowConfig
```

**Detection Logic:**
```typescript
const debugKeywords = [
  /debug/i, /bug/i, /fix/i, /error/i, /issue/i, /crash/i,
  /broken/i, /failing/i, /investigate/i, /root\s*cause/i
]
// If any debug keyword matches, return DEBUG_WORKFLOW
// Otherwise return DEFAULT_WORKFLOW
```

### 5. `gui/src/main/index.ts`

**IPC Handler Updates:**

```typescript
// Add new spawn IPC handler
ipcMain.handle('agents:spawnSuper', async (
  _event,
  projectPath: string,
  spawns: SpawnRequest[],
  sourceAgentId: string
) => {
  return services.agentService.spawnSuperMinions(
    projectPath, spawns, sourceAgentId
  )
})

// Add IPC event for spawn completion notification
// mainWindow.webContents.send('agents:superSpawned', { batchId, results })
```

### 6. `gui/src/preload/index.ts`

**Add API:**

```typescript
// Spawn Super Minions APIs
spawnSuperMinions: (
  projectPath: string,
  spawns: { plan: string; workflowId?: string; shortName?: string }[],
  sourceAgentId: string
) => ipcRenderer.invoke('agents:spawnSuper', projectPath, spawns, sourceAgentId),

// Event listener for spawn completion
onSuperMinionsSpawned: (callback: (data: { batchId: string; results: SpawnResult[] }) => void) => {
  const subscription = (_event: any, data: any) => callback(data)
  ipcRenderer.on('agents:superSpawned', subscription)
  return () => ipcRenderer.removeListener('agents:superSpawned', subscription)
}
```

### 7. `gui/src/renderer/src/components/Sidebar.tsx`

**Updates:**
- Add visual grouping for spawned agents (indentation + connector)
- Add workflow badge/chip display
- Handle `spawnSource` for lineage display

**New Visual Elements:**
```tsx
// Workflow badge component
{agent.isSuperMinion && agent.workflowId && (
  <span className="workflow-badge" title={`Workflow: ${workflowName}`}>
    <WorkflowIcon size="xs" />
    {workflowName}
  </span>
)}

// Spawn source indicator (similar to handoff lineage)
{agent.spawnSource && (
  <span
    className="spawn-lineage-badge"
    title={`Spawned from ${agent.spawnSource.parentAgentId}`}
  >
    <span className="lineage-connector"></span>
    <span className="lineage-origin">
      {extractBranchName(parentBranch)}
    </span>
  </span>
)}
```

### 8. `gui/src/renderer/src/components/Sidebar.css`

**Add:**
```css
.workflow-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 10px;
  background: var(--workflow-badge-bg);
  border-radius: 4px;
  color: var(--workflow-badge-text);
}

.spawn-lineage-badge {
  /* Similar to .handoff-lineage-badge */
}
```

### 9. `gui/src/main/services/NotificationService.ts`

**New Method:**

```typescript
/**
 * Notify user of batch spawn completion.
 * Shows summary: X of Y super minions spawned successfully.
 */
notifyBatchSpawnComplete(
  batchId: string,
  totalSucceeded: number,
  totalFailed: number,
  parentAgentName: string
): boolean
```

### 10. New File: `gui/src/main/services/__tests__/SpawnSuperApi.test.ts`

**Test Coverage:**
- Request validation (missing fields, invalid workflowId)
- Workflow auto-detection (debug keywords vs default)
- Parallel spawn execution
- Partial failure handling
- Per-spawn error responses
- IPC event emission
- Integration with AgentService

---

## New Files to Create

### 1. Skill File: `super-handoff.md`

Location: Bundled with app in `gui/resources/minions/rules/super-handoff.md`

```markdown
---
name: Super Handoff
description: Spawn super minions for delegated workflow tasks
---

# Super Handoff Skill

This skill allows you to spawn multiple "super minions" - workflow-driven agents that work on tasks in parallel.

## When to Use

- When you have multiple independent tasks that can be parallelized
- When tasks require structured workflows (debugging, feature development)
- When you want to delegate work while continuing your own task

## How to Invoke

You can invoke this skill by:
1. Using `/super-handoff` command with optional arguments
2. Using natural language like "spawn super minions for these tasks"

## Arguments

- `--plan <text>`: Inline plan for a single spawn
- No arguments: Interactive mode asking for spawn details

## API Integration

This skill calls the local orchestrator API:
- Endpoint: `POST http://127.0.0.1:19234/api/spawn-super`
- The orchestrator will create fresh worktrees and start agents

## Natural Language Triggers

The following phrases trigger super minion spawning:
- "spawn super minions for these"
- "delegate these to workflows"
- "create super agents for"
- "spin up workflows for"
- "start parallel agents for"

## Output Format

Present spawns in a table before confirmation:

| # | Feature | Workflow | Branch |
|---|---------|----------|--------|
| 1 | Fix login bug | Debug | fix-login |
| 2 | Add caching | Standard | add-cache |

## Confirmation Flow (AC#8)

Ask for confirmation using AskUserQuestion with these exact options:

```
AskUserQuestion(questions=[{
  "question": "Ready to spawn X super minions. Each will work independently in its own worktree. Proceed?",
  "header": "Spawn",
  "options": [
    {"label": "Spawn all", "description": "Create all super minions and start them"},
    {"label": "Modify list", "description": "Edit the spawn list before proceeding"},
    {"label": "Cancel", "description": "Abort the operation"}
  ],
  "multiSelect": false
}])
```

- If "Spawn all" → Call API and show results
- If "Modify list" → Ask what to change, then re-present table
- If "Cancel" → Abort without calling API

## Error Handling (AC#16)

### API Unreachable

If connection to `localhost:19234` fails:

```
Unable to reach the orchestrator API at localhost:19234.

This usually means the Minion GUI is not running.

AskUserQuestion(questions=[{
  "question": "Would you like to retry connecting to the orchestrator?",
  "header": "Retry",
  "options": [
    {"label": "Retry", "description": "Try connecting again"},
    {"label": "Cancel", "description": "Abort the spawn operation"}
  ]
}])
```

### Partial Failure

If some spawns succeed and others fail:

```
Spawned 2 of 3 super minions:

✅ project-user-auth (Standard) - Started
✅ project-search-api (Standard) - Started
❌ project-fix-login - FAILED: Branch already exists

Would you like to:
- Retry failed spawns with different branch names?
- Continue with the successful spawns only?
```
```

---

## API Contract Details

### POST `/api/spawn-super`

**Request:**
```json
{
  "sourceAgentId": "myproject-abc123",
  "spawns": [
    {
      "plan": "Fix the authentication bug in login flow",
      "workflowId": "debug-workflow",
      "shortName": "fix-auth"
    },
    {
      "plan": "Add user profile caching",
      "shortName": "add-cache"
    }
  ]
}
```

**Response (Success):**
```json
{
  "success": true,
  "batchId": "batch-1706400000000",
  "results": [
    {
      "success": true,
      "agentId": "myproject-xyz789",
      "workflowId": "debug-workflow"
    },
    {
      "success": true,
      "agentId": "myproject-def456",
      "workflowId": "default"
    }
  ],
  "totalRequested": 2,
  "totalSucceeded": 2,
  "totalFailed": 0
}
```

**Response (Partial Failure):**
```json
{
  "success": false,
  "batchId": "batch-1706400000000",
  "results": [
    {
      "success": true,
      "agentId": "myproject-xyz789",
      "workflowId": "debug-workflow"
    },
    {
      "success": false,
      "error": "Failed to create worktree: git error"
    }
  ],
  "totalRequested": 2,
  "totalSucceeded": 1,
  "totalFailed": 1
}
```

**Error Codes:**
- `400` - Invalid request (missing fields, validation error)
- `404` - Source agent not found
- `500` - Internal server error
- `503` - Service not ready

---

## Testing Strategy

### Unit Tests (80%+ Coverage Target)

**File: `gui/src/main/services/__tests__/SpawnSuperApi.test.ts`**

| Test Case | Description |
|-----------|-------------|
| `validateSpawnSuperRequest` | Validate all required fields |
| `validateSpawnSuperRequest` | Reject empty spawns array |
| `validateSpawnSuperRequest` | Accept optional workflowId |
| `detectWorkflow` | Return debug-workflow for debug keywords |
| `detectWorkflow` | Return default for normal prompts |
| `detectWorkflow` | Be case-insensitive |
| `handleSpawnSuper` | Success with single spawn |
| `handleSpawnSuper` | Success with multiple spawns |
| `handleSpawnSuper` | Handle partial failures |
| `handleSpawnSuper` | Return per-spawn errors |
| `handleSpawnSuper` | Send IPC events on completion |

**File: `gui/src/main/services/__tests__/AgentService.spawnSuper.test.ts`**

| Test Case | Description |
|-----------|-------------|
| `spawnSuperMinion` | Create fresh worktree from main |
| `spawnSuperMinion` | Set isSuperMinion flag |
| `spawnSuperMinion` | Set spawnSource metadata |
| `spawnSuperMinion` | Use specified workflowId |
| `spawnSuperMinion` | Auto-generate branch name |
| `spawnSuperMinion` | Handle git errors gracefully |

**File: `gui/src/main/services/__tests__/WorkflowService.detection.test.ts`**

| Test Case | Description |
|-----------|-------------|
| `detectWorkflowFromPlan` | Debug keywords return debug-workflow |
| `detectWorkflowFromPlan` | Normal text returns default |
| `detectWorkflowFromPlan` | Multiple keywords in text |
| `detectWorkflowFromPlan` | Case insensitivity |

### E2E Tests

**File: `gui/e2e/spawn-super.e2e.ts`**

| Test Case | Description |
|-----------|-------------|
| Sidebar appearance | New agents appear within 2 seconds |
| Workflow badge | Badge shows correct workflow name |
| Spawn source indicator | Shows parent agent lineage |
| Batch notification | Toast shows spawn summary |

---

## Implementation Sequence

### Phase 1: Core API (Backend)
1. Add types to `ProjectConfig.ts`
2. Implement `WorkflowService.detectWorkflowFromPlan()`
3. Implement `AgentService.spawnSuperMinion()`
4. Add `/api/spawn-super` endpoint to `HandoffApiService`
5. Wire up IPC handlers in `index.ts`
6. Add preload API methods

### Phase 2: UX Session (Agent-side)
1. Create `/super-handoff` skill file
2. Test natural language recognition
3. Verify AskUserQuestion flow

### Phase 3: GUI Updates
1. Update Sidebar for spawn source display
2. Add workflow badge component
3. Add CSS styles
4. Implement batch spawn notification

### Phase 4: Testing
1. Write unit tests for new methods
2. Write E2E tests for GUI updates
3. Integration testing with real Claude sessions

---

## Security Considerations

- API binds to `127.0.0.1` only (same as existing `/api/handoff`)
- No authentication required (localhost-only security model)
- Validate all request fields before processing
- Sanitize branch names for filesystem safety
- Rate limiting not required (localhost only)

---

## Error Handling Matrix

| Error Type | HTTP Code | Error Message | Suggested Fix |
|------------|-----------|---------------|---------------|
| Missing sourceAgentId | 400 | "Missing required field: sourceAgentId" | Provide source agent ID |
| Empty spawns array | 400 | "spawns array must not be empty" | Add at least one spawn |
| Too many spawns | 400 | "Maximum 10 spawns per request" | Split into multiple requests |
| Missing plan | 400 | "Each spawn must have a plan" | Add plan to spawn |
| Invalid workflowId | 400 | "Workflow 'X' not found" | Use valid workflow ID |
| Source agent not found | 404 | "Source agent 'X' not found" | Check agent ID |
| Git worktree error | 500 (per-spawn) | "Failed to create worktree: {details}" | Check git state |
| Service not ready | 503 | "Service not ready" | Wait for initialization |

---

## Critical Files Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `gui/src/main/services/HandoffApiService.ts` | Modify | Add `/api/spawn-super` endpoint |
| `gui/src/main/services/AgentService.ts` | Modify | Add `spawnSuperMinion()` method |
| `gui/src/main/services/types/ProjectConfig.ts` | Modify | Add spawn-related types |
| `gui/src/main/services/WorkflowService.ts` | Modify | Add `detectWorkflowFromPlan()` |
| `gui/src/main/index.ts` | Modify | Add IPC handlers |
| `gui/src/preload/index.ts` | Modify | Add preload APIs |
| `gui/src/renderer/src/components/Sidebar.tsx` | Modify | Add spawn UI elements |
| `gui/src/renderer/src/components/Sidebar.css` | Modify | Add styles |
| `gui/src/main/services/NotificationService.ts` | Modify | Add batch notification |
| `gui/resources/minions/rules/super-handoff.md` | Create | New skill file |
| `gui/src/main/services/__tests__/SpawnSuperApi.test.ts` | Create | Unit tests |
| `gui/src/main/services/__tests__/AgentService.spawnSuper.test.ts` | Create | Unit tests |
| `gui/e2e/spawn-super.e2e.ts` | Create | E2E tests |
