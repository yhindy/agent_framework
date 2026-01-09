# Plan: Add `--chrome` as Default Parameter to All Claude Sessions

## Overview
Add `--chrome` as a default parameter that gets passed to all Claude sessions when they are spawned. This parameter needs to be integrated into the existing parameter passing architecture.

**Implementation approach:** Always enabled by default with a UI checkbox toggle (similar to the yolo checkbox)

## UI Mockup

The chrome checkbox will appear in the Dashboard form, below the yolo checkbox:

```
┌─────────────────────────────────────────┐
│  Tool: [Claude ▼]                       │
│                                         │
│  ☑ Yolo mode 🔥                        │
│    Automatically approve edits and      │
│    run commands without confirmation.   │
│    Don't say I didn't warn you!         │
│                                         │
│  ☑ Chrome integration 🌐                │
│    Enable Chrome browser automation     │
│    and web interaction capabilities.    │
│                                         │
│  [Create Agent]                         │
└─────────────────────────────────────────┘
```

**Default state:** Both checkboxes checked
**Conditional rendering:** Only appears when tool is "claude" (not cursor/cursor-cli)

## Current Architecture Summary

### Session Creation Flow
```
IPC Handler → AgentService → TerminalService → Claude CLI
```

**Key Files:**
- `src/services/TerminalService.ts` - Session spawning and parameter building (`getClaudeArgs()` method at lines 417-464)
- `src/services/AgentService.ts` - Agent configuration and persistence
- `.agent-info` files - Store persistent agent configuration per worktree
- `minions/config.json` - Project-level configuration

### Current Parameter Passing
Parameters are built in `TerminalService.getClaudeArgs()` and include:
- `--model` (optional: haiku, opus, sonnet)
- `--permission-mode` (plan or acceptEdits)
- `--system-prompt-file` (for planning agents)
- `--dangerously-skip-permissions` (when yolo=true)
- `--session-id` / `--resume` (for session management)

## Implementation Plan

### 1. Update AgentInfo Interface

**File:** `gui/src/main/services/types/ProjectConfig.ts`

**Location:** AgentInfo interface (around line 20)

**Change:**
```typescript
export interface AgentInfo {
  // ... existing fields
  model?: string;
  mode: 'planning' | 'dev';
  yolo?: boolean;              // Dangerously skip permissions flag
  chrome?: boolean;            // ADD: Enable Chrome integration (default: true)
  isBaseBranchAgent?: boolean;
  // ...
}
```

### 2. Add Chrome Checkbox to UI

**File:** `gui/src/renderer/src/components/Dashboard.tsx`

#### 2a. Update Form State

**Location:** useState initialization (lines 75-87)

**Change:**
```typescript
const [formData, setFormData] = useState({
  projectPath: '',
  agentId: '',
  shortName: '',
  prompt: '',
  tool: 'claude',
  model: 'opusplan',
  mode: 'planning',
  status: 'pending',
  yolo: true,
  chrome: true,    // ADD: Default to true (always on)
  isSuper: false,
  minionBudget: 3
})
```

#### 2b. Add Chrome Checkbox in Form

**Location:** After yolo checkbox (after line 751)

**Change:**
```tsx
{formData.tool === 'claude' && (
  <>
    {/* Existing yolo checkbox */}
    <div className="form-group checkbox-group">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={formData.yolo}
          onChange={(e) => setFormData({ ...formData, yolo: e.target.checked })}
        />
        <span className="checkbox-text">Yolo mode 🔥</span>
      </label>
      <div className="form-hint">
        Automatically approve edits and run commands without confirmation. Don't say I didn't warn you!
      </div>
    </div>

    {/* ADD: Chrome checkbox */}
    <div className="form-group checkbox-group">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={formData.chrome}
          onChange={(e) => setFormData({ ...formData, chrome: e.target.checked })}
        />
        <span className="checkbox-text">Chrome integration 🌐</span>
      </label>
      <div className="form-hint">
        Enable Chrome browser automation and web interaction capabilities.
      </div>
    </div>
  </>
)}
```

#### 2c. Pass Chrome to Backend

**Location:** handleCreateAssignment function (lines 170-210)

