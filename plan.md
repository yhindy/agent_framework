# Base Branch Agent Implementation Plan

**Status**: In Progress - Phases 1-2 Complete, Phases 3-7 Remaining

## Summary
Implementing a persistent "base branch agent" for each project that:
- Auto-creates when projects are added
- Always appears at top of agent list with special icon (🏠)
- Cannot be deleted/cleaned up (no cleanup UI)
- Works directly in main project directory (no worktree)
- Supports full features: Claude terminal, plain terminals, test environments

## Completed Work

### Phase 1: Core Data Model ✅
**Files Modified:**
1. `gui/src/main/services/types/ProjectConfig.ts`
   - Added `isBaseBranchAgent?: boolean` to AgentInfo interface (line 20)

2. `gui/src/main/services/AgentService.ts`
   - Updated AgentSession interface to include `isBaseBranchAgent?: boolean` (line 22)
   - Modified `listAgents()` (lines 56-143) to:
     - Read base agent from `.minions-base-info` file at start
     - Include base agent in sessions and results
     - Set `isBaseBranchAgent: true` flag in sessions
   - Added `ensureBaseBranchAgent(projectPath: string): Promise<AgentInfo>` (lines 977-1018)
     - Creates base agent with ID format: `{projectName}-base`
     - Stores metadata in `.minions-base-info` JSON file
     - Detects base branch via `getDefaultBranch()`
     - Idempotent (safe to call multiple times)
     - Recreates if file is corrupted
   - Added `isBaseBranchAgentMissing(projectPath: string): boolean` (lines 1020-1033)
     - Detects if base agent needs to be created
   - Added `getAgentPath(projectPath: string, agentInfo: AgentInfo): string` (lines 1035-1048)
     - Returns `projectPath` if `isBaseBranchAgent`
     - Returns worktree path for regular agents

### Phase 2: Project Integration ✅
**Files Modified:**

1. `gui/src/main/services/ProjectService.ts`
   - Added import for AgentService (line 5)
   - Updated constructor to accept optional AgentService (lines 24-39)
   - Added `setAgentService()` method for later injection
   - Modified `selectProject()` to async (line 58)
   - Modified `addProject()` to async (line 62) and added:
     - Call to `ensureBaseBranchAgent()` after project added (lines 116-123)
     - Only runs if `!needsInstall` (framework already installed)
   - Modified `installFramework()` (lines 177-248):
     - Updated gitignore to include `.minions-base-info` (line 227)
     - Added call to `ensureBaseBranchAgent()` after installation (lines 244-252)

2. `gui/src/main/index.ts`
   - Modified `initializeServices()` (lines 56-68):
     - Create AgentService first
     - Pass to ProjectService constructor
     - Set up dependency injection properly
   - Updated `project:select` handler to `await addProject()` (line 101)
   - Updated `project:add` handler to `await addProject()` (line 118)
   - Updated `project:install` handler to `await addProject()` (line 164)

## Remaining Work

### Phase 3: Path Resolution Updates
**Files to Modify:**

1. `gui/src/main/services/TerminalService.ts`
   - Location: `startAgent()` method (around line 134)
   - Change: Before spawning PTY, fetch agent info and check `isBaseBranchAgent`
   - If base agent: use `projectPath` directly
   - Otherwise: use existing worktree logic
   - Same logic for `startPlainTerminal()` (around line 406)
   - Use the `getAgentPath()` helper method from AgentService

2. `gui/src/main/services/TestEnvService.ts`
   - Location: `startCommand()` method
   - Change: Resolve path using `getAgentPath()` helper
   - Use `projectPath` for base agents, worktree for others

### Phase 4: UI Updates
**Files to Modify:**

1. `gui/src/renderer/src/components/Sidebar.tsx`
   - Update sorting logic (around line 286):
     - Add check: if `a.isBaseBranchAgent` return -1, if `b.isBaseBranchAgent` return 1
     - Keeps base agent at top before waiting agents
   - Update icon rendering (around line 208):
     - Change from `🍌` to `🏠` when `agent.isBaseBranchAgent`
   - Update label display:
     - Show `{branch} (Base)` instead of agent ID for base agents
   - Add CSS class `base-branch` to agent item for base agents

2. `gui/src/renderer/src/components/Sidebar.css`
   - Add new styles:
     ```css
     .agent-item.base-branch {
       background: #f0f8ff;
       border-left: 3px solid #4a90e2;
     }
     ```

3. `gui/src/renderer/src/components/AgentView.tsx`
   - Hide cleanup dropdown (line 475):
     - Wrap with `{assignment && !assignment.isBaseBranchAgent && (...)}`
   - Hide PR button (line 465):
     - Wrap with `{assignment && !assignment.isBaseBranchAgent && assignment.status !== 'pr_open' && (...)}`

