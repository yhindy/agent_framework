# Terminal Memory & Focus Restoration Plan

## Problem Statement

Currently, when navigating away from an agent view and returning:
1. **Terminal tabs are lost** - Any plain terminals beyond the first one are not recreated
2. **Active tab selection is lost** - Always defaults to 'agent' or 'orchestration' tab
3. **Focus is not restored** - The user must manually click to focus the terminal they were using
4. **Test environment tabs are lost** - Need to manually switch back if a test env was active

This creates a poor user experience where navigation disrupts workflow state.

## Current Architecture Analysis

### Backend State (Persistent)
✅ **Terminal Sessions** (`TerminalService.ts`)
- Backend PTY processes persist in `terminals` and `plainTerminals` Maps
- Sessions continue running even when UI unmounts
- Full terminal ID format: `${agentId}-${terminalId}` (e.g., `agent-123-terminal-2`)

✅ **Output Cache** (Frontend globals)
- `outputCache` Maps in `Terminal.tsx`, `PlainTerminal.tsx`, `TestEnvTerminal.tsx`
- Survives component unmount/remount
- Replayed on terminal mount (lines 106-112 in Terminal.tsx)

✅ **Agent Session** (`AgentService.ts`)
- `.agent-info` JSON file in each worktree
- Currently stores: `claudeSessionId`, `isWaitingForInput`, `lastActivity`, etc.

### Frontend State (Volatile - Gets Lost)
❌ **Tab State** (`AgentView.tsx`)
- `activeTab` (line 52) - defaults to `'agent'`
- `plainTerminals` (line 56) - defaults to `['terminal-1']`
- `terminalCounter` (line 57) - defaults to `1`
- `testEnvStatuses` - loaded fresh each time

❌ **SuperAgentView State** (`SuperAgentView.tsx`)
- `activeTab` (line 28) - defaults to `'orchestration'`
- `plainTerminals` (line 29) - defaults to `[]`
- `terminalCounter` (line 30) - defaults to `0`

## Solution Design

### 1. Persistence Layer

**Storage Location**: Extend `.agent-info` JSON file with UI state

**New Fields**:
```typescript
interface AgentInfo {
  // ... existing fields

  // NEW: UI state preservation
  uiState?: {
    lastActiveTab: string          // e.g., 'agent', 'terminal-2', 'test-dev'
    plainTerminals: string[]       // e.g., ['terminal-1', 'terminal-2', 'terminal-5']
    terminalCounter: number        // e.g., 5 (for next terminal ID)
    lastFocusTime: string          // ISO timestamp
  }
}
```

**Alternative Storage**: `.agent-ui-state.json` (separate file)
- Pros: Keeps UI concerns separate from agent metadata
- Cons: Additional file to manage
- **Decision**: Use `.agent-info` for simplicity (UI state is lightweight)

### 2. Backend Changes

#### File: `AgentService.ts`

**Update TypeScript interface** (around line 11):
```typescript
interface AgentSession {
  // ... existing fields
  uiState?: {
    lastActiveTab: string
    plainTerminals: string[]
    terminalCounter: number
    lastFocusTime: string
  }
}
```

**New method: Save UI state**
```typescript
async saveUIState(
  projectPath: string,
  agentId: string,
  uiState: AgentSession['uiState']
): Promise<void> {
  const agents = await this.listAgents(projectPath)
  const agent = agents.find(a => a.id === agentId)
  if (!agent) throw new Error('Agent not found')

  this.updateAgentInfo(agent.worktreePath, {
    uiState,
    lastActivity: new Date().toISOString()
  })
}
```

**Ensure `readAgentInfo` preserves `uiState`** (line 211)
- Already returns full JSON object, so `uiState` will be included automatically

#### File: `TerminalService.ts`

**Track plain terminal creation** (line 573-664)
- Already generates deterministic session IDs
- No changes needed - backend already persists everything

#### File: `gui/src/preload/index.ts` (IPC bridge)

**Add new IPC handlers**:
```typescript
// Save UI state
ipcRenderer.invoke('save-ui-state', agentId, uiState)

// Already exists: listAgentsForProject returns full AgentSession with uiState
```

### 3. Frontend Changes

#### File: `AgentView.tsx`

**Phase 1: State Restoration on Mount**