**Change for regular agents (line 200-209):**
```typescript
result = await window.electronAPI.createAssignmentForProject(projectPath, {
  branch: formData.shortName,
  feature,
  tool: formData.tool,
  model: formData.model,
  prompt: formData.prompt,
  mode: formData.mode,
  status: 'in_progress',
  yolo: formData.yolo,
  chrome: formData.chrome  // ADD: Pass chrome flag
})
```

**Change for super agents (line 189-198):**
```typescript
result = await window.electronAPI.createSuperAssignment(projectPath, {
  branch: formData.shortName,
  feature,
  minionBudget: formData.minionBudget,
  tool: formData.tool,
  model: formData.model,
  prompt: formData.prompt,
  status: 'in_progress',
  yolo: formData.yolo,
  chrome: formData.chrome  // ADD: Pass chrome flag
})
```

#### 2d. Reset Chrome After Submission

**Location:** After successful submission (around line 233)

**Change:**
```typescript
// Reset form after successful creation
setFormData({
  ...formData,
  shortName: '',
  prompt: '',
  yolo: false,
  chrome: true  // ADD: Reset to true (default on)
})
```

### 3. Update IPC Handlers

**File:** `gui/src/main/index.ts`

#### 3a. Update createAssignmentForProject Handler

**Location:** Lines 506-537

**Change:**
```typescript
ipcMain.handle('assignments:createForProject', async (_event, projectPath: string, assignment: any) => {
  const result = await services!.agent.createAssignment(projectPath, assignment)

  // ... existing delay logic ...

  if (assignment.prompt && assignment.tool !== 'cursor' && ...) {
    setTimeout(async () => {
      try {
        await services!.terminal.startAgent(
          projectPath,
          result.agentId,
          assignment.tool,
          assignment.mode,
          assignment.prompt,
          assignment.model,
          assignment.yolo,
          assignment.chrome  // ADD: Pass chrome parameter
        )
      } catch (error) {
        console.error('Error starting agent:', error)
      }
    }, 500)
  }

  return result
})
```

#### 3b. Update createSuperAssignment Handler

**Location:** Lines 539-569

**Change:**
```typescript
ipcMain.handle('assignments:createSuper', async (_event, projectPath: string, assignment: any) => {
  const result = await services!.agent.createSuperAssignment(projectPath, assignment)

  // ... existing logic ...

  if (assignment.prompt && assignment.tool !== 'cursor') {
    setTimeout(async () => {
      try {
        await services!.terminal.startAgent(
          projectPath,
          result.agentId,
          assignment.tool,
          'planning',
          assignment.prompt,
          assignment.model,
          assignment.yolo || false,
          assignment.chrome !== false  // ADD: Pass chrome parameter (default true)
        )
      } catch (error) {
        console.error('Error starting super agent:', error)
      }
    }, 500)
  }

  return result
})
```

#### 3c. Update Resume Session Handler

**Location:** Line 176 (agent resume)

**Change:**
```typescript
await services!.terminal.startAgent(
  project.path,
  agent.id,
  agent.tool || 'claude',
  agent.mode || 'dev',
  agent.prompt,
  agent.model,
  agent.yolo || false,
  agent.chrome !== false  // ADD: Restore chrome flag (default true)
)
```

### 4. Update TerminalService

**File:** `gui/src/main/services/TerminalService.ts`

#### 4a. Update startAgent Method Signature

**Location:** Line 119

**Change:**
```typescript
async startAgent(
  projectPath: string,
  agentId: string,
  tool: 'claude' | 'cursor' | 'cursor-cli',
  mode: 'planning' | 'dev',
  prompt?: string,
  model?: string,
  yolo?: boolean,
  chrome?: boolean  // ADD: Chrome parameter
): Promise<void>
```

#### 4b. Update getClaudeArgs Method

**Location:** Lines 417-464

**Change:**
```typescript
private getClaudeArgs(
  agentInfo: AgentInfo,
  projectPath: string,
  systemPromptPath?: string
): string[] {
  const args: string[] = [];

  // Model
  if (agentInfo.model) {
    args.push('--model', agentInfo.model);
  }

  // ADD: Chrome flag (default true, only skip if explicitly false)
  if (agentInfo.chrome !== false) {
    args.push('--chrome');
  }

  // Permission mode
  if (agentInfo.mode === 'planning') {
    args.push('--permission-mode', 'plan');
  } else if (agentInfo.mode === 'dev') {
    args.push('--permission-mode', 'acceptEdits');
  }

  // YOLO mode
  if (agentInfo.yolo) {
    args.push('--dangerously-skip-permissions');
  }

  // ... rest of existing logic
}
```