### Phase 5: IPC Guards
**File to Modify:**

1. `gui/src/main/index.ts`
   - In `agents:teardown` handler:
     - Add guard before teardown logic:
     ```typescript
     if (agent?.isBaseBranchAgent) {
       throw new Error('Cannot teardown base branch agent')
     }
     ```
   - In any other agent cleanup handlers:
     - Add similar guards to prevent cleanup of base agents

### Phase 6: Auto-Recreation Logic
**Files to Modify:**

1. `gui/src/main/services/ProjectService.ts`
   - In `switchProject()` method:
     - After switching, call `ensureBaseBranchAgent(projectPath)`
     - Ensures base agent exists if missing

2. `gui/src/main/index.ts`
   - In `project:switch` handler:
     - Add verification that base agent exists

### Phase 7: Automated Testing
**Test Files to Create/Update:**

1. Create `gui/src/main/services/__tests__/BaseBranchAgent.test.ts`
   - Tests for `ensureBaseBranchAgent()` creation
   - Tests for idempotency
   - Tests for corrupted file recovery
   - Tests for agent ID format
   - Tests for base branch detection

2. Update `gui/src/main/services/__tests__/ProjectService.test.ts`
   - Test base agent creation on project add
   - Test gitignore includes `.minions-base-info`
   - Test base agent recreation on project switch

3. Update `gui/src/main/services/__tests__/TerminalService.test.ts`
   - Test terminal in main directory for base agent
   - Test terminal in worktree for regular agent

4. Update `gui/src/renderer/src/components/__tests__/Sidebar.test.tsx`
   - Test base agent renders with home icon
   - Test base agent appears at top
   - Test base agent label shows "{branch} (Base)"

## Data Model
- **Agent ID**: `{projectName}-base` (e.g., `agent_framework-base`)
- **Storage**: `.minions-base-info` JSON file in project root
- **Worktree**: None - works directly in `projectPath`
- **Flag**: `isBaseBranchAgent: true` in AgentInfo and AgentSession

## Testing Checklist

### Automated Tests
- [ ] BaseBranchAgent.test.ts created with full coverage
- [ ] ProjectService.test.ts updated
- [ ] TerminalService.test.ts updated
- [ ] Sidebar.test.tsx updated
- [ ] All tests passing
- [ ] No regressions in existing tests

### Manual Integration Tests
- [ ] Add new project → base agent created
- [ ] Base agent shows with 🏠 icon
- [ ] Base agent at top of list
- [ ] Terminal in base agent works in main directory
- [ ] Plain terminals work
- [ ] Test environments work
- [ ] No cleanup button visible
- [ ] No PR button visible
- [ ] Cannot teardown base agent
- [ ] Delete `.minions-base-info` → auto-recreates on project switch
- [ ] Multiple projects each have own base agent
- [ ] Framework installation creates base agent

## Implementation Notes

### Key Design Decisions
1. **No worktree**: Base agent works directly in `projectPath` for simplicity and immediate visibility
2. **Separate storage**: Uses `.minions-base-info` instead of `.agent-info` to keep base metadata separate
3. **Idempotent creation**: Safe to call `ensureBaseBranchAgent()` multiple times
4. **Auto-recreation**: Base agent always available, recreated if missing
5. **No cleanup**: Base agents cannot be deleted via UI or code

### Backward Compatibility
- Existing agents continue using worktrees unchanged
- Optional `isBaseBranchAgent` flag on AgentInfo (backward compatible)
- No breaking changes to existing functionality

## Files Summary
| File | Phase | Status |
|------|-------|--------|
| ProjectConfig.ts | 1 | ✅ Complete |
| AgentService.ts | 1-2 | ✅ Complete |
| ProjectService.ts | 2 | ✅ Complete |
| index.ts | 2 | ✅ Complete |
| TerminalService.ts | 3 | ⏳ Pending |
| TestEnvService.ts | 3 | ⏳ Pending |
| Sidebar.tsx | 4 | ⏳ Pending |
| Sidebar.css | 4 | ⏳ Pending |
| AgentView.tsx | 4 | ⏳ Pending |
| *.test.ts/*.test.tsx | 7 | ⏳ Pending |

## Next Steps
1. Continue with Phase 3: Update TerminalService path resolution
2. Complete Phase 4: UI updates in Sidebar and AgentView
3. Add Phase 5: IPC guards
4. Implement Phase 6: Auto-recreation logic
5. Create Phase 7: Comprehensive tests
6. Run full test suite
7. Manual integration testing