**Update `loadAgentData` function** (line 121):
```typescript
const loadAgentData = async () => {
  if (!agentId) return

  // ... existing code to find agent ...

  setAgent(agentData)
  setAssignment(assignmentData)

  if (assignmentData) {
    setCurrentTool(assignmentData.tool)
    setCurrentModel(assignmentData.model || 'opus')
    setCurrentMode(assignmentData.mode)
  }

  // NEW: Restore UI state
  if (agentData?.uiState) {
    setActiveTab(agentData.uiState.lastActiveTab)
    setPlainTerminals(agentData.uiState.plainTerminals)
    setTerminalCounter(agentData.uiState.terminalCounter)
  }
}
```

**Phase 2: State Persistence on Change**

**Debounced save function**:
```typescript
// At top of component
const saveUIStateDebounced = useRef(
  debounce(async (agentId: string, uiState: any) => {
    try {
      await window.electronAPI.saveUIState(agentId, uiState)
    } catch (err) {
      console.error('Failed to save UI state:', err)
    }
  }, 1000) // Save 1 second after last change
).current

// Cleanup on unmount
useEffect(() => {
  return () => {
    saveUIStateDebounced.cancel()
  }
}, [])
```

**Watch state changes**:
```typescript
useEffect(() => {
  if (!agentId) return

  const uiState = {
    lastActiveTab: activeTab,
    plainTerminals,
    terminalCounter,
    lastFocusTime: new Date().toISOString()
  }

  saveUIStateDebounced(agentId, uiState)
}, [activeTab, plainTerminals, terminalCounter, agentId])
```

**Phase 3: Focus Restoration**

**Add ref to track terminal mount**:
```typescript
const terminalMountedRef = useRef(false)
```

**Pass focus flag to Terminal components**:
```typescript
{activeTab === 'agent' && (
  agentId && <Terminal
    agentId={agentId}
    autoFocus={!terminalMountedRef.current}
    onMount={() => { terminalMountedRef.current = true }}
  />
)}
```

#### File: `Terminal.tsx`, `PlainTerminal.tsx`, `TestEnvTerminal.tsx`

**Add autoFocus prop**:
```typescript
interface TerminalProps {
  agentId: string
  terminalId?: string  // For PlainTerminal
  autoFocus?: boolean  // NEW
  onMount?: () => void // NEW
}
```

**Auto-focus logic** (in useEffect after terminal initialization):
```typescript
useEffect(() => {
  // ... existing terminal setup ...

  // NEW: Auto-focus if requested
  if (props.autoFocus && terminal) {
    setTimeout(() => {
      terminal.focus()
      terminal.scrollToBottom()
    }, 100) // Small delay to ensure DOM is ready
  }

  // Call mount callback
  props.onMount?.()
}, [terminal, props.autoFocus])
```

#### File: `SuperAgentView.tsx`

**Same changes as AgentView.tsx**:
1. Restore UI state from `agent.uiState` in `loadAgent` (line 48)
2. Add debounced save on state changes
3. Pass `autoFocus` to terminal components

### 4. Additional Improvements

#### Prevent Tab Flicker
- Don't render terminal containers until state is loaded
- Add loading flag: `const [isUIStateLoaded, setIsUIStateLoaded] = useState(false)`

#### Handle Edge Cases
1. **Terminal no longer exists**: If `lastActiveTab` points to deleted terminal, fallback to 'agent'
2. **Test env stopped**: If test env was active but is now stopped, fallback to 'orchestration'
3. **Counter sync**: Ensure `terminalCounter` is always >= highest terminal number

```typescript
// Validation in loadAgentData
if (agentData?.uiState) {
  const { lastActiveTab, plainTerminals, terminalCounter } = agentData.uiState

  // Validate tab exists
  const validTabs = ['agent', ...plainTerminals, ...testEnvCommands.map(c => c.id)]
  const restoredTab = validTabs.includes(lastActiveTab) ? lastActiveTab : 'agent'

  // Ensure counter is valid
  const maxTerminalNum = Math.max(
    ...plainTerminals.map(id => parseInt(id.split('-')[1]) || 0),
    0
  )
  const restoredCounter = Math.max(terminalCounter, maxTerminalNum)

  setActiveTab(restoredTab)
  setPlainTerminals(plainTerminals)
  setTerminalCounter(restoredCounter)
}
```

#### Debounce Utility
```typescript
// utils/debounce.ts
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T & { cancel: () => void } {
  let timeout: NodeJS.Timeout | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }

  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout)
  }

  return debounced as T & { cancel: () => void }
}
```

## Implementation Phases