#### 4c. Store Chrome in AgentInfo

**Location:** Within startAgent method, when creating/updating agentInfo (around line 150-180)

**Change:**
```typescript
// Read existing agent info
const agentInfo = await this.agentService.readAgentInfo(agentId, worktreePath);

// Update with chrome flag
agentInfo.chrome = chrome !== false;  // Default to true

// Save updated agent info
await this.agentService.writeAgentInfo(worktreePath, agentId, agentInfo);
```

### 5. Update AgentService

**File:** `gui/src/main/services/AgentService.ts`

#### 5a. Update createAssignment Method

**Location:** Lines 388-403

**Change:**
```typescript
const agentInfo: AgentInfo = {
  id: agentInfoId,
  agentId,
  branch: branchName,
  project: projectName,
  feature: assignment.feature,
  status: assignment.status as any || 'active',
  tool: assignment.tool || 'claude',
  mode: assignment.mode as any || 'auto',
  yolo: assignment.yolo,
  chrome: assignment.chrome !== false,  // ADD: Default to true
  // ... rest of fields
};
```

#### 5b. Update ensureBaseBranchAgent Method

**Location:** Lines 977-1018 (for base branch agents)

**Change:**
```typescript
const agentInfo: AgentInfo = {
  id: `${projectName}-base`,
  agentId: `${projectName}-base`,
  branch: baseBranch,
  project: projectName,
  feature: `Base branch agent for ${baseBranch}`,
  status: 'active',
  tool: 'claude',
  model: 'opus',
  mode: 'dev',
  chrome: true,  // ADD: Chrome enabled by default for base agents
  isBaseBranchAgent: true,
  // ... rest of fields
};
```

### 6. Handle Special Cases

**Considerations:**
- **Base branch agents** - Always get chrome enabled by default (see step 5b)
- **Planning vs Dev mode** - Chrome flag works with both permission modes
- **Resume sessions** - Chrome flag is restored from AgentInfo (defaults to true if missing)
- **Cursor/Cursor-CLI** - Chrome flag only applies to Claude tool
- **Backward compatibility** - Old agents without chrome field default to enabled

**Already handled in getClaudeArgs:**
```typescript
// Chrome flag defaults to true if not explicitly set to false
if (agentInfo.chrome !== false) {
  args.push('--chrome');
}
```

### 7. Update Documentation

**Files to update:**
- README.md - Document the new default behavior
- Any developer documentation about agent configuration
- Comments in code explaining the chrome flag purpose

**Documentation should include:**
- What the chrome flag does
- How to disable it (if configurable)
- Any requirements (e.g., Chrome needs to be installed)

---

## Automated Testing Plan

### Test Strategy

The testing strategy should cover:
1. **Unit tests** - Parameter building logic
2. **Integration tests** - End-to-end session creation with chrome flag
3. **Regression tests** - Ensure existing functionality isn't broken

### Test Cases

#### TC1: Chrome Flag Added by Default
**Test:** Verify `--chrome` is included in Claude args by default