### Phase 1: Backend Foundation (1 file)
- [ ] Update `AgentService.ts` TypeScript interfaces
- [ ] Add `saveUIState` method
- [ ] Update IPC handlers in `main/index.ts` and `preload/index.ts`

### Phase 2: Frontend Restoration (3 files)
- [ ] Create debounce utility
- [ ] Update `AgentView.tsx` - restore state on mount
- [ ] Update `SuperAgentView.tsx` - restore state on mount
- [ ] Add validation/edge case handling

### Phase 3: Frontend Persistence (2 files)
- [ ] Add debounced save to `AgentView.tsx`
- [ ] Add debounced save to `SuperAgentView.tsx`

### Phase 4: Focus Enhancement (3 files)
- [ ] Update `Terminal.tsx` with autoFocus
- [ ] Update `PlainTerminal.tsx` with autoFocus
- [ ] Update `TestEnvTerminal.tsx` with autoFocus

### Phase 5: Polish
- [ ] Prevent tab flicker with loading state
- [ ] Test all edge cases
- [ ] Add console logging for debugging
- [ ] Remove debug logs before final commit

## Automated Testing Plan

### Unit Tests

#### Backend Tests (`AgentService.test.ts`)

**Test Suite: UI State Persistence**
1. `saveUIState` method
   - ✓ Should save UI state to .agent-info file
   - ✓ Should update lastActivity timestamp
   - ✓ Should throw error if agent not found
   - ✓ Should merge with existing agent info without overwriting other fields

2. `readAgentInfo` method
   - ✓ Should return uiState when present in .agent-info
   - ✓ Should return undefined uiState when not present (backward compatibility)
   - ✓ Should handle malformed uiState gracefully

**Test Suite: Edge Cases**
1. Multiple concurrent saves
   - ✓ Should not corrupt data with race conditions
   - ✓ Should use atomic file writes

2. Migration scenarios
   - ✓ Should work with old .agent-info files lacking uiState
   - ✓ Should preserve uiState during assignment updates

#### Frontend Tests (`AgentView.test.tsx`)

**Test Suite: State Restoration**
1. On mount with saved UI state
   - ✓ Should restore lastActiveTab
   - ✓ Should restore plainTerminals array
   - ✓ Should restore terminalCounter

2. On mount without saved UI state
   - ✓ Should use default values (agent tab, ['terminal-1'], counter 1)

3. Edge case handling
   - ✓ Should fallback to 'agent' if lastActiveTab doesn't exist
   - ✓ Should validate terminalCounter against plainTerminals
   - ✓ Should handle empty plainTerminals array

**Test Suite: State Persistence**
1. Debounced saving
   - ✓ Should save after 1 second of inactivity
   - ✓ Should cancel pending save on rapid changes
   - ✓ Should save final state on unmount

2. State changes trigger save
   - ✓ Changing activeTab should trigger save
   - ✓ Adding terminal should trigger save
   - ✓ Closing terminal should trigger save

**Test Suite: Focus Restoration**
1. Auto-focus behavior
   - ✓ Should focus terminal when autoFocus=true
   - ✓ Should scroll to bottom on focus
   - ✓ Should only auto-focus on first mount
   - ✓ Should not auto-focus when user navigates to different tab

### Integration Tests

#### Test Suite: Navigation Flow (`navigation.integration.test.tsx`)

**Setup**: Create test agent with multiple terminals and test environments

1. **Full navigation cycle**
   ```typescript
   test('should preserve terminal state across navigation', async () => {
     // 1. Navigate to agent view
     // 2. Add 2 plain terminals (terminal-1, terminal-2, terminal-3)
     // 3. Switch to terminal-2
     // 4. Navigate away to dashboard
     // 5. Navigate back to agent view
     // 6. Assert: activeTab === 'terminal-2'
     // 7. Assert: plainTerminals === ['terminal-1', 'terminal-2', 'terminal-3']
     // 8. Assert: terminal-2 is focused in DOM
   })
   ```

2. **Test environment preservation**
   ```typescript
   test('should restore test environment tab', async () => {
     // 1. Navigate to agent view
     // 2. Start test environment 'dev'
     // 3. Switch to 'dev' tab
     // 4. Navigate away
     // 5. Navigate back
     // 6. Assert: activeTab === 'dev'
     // 7. Assert: dev terminal is visible and focused
   })
   ```

3. **Cross-agent navigation**
   ```typescript
   test('should maintain separate state per agent', async () => {
     // 1. Create 2 agents: agent-A, agent-B
     // 2. Navigate to agent-A, set active tab to 'terminal-2'
     // 3. Navigate to agent-B, set active tab to 'terminal-1'
     // 4. Navigate back to agent-A
     // 5. Assert: activeTab === 'terminal-2' (not affected by agent-B)
     // 6. Navigate to agent-B
     // 7. Assert: activeTab === 'terminal-1'
   })
   ```

4. **SuperAgent view**
   ```typescript
   test('should preserve SuperAgent terminal state', async () => {
     // 1. Navigate to super agent view
     // 2. Add plain terminal, switch to it
     // 3. Navigate to child agent
     // 4. Navigate back to super agent
     // 5. Assert: plain terminal is restored and active
   })
   ```

### End-to-End Tests (Playwright/Cypress)

#### Test Suite: User Workflows

1. **Multi-terminal workflow**
   ```typescript
   test('user can resume work in correct terminal', async () => {
     // 1. User creates agent
     // 2. User adds 3 terminals
     // 3. User types commands in terminal-2
     // 4. User switches to terminal-3, types more commands
     // 5. User navigates to dashboard
     // 6. User navigates back to agent
     // 7. Verify: terminal-3 is active and focused
     // 8. Verify: All 3 terminals exist in tabs
     // 9. Verify: Terminal history is preserved (check xterm buffer)
   })
   ```

2. **Focus follows navigation intent**
   ```typescript
   test('focus respects last user action, not most recent agent', async () => {
     // Scenario: User works on agent-A, then views agent-B briefly, then returns to agent-A
     // 1. Navigate to agent-A, switch to terminal-5
     // 2. Type some commands
     // 3. Navigate to agent-B (don't switch tabs, leave on default)
     // 4. Navigate back to agent-A
     // 5. Verify: terminal-5 is active and focused (NOT agent tab)
   })
   ```

3. **Persistence across app restart** (if applicable)
   ```typescript
   test('state persists after app restart', async () => {
     // 1. Set up agent with specific terminal state
     // 2. Close Electron app
     // 3. Restart app
     // 4. Navigate to agent
     // 5. Verify: UI state is restored
   })
   ```

### Test Infrastructure Setup

#### Mocking Strategy
```typescript
// Mock electron API for unit tests
const mockElectronAPI = {
  listAgentsForProject: jest.fn(),
  saveUIState: jest.fn(),
  // ... other methods
}

// Mock timer for debounce tests
jest.useFakeTimers()
```

#### Test Fixtures
```typescript
// fixtures/agentData.ts
export const mockAgentWithUIState = {
  id: 'test-agent-1',
  // ... other fields
  uiState: {
    lastActiveTab: 'terminal-2',
    plainTerminals: ['terminal-1', 'terminal-2', 'terminal-3'],
    terminalCounter: 3,
    lastFocusTime: '2025-01-15T10:30:00.000Z'
  }
}

export const mockAgentWithoutUIState = {
  id: 'test-agent-2',
  // ... other fields
  // uiState: undefined (testing backward compatibility)
}
```

#### Coverage Goals
- **Backend (AgentService)**: 95%+ coverage
  - All new methods tested
  - Edge cases covered

- **Frontend (AgentView)**: 90%+ coverage
  - State restoration logic
  - Debounce behavior
  - Validation logic

- **Integration**: Critical paths
  - Navigation flow
  - Cross-agent state isolation
  - Focus behavior

### Continuous Testing
- Run unit tests on every commit (pre-commit hook)
- Run integration tests in CI/CD pipeline
- Run E2E tests before releases
- Monitor for regressions in terminal behavior

## Edge Cases & Considerations

### 1. Concurrent Tab Updates
**Scenario**: User rapidly switches tabs
**Solution**: Debounce saves, always use latest state

### 2. Stale State
**Scenario**: User deletes terminal in one session, opens another
**Solution**: Validate on load, fallback to safe defaults

### 3. Backend Terminal Cleanup
**Scenario**: Backend terminal was killed but UI state references it
**Solution**: Check terminal existence, auto-cleanup stale IDs

### 4. Super Agent Children
**Scenario**: User navigates to child, then back to super agent
**Solution**: Each agent has independent UI state, no conflicts

### 5. Performance
**Concern**: Frequent saves on every tab switch
**Solution**:
- Debounce (1 second)
- Only save on actual changes (use React dependency array)
- Lightweight payload (< 1KB JSON)

## Migration Strategy

### Backward Compatibility
- Old `.agent-info` files without `uiState` → use defaults
- No data loss for existing agents
- Gradual adoption as users navigate