**File:** `gui/src/main/services/__tests__/TerminalService.test.ts` (create if doesn't exist)

```typescript
describe('TerminalService.getClaudeArgs', () => {
  it('should include --chrome flag by default', () => {
    const terminalService = new TerminalService();
    const agentInfo: AgentInfo = {
      agentId: 'test-agent',
      tool: 'claude',
      mode: 'dev',
      prompt: 'test prompt'
    };

    const args = terminalService['getClaudeArgs'](agentInfo, '/test/path');

    expect(args).toContain('--chrome');
  });
});
```

#### TC2: Chrome Flag Respects User Toggle
**Test:** Verify chrome flag can be disabled via UI checkbox

```typescript
it('should not include --chrome when explicitly disabled', () => {
  const agentInfo: AgentInfo = {
    agentId: 'test-agent',
    tool: 'claude',
    mode: 'dev',
    prompt: 'test prompt',
    chrome: false  // User unchecked the box
  };

  const args = terminalService['getClaudeArgs'](agentInfo, '/test/path');

  expect(args).not.toContain('--chrome');
});
```

#### TC3: Chrome Flag Only for Claude Tool
**Test:** Verify chrome flag is not added for cursor/cursor-cli

```typescript
it('should not include --chrome for cursor tool', () => {
  const agentInfo: AgentInfo = {
    agentId: 'test-agent',
    tool: 'cursor',
    mode: 'dev',
    prompt: 'test prompt'
  };

  const args = terminalService['getCursorArgs'](agentInfo, '/test/path');

  expect(args).not.toContain('--chrome');
});
```

#### TC4: Chrome Flag with Other Parameters
**Test:** Verify chrome flag works alongside other parameters

```typescript
it('should include --chrome with model and permission-mode', () => {
  const agentInfo: AgentInfo = {
    agentId: 'test-agent',
    tool: 'claude',
    mode: 'planning',
    model: 'opus',
    prompt: 'test prompt'
  };

  const args = terminalService['getClaudeArgs'](agentInfo, '/test/path');

  expect(args).toContain('--chrome');
  expect(args).toContain('--model');
  expect(args).toContain('opus');
  expect(args).toContain('--permission-mode');
  expect(args).toContain('plan');
});
```

#### TC5: Session Creation Integration Test
**Test:** End-to-end test that chrome flag reaches Claude CLI

```typescript
describe('TerminalService.startAgent integration', () => {
  it('should spawn Claude session with --chrome flag', async () => {
    const terminalService = new TerminalService();
    const agentInfo: AgentInfo = {
      agentId: 'test-agent',
      tool: 'claude',
      mode: 'dev',
      prompt: 'test prompt'
    };

    // Mock node-pty to capture command
    const mockWrite = jest.fn();
    jest.spyOn(pty, 'spawn').mockReturnValue({
      write: mockWrite,
      // ... other mock methods
    } as any);

    await terminalService.startAgent('/test/path', agentInfo);

    // Verify the command includes --chrome
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringMatching(/claude.*--chrome/)
    );
  });
});
```

#### TC6: Persistence Test
**Test:** Verify chrome setting persists in .agent-info

```typescript
describe('AgentService persistence', () => {
  it('should persist chrome setting to .agent-info when enabled', async () => {
    const agentService = new AgentService();
    const assignment = {
      agentId: 'test-agent',
      tool: 'claude',
      chrome: true
    };

    await agentService.createAssignment(assignment);

    const savedInfo = await agentService.readAgentInfo('test-agent', '/test/path');
    expect(savedInfo.chrome).toBe(true);
  });

  it('should persist chrome setting to .agent-info when disabled', async () => {
    const agentService = new AgentService();
    const assignment = {
      agentId: 'test-agent',
      tool: 'claude',
      chrome: false  // User disabled it
    };

    await agentService.createAssignment(assignment);

    const savedInfo = await agentService.readAgentInfo('test-agent', '/test/path');
    expect(savedInfo.chrome).toBe(false);
  });
});
```

#### TC7: Backward Compatibility Test
**Test:** Verify existing agents without chrome field default to true

```typescript
it('should default to chrome=true for existing agents', () => {
  // Simulate reading old .agent-info without chrome field
  const oldAgentInfo: AgentInfo = {
    agentId: 'old-agent',
    tool: 'claude',
    mode: 'dev',
    prompt: 'test'
    // No chrome field
  };

  const args = terminalService['getClaudeArgs'](oldAgentInfo, '/test/path');

  // Should default to enabled
  expect(args).toContain('--chrome');
});
```

#### TC8: Base Branch Agent Chrome Flag
**Test:** Verify base branch agents also receive chrome flag

```typescript
it('should include --chrome for base branch agents', () => {
  const agentInfo: AgentInfo = {
    agentId: 'project-base',
    tool: 'claude',
    mode: 'dev',
    prompt: 'test',
    isBaseBranchAgent: true
  };

  const args = terminalService['getClaudeArgs'](agentInfo, '/test/path');

  expect(args).toContain('--chrome');
});
```

#### TC9: UI Checkbox Behavior
**Test:** Verify chrome checkbox appears and functions correctly

**File:** `gui/src/renderer/src/components/__tests__/Dashboard.test.tsx`

```typescript
describe('Dashboard chrome checkbox', () => {
  it('should show chrome checkbox when tool is claude', () => {
    const { getByText } = render(<Dashboard />);

    // Select claude tool
    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'claude' } });

    // Chrome checkbox should be visible
    expect(getByText('Chrome integration 🌐')).toBeInTheDocument();
  });

  it('should default chrome checkbox to checked', () => {
    const { container } = render(<Dashboard />);

    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'claude' } });

    const chromeCheckbox = container.querySelector('input[type="checkbox"]');
    expect(chromeCheckbox).toBeChecked();
  });

  it('should toggle chrome value when checkbox is clicked', () => {
    const { container } = render(<Dashboard />);

    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'claude' } });

    const chromeCheckbox = container.querySelector('input[type="checkbox"]');

    // Initially checked
    expect(chromeCheckbox).toBeChecked();

    // Click to uncheck
    fireEvent.click(chromeCheckbox);
    expect(chromeCheckbox).not.toBeChecked();

    // Click to check again
    fireEvent.click(chromeCheckbox);
    expect(chromeCheckbox).toBeChecked();
  });

  it('should not show chrome checkbox for cursor tool', () => {
    const { queryByText } = render(<Dashboard />);

    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'cursor' } });

    expect(queryByText('Chrome integration 🌐')).not.toBeInTheDocument();
  });
});
```

### Test Infrastructure Setup

#### 1. Install Testing Dependencies (if not already present)
```json
// package.json
{
  "devDependencies": {
    "jest": "^29.x",
    "@types/jest": "^29.x",
    "ts-jest": "^29.x"
  }
}
```

#### 2. Configure Jest (if not already configured)
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/gui/src/main', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'gui/src/main/services/TerminalService.ts',
    'gui/src/main/services/AgentService.ts'
  ]
};
```

#### 3. Add Test Scripts
```json
// package.json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:chrome": "jest --testNamePattern=chrome"
  }
}
```

### Manual Testing Checklist

After automated tests pass, perform manual verification:

#### UI Testing
- [ ] Open Dashboard and select Claude tool
- [ ] Verify chrome checkbox appears below yolo checkbox
- [ ] Verify chrome checkbox is checked by default
- [ ] Verify checkbox has label "Chrome integration 🌐"
- [ ] Verify helper text explains what it does
- [ ] Toggle checkbox off and on, verify state changes
- [ ] Switch to Cursor tool, verify chrome checkbox disappears
- [ ] Switch back to Claude, verify chrome checkbox reappears

#### Agent Creation Testing
- [ ] Create agent with chrome enabled (default), verify `--chrome` appears in terminal command
- [ ] Create agent with chrome disabled (unchecked), verify no `--chrome` in command
- [ ] Create super agent with chrome enabled, verify `--chrome` in command
- [ ] Create super agent with chrome disabled, verify no `--chrome` in command

#### Session Management Testing
- [ ] Resume an existing agent (with chrome=true), verify `--chrome` is included
- [ ] Resume an old agent (no chrome field), verify `--chrome` is included (backward compatibility)
- [ ] Resume an agent with chrome=false, verify no `--chrome` in command

#### Special Cases Testing
- [ ] Base branch agent should have chrome enabled by default
- [ ] Test with different models (haiku, opus, sonnet) - chrome should work with all
- [ ] Test with planning mode - chrome should work
- [ ] Test with dev mode - chrome should work
- [ ] Test yolo + chrome together - both flags should appear

#### Functionality Testing
- [ ] Verify Chrome functionality actually works when enabled (browser opens, web interaction, etc.)
- [ ] Verify Claude works normally when chrome is disabled
- [ ] Check terminal output shows the chrome flag in the command when enabled
- [ ] Verify .agent-info file persists chrome setting correctly

### Regression Testing

Ensure existing functionality still works:

- [ ] Agents can be created without specifying chrome parameter
- [ ] Session resumption works correctly
- [ ] Model selection still functions
- [ ] Permission modes (plan/acceptEdits) still work
- [ ] YOLO mode still functions
- [ ] System prompt file loading works for planning agents
- [ ] Multiple simultaneous agents work correctly
- [ ] Base branch agents work correctly

### CI/CD Integration

If CI exists, update pipeline to run chrome flag tests:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

---

## Implementation Order

### Phase 1: Backend Implementation
1. **Update AgentInfo interface** - Add `chrome?: boolean` field to ProjectConfig.ts
2. **Update TerminalService** - Add chrome parameter to `startAgent()` and `getClaudeArgs()`
3. **Update AgentService** - Add chrome field to `createAssignment()` and `ensureBaseBranchAgent()`
4. **Update IPC handlers** - Pass chrome through all handlers in index.ts

### Phase 2: UI Implementation
5. **Update Dashboard state** - Add chrome to formData state
6. **Add chrome checkbox** - Create checkbox UI below yolo checkbox
7. **Wire up form submission** - Pass chrome to backend in both regular and super agent creation
8. **Test UI interaction** - Verify checkbox appears and toggles correctly

### Phase 3: Testing
9. **Write unit tests** - Test parameter building logic (TC1-TC8)
10. **Write UI tests** - Test checkbox behavior (TC9)
11. **Write integration tests** - Test end-to-end session creation (TC5)
12. **Manual testing** - Follow manual testing checklist (30+ test cases)
13. **Regression testing** - Ensure existing features still work

### Phase 4: Finalization
14. **Update documentation** - README and code comments
15. **Code review** - Get feedback on implementation
16. **Merge to feature branch** - Deploy changes

## Design Decisions

**Resolved:**

1. **Approach:** Always-on by default with UI toggle (like yolo checkbox) ✅
2. **UI Pattern:** Checkbox below yolo checkbox with same styling ✅
3. **Default value:** `true` (enabled by default) ✅
4. **Backward compatibility:** Old agents without chrome field default to enabled ✅
5. **Tool support:** Only applies to Claude tool (not cursor/cursor-cli) ✅

**Still to verify:**

1. **What does `--chrome` actually do?** Need to verify with Claude CLI documentation or testing
2. **Does it require Chrome to be installed?** Check prerequisites and document
3. **Performance impact?** Monitor session creation time with/without flag

## Risk Assessment

**Low Risk:**
- Adding a simple flag to args array is minimal change
- Easy to rollback if issues occur

**Medium Risk:**
- If chrome requires installation, may break for users without Chrome
- May affect session performance or behavior

**Mitigation:**
- Start with configurable approach (can disable if needed)
- Thorough testing before rollout
- Clear documentation of requirements
- Consider graceful fallback if Chrome unavailable

## Success Criteria

- [ ] `--chrome` flag is passed to all new Claude sessions
- [ ] All automated tests pass
- [ ] Manual testing confirms Chrome functionality works
- [ ] No regression in existing functionality
- [ ] Documentation is updated
- [ ] Code review approved

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| **Backend Files** | | |
| `gui/src/main/services/types/ProjectConfig.ts` | Modify | Add `chrome?: boolean` to AgentInfo interface |
| `gui/src/main/services/TerminalService.ts` | Modify | Add chrome param to `startAgent()`, add `--chrome` to `getClaudeArgs()` |
| `gui/src/main/services/AgentService.ts` | Modify | Handle chrome in `createAssignment()` and `ensureBaseBranchAgent()` |
| `gui/src/main/index.ts` | Modify | Pass chrome through IPC handlers (3 locations) |
| **Frontend Files** | | |
| `gui/src/renderer/src/components/Dashboard.tsx` | Modify | Add chrome to state, add checkbox UI, wire up submission |
| **Test Files** | | |
| `gui/src/main/services/__tests__/TerminalService.test.ts` | Create | Unit tests for chrome parameter building (TC1-TC8) |
| `gui/src/main/services/__tests__/AgentService.test.ts` | Create/Modify | Tests for chrome persistence (TC6) |
| `gui/src/renderer/src/components/__tests__/Dashboard.test.tsx` | Create/Modify | UI tests for chrome checkbox (TC9) |
| **Documentation** | | |
| `README.md` | Modify | Document chrome flag behavior and UI checkbox |

## Dependencies

- Existing: node-pty, AgentService, TerminalService
- New testing: jest, ts-jest (if not already present)
- Runtime: Claude CLI with `--chrome` support

## Estimated Complexity

- **Backend changes**: Low-Medium complexity (4 files, straightforward parameter passing)
- **UI changes**: Low complexity (1 file, replicating existing yolo pattern)
- **Testing**: Medium complexity (9 test cases + manual testing checklist)
- **Overall**: Medium complexity, estimated 4-6 hours of work

**Breakdown:**
- Backend implementation: 1-2 hours
- UI implementation: 1 hour
- Test writing: 1-2 hours
- Manual testing: 1 hour
- Documentation: 30 minutes