### Rollout Plan
1. Deploy backend changes (supports new field, doesn't require it)
2. Deploy frontend changes (uses new field if present, works without)
3. Monitor for issues
4. No manual migration needed

## Success Metrics

### Functional Requirements
- ✅ Navigate away and back → exact same tabs visible
- ✅ Navigate away and back → same tab is active
- ✅ Navigate away and back → active terminal is focused
- ✅ Works for both AgentView and SuperAgentView
- ✅ Works for agent terminal, plain terminals, and test environments

### Non-Functional Requirements
- ⚡ No noticeable performance impact
- 📁 Minimal disk usage (< 1KB per agent)
- 🔄 No breaking changes to existing functionality
- 🧪 100% backward compatible

## Files to Modify

### Backend (3 files)
1. `gui/src/main/services/AgentService.ts` - Add uiState field, saveUIState method
2. `gui/src/main/index.ts` - Add IPC handler for saveUIState
3. `gui/src/preload/index.ts` - Expose saveUIState to renderer

### Frontend (6 files)
1. `gui/src/renderer/src/utils/debounce.ts` - NEW: Debounce utility
2. `gui/src/renderer/src/components/AgentView.tsx` - Restore & save state
3. `gui/src/renderer/src/components/SuperAgentView.tsx` - Restore & save state
4. `gui/src/renderer/src/components/Terminal.tsx` - Add autoFocus
5. `gui/src/renderer/src/components/PlainTerminal.tsx` - Add autoFocus
6. `gui/src/renderer/src/components/TestEnvTerminal.tsx` - Add autoFocus

### Testing (6+ files)
1. `gui/src/main/services/__tests__/AgentService.test.ts` - Backend unit tests
2. `gui/src/renderer/src/components/__tests__/AgentView.test.tsx` - Frontend unit tests
3. `gui/src/renderer/src/components/__tests__/SuperAgentView.test.tsx` - Frontend unit tests
4. `gui/src/__tests__/integration/navigation.test.tsx` - Integration tests
5. `gui/e2e/terminal-memory.spec.ts` - E2E tests (Playwright)
6. `gui/src/renderer/src/utils/__tests__/debounce.test.ts` - Debounce utility tests

**Total: 9 modified + 7 new test files = 16 files**

## Timeline Estimate

- **Phase 1 (Backend)**: 2-3 hours
- **Phase 2 (Restoration)**: 3-4 hours
- **Phase 3 (Persistence)**: 2-3 hours
- **Phase 4 (Focus)**: 2-3 hours
- **Phase 5 (Polish)**: 1-2 hours
- **Testing**: 4-6 hours (unit + integration + E2E)
- **Code Review & Fixes**: 2-3 hours

**Total**: ~16-24 hours of development + testing

## Risk Assessment

### Low Risk
- ✅ Non-breaking change (purely additive)
- ✅ Backend already supports terminal persistence
- ✅ UI state is optional (defaults work if missing)

### Medium Risk
- ⚠️ Focus behavior may need browser-specific tweaks
- ⚠️ Debounce timing needs tuning for UX

### Mitigation
- Feature flag: Add `ENABLE_TERMINAL_MEMORY` config
- Gradual rollout: Enable for internal testing first
- Fallback: If errors occur, log and use defaults

## Future Enhancements

1. **Cross-session persistence** - Survive app restarts
2. **Scroll position** - Remember scroll position in each terminal
3. **Input history** - Preserve command history per terminal
4. **Split panes** - Support multiple terminals visible at once
5. **Terminal naming** - Let users name terminals instead of "Terminal 1, 2, 3"

---

## Appendix: Code Snippets

### TypeScript Interface Extension
```typescript
// Add to gui/src/main/services/types/ProjectConfig.ts
export interface AgentInfo {
  // ... existing fields
  uiState?: {
    lastActiveTab: string
    plainTerminals: string[]
    terminalCounter: number
    lastFocusTime: string
  }
}
```

### IPC Handler
```typescript
// Add to gui/src/main/index.ts
ipcMain.handle('save-ui-state', async (_, agentId: string, uiState: any) => {
  const projectPath = // ... find project path
  await agentService.saveUIState(projectPath, agentId, uiState)
})
```

### Preload Exposure
```typescript
// Add to gui/src/preload/index.ts
const electronAPI = {
  // ... existing methods
  saveUIState: (agentId: string, uiState: any) =>
    ipcRenderer.invoke('save-ui-state', agentId, uiState)
}
```
