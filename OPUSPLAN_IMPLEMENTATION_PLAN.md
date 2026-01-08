# Implementation Plan: Add OpusPlan Model Option

## Executive Summary

This plan outlines the implementation to add "OpusPlan" as a model option in the GUI application. **Claude Code CLI fully supports the `opusplan` alias**, which provides Opus 4.5 for planning and automatically switches to Sonnet 4.5 for execution.

### OpusPlan Overview
- **Alias**: `opusplan` (supported by Claude Code CLI)
- **Behavior**: Uses Opus 4.5 during plan mode for complex reasoning, switches to Sonnet 4.5 for execution
- **Full Model ID**: `claude-opus-4-5-20251101`
- **Use Case**: Best of both worlds - superior planning with efficient execution

---

## 1. Requirements Verification

### ✅ Claude Code CLI Support
**Confirmed**: The `opusplan` alias is officially supported by Claude Code CLI.

**Evidence**:
- CLI help text confirms: `--model <model>` accepts aliases like 'sonnet', 'opus', or full model names
- Documentation confirms `opusplan` is a valid alias
- Behavior: Uses Opus in plan mode, switches to Sonnet for execution

**Validation Command**:
```bash
claude --model opusplan "test prompt"
```

### Architecture Compatibility
The existing application architecture already supports arbitrary model aliases:
- ✅ Type system uses `model?: string` (no enum restrictions)
- ✅ Terminal service passes model alias directly to CLI as `--model <alias>`
- ✅ Session parser extracts actual model from JSONL responses
- ✅ UI display formatting already handles model name variations

**No architectural changes required** - only UI additions needed.

---

## 2. Implementation Changes

### 2.1 UI Changes (Dashboard.tsx)

**File**: `gui/src/renderer/src/components/Dashboard.tsx`

#### Change 1: Add OpusPlan to Model Dropdown
**Location**: Lines 674-686

**Current Code**:
```tsx
{formData.tool === 'claude' && (
  <div className="form-group">
    <label>Model</label>
    <select
      value={formData.model}
      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
    >
      <option value="haiku">Haiku</option>
      <option value="sonnet">Sonnet</option>
      <option value="opus">Opus</option>
    </select>
  </div>
)}
```

**Updated Code**:
```tsx
{formData.tool === 'claude' && (
  <div className="form-group">
    <label>Model</label>
    <select
      value={formData.model}
      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
    >
      <option value="haiku">Haiku</option>
      <option value="sonnet">Sonnet</option>
      <option value="opus">Opus</option>
      <option value="opusplan">Opus Plan</option>
    </select>
  </div>
)}
```

**Rationale**:
- Display name "Opus Plan" (with space) for readability
- Value `opusplan` (no hyphen) matches Claude CLI alias exactly
- Added at the end to maintain existing option order

#### Change 2: Consider Default Model Update (Optional)
**Location**: Line 229

**Current**: `model: 'opus'`
**Optional**: `model: 'opusplan'`

**Recommendation**: Keep current default as `opus` to avoid changing existing behavior. Users can explicitly select OpusPlan if desired.

#### Change 3: Form Reset Default (Optional)
**Location**: Line 81

**Current**: `model: 'haiku'`
**Note**: This is the reset value after form submission. Consider keeping as-is.

### 2.2 No Backend Changes Required

The following components require **zero changes**:

| Component | File | Reason |
|-----------|------|--------|
| Type System | ProjectConfig.ts | Already uses `model?: string` |
| IPC Handlers | index.ts:443-510 | Passes model through unchanged |
| Terminal Service | TerminalService.ts:405-451 | Already passes alias to CLI |
| Session Parser | ClaudeSessionInfoService.ts | Already extracts full model names |
| UI Display | SessionInfoPanel.tsx:28-30 | Already formats model names |

---

## 3. Testing Strategy

### 3.1 Manual Testing

#### Test Case 1: Model Selection
**Steps**:
1. Open application
2. Click "Create New Mission"
3. Select "Claude" as tool
4. Verify "Opus Plan" appears in model dropdown
5. Select "Opus Plan"
6. Fill in other required fields
7. Click "Create Mission"

**Expected**: Assignment created with `model: "opusplan"`

#### Test Case 2: Agent Execution
**Steps**:
1. Create mission with OpusPlan model
2. Observe terminal output
3. Verify CLI command includes `--model opusplan`
4. Wait for first response
5. Check session JSONL file

**Expected**:
- Command: `claude --model opusplan --permission-mode plan ...`
- JSONL contains actual model: `"model":"claude-opus-4-5-20251101"` initially
- May show model switch to `claude-sonnet-4-5-20250929` during execution

**Validation Location**: Check `.claude/sessions/<session-id>/session.jsonl`

#### Test Case 3: Session Info Display
**Steps**:
1. Start OpusPlan session
2. Wait for response
3. Open Session Info Panel
4. Verify model display

**Expected**:
- Shows "claude-opus-4-5" (formatted, without date)
- If model switches, shows model history with both models

#### Test Case 4: Session Resume
**Steps**:
1. Create session with OpusPlan
2. Stop agent mid-execution
3. Resume the session
4. Verify model persists

**Expected**:
- Resume command includes `--model opusplan`
- Session continues with correct model context

#### Test Case 5: Dashboard Display
**Steps**:
1. Create multiple missions with different models
2. View dashboard
3. Check assignment cards

**Expected**: Cards display model value correctly

### 3.2 Automated Testing

#### Test Suite 1: Unit Tests for UI Component

**File**: `gui/src/renderer/src/components/__tests__/Dashboard.test.tsx` (create if doesn't exist)

**Test Cases**:
```typescript
describe('Dashboard Model Selection', () => {
  it('displays all available Claude models including OpusPlan', () => {
    // Render Dashboard
    // Find model dropdown
    // Verify options: haiku, sonnet, opus, opusplan
  });

  it('sets model to opusplan when selected', () => {
    // Render Dashboard
    // Select OpusPlan from dropdown
    // Verify formData.model === 'opusplan'
  });

  it('includes model in assignment creation', () => {
    // Mock IPC call
    // Fill form with opusplan model
    // Submit form
    // Verify IPC called with model: 'opusplan'
  });
});
```

#### Test Suite 2: Integration Tests for Terminal Service

**File**: `gui/src/main/services/__tests__/TerminalService.test.ts` (create if doesn't exist)

**Test Cases**:
```typescript
describe('TerminalService Model Handling', () => {
  it('passes opusplan model to Claude CLI', () => {
    // Create TerminalService instance
    // Call startAgent with model: 'opusplan'
    // Verify spawn called with ['--model', 'opusplan']
  });

  it('preserves opusplan model on session resume', () => {
    // Mock existing session with opusplan model
    // Call resumeAgent
    // Verify resume command includes '--model opusplan'
  });
});
```

#### Test Suite 3: Session Info Parsing Tests

**File**: `gui/src/main/services/__tests__/ClaudeSessionInfoService.test.ts` (extend existing)

**Test Cases**:
```typescript
describe('ClaudeSessionInfoService OpusPlan Support', () => {
  it('extracts claude-opus-4-5-20251101 as actual model', () => {
    // Create JSONL with model: claude-opus-4-5-20251101
    // Parse session info
    // Verify actualModel === 'claude-opus-4-5-20251101'
  });

  it('tracks model change from Opus to Sonnet in OpusPlan', () => {
    // Create JSONL with initial model: claude-opus-4-5-20251101
    // Add subsequent message with model: claude-sonnet-4-5-20250929
    // Parse session info
    // Verify modelHistory contains both models
  });
});
```

**Test Fixture**: Create `gui/src/main/services/__tests__/fixtures/opusplan-session.jsonl`
```jsonl
{"type":"user","content":"test prompt"}
{"type":"assistant","content":"Planning...","model":"claude-opus-4-5-20251101"}
{"type":"assistant","content":"Executing...","model":"claude-sonnet-4-5-20250929"}
```

#### Test Suite 4: End-to-End Tests

**Framework**: Playwright or similar E2E framework

**Test Cases**:
```typescript
describe('OpusPlan E2E Flow', () => {
  it('creates and runs OpusPlan mission successfully', async () => {
    // Launch app
    // Create mission with OpusPlan model
    // Wait for agent to start
    // Verify session file created
    // Verify model in session JSONL
    // Stop agent
    // Verify clean shutdown
  });

  it('displays OpusPlan model correctly in UI', async () => {
    // Create OpusPlan mission
    // Wait for response
    // Open Session Info Panel
    // Verify model display matches expected format
  });
});
```

### 3.3 Testing Checklist

Before merging:
- [ ] All four model options render in dropdown
- [ ] OpusPlan selection persists in form state
- [ ] CLI command includes `--model opusplan`
- [ ] Session JSONL contains actual model ID
- [ ] Session Info Panel displays model correctly
- [ ] Model history tracks Opus → Sonnet switch (if applicable)
- [ ] Session resume preserves OpusPlan model
- [ ] Dashboard cards display model value
- [ ] Unit tests pass for UI component
- [ ] Integration tests pass for Terminal Service
- [ ] Session parsing tests pass
- [ ] E2E test passes for complete flow
- [ ] No regressions in existing model options (haiku, sonnet, opus)

### 3.4 Test Automation Setup

**Prerequisites**:
1. Install testing frameworks if not present:
   ```bash
   npm install --save-dev @testing-library/react @testing-library/jest-dom
   npm install --save-dev jest ts-jest @types/jest
   ```

2. Configure Jest for Electron renderer and main processes

3. Set up E2E testing framework (Playwright recommended)

**Test Execution**:
```bash
# Run all tests
npm test

# Run specific test suite
npm test -- Dashboard.test.tsx

# Run E2E tests
npm run test:e2e
```

**CI/CD Integration**:
- Add test execution to GitHub Actions workflow
- Ensure tests run on PR creation and commits
- Block merge if tests fail

---

## 4. Implementation Steps

1. **Update UI** (5 minutes)
   - Edit Dashboard.tsx line ~682
   - Add `<option value="opusplan">Opus Plan</option>`
   - Verify in browser with hot reload

2. **Manual Testing** (15 minutes)
   - Test all 5 manual test cases
   - Verify CLI command and JSONL output
   - Check UI display and session resume

3. **Write Unit Tests** (30 minutes)
   - Create Dashboard.test.tsx
   - Write 3 test cases for model selection
   - Verify tests pass

4. **Write Integration Tests** (30 minutes)
   - Extend TerminalService.test.ts
   - Write 2 test cases for CLI args
   - Verify tests pass

5. **Extend Session Parsing Tests** (20 minutes)
   - Add test cases to ClaudeSessionInfoService.test.ts
   - Create opusplan-session.jsonl fixture
   - Verify tests pass

6. **Set up E2E Tests** (45 minutes)
   - Install and configure E2E framework
   - Write complete flow test
   - Verify test passes

7. **Documentation** (10 minutes)
   - Update user documentation if it exists
   - Add inline code comments if helpful

8. **Code Review & PR** (variable)
   - Create PR with all changes and tests
   - Address review feedback
   - Merge when approved

**Total Estimated Time**: ~2.5 hours including comprehensive testing

---

## 5. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Model switch behavior unexpected | Medium | Low | Document expected behavior; add test to verify model transitions |
| Users confused by "Plan" terminology | Low | Medium | Add tooltip or help text explaining OpusPlan behavior |
| Cost implications of using Opus | Medium | Medium | Clearly label that OpusPlan uses Opus for planning (higher cost) |
| Breaking existing model selection | High | Very Low | Comprehensive testing of existing models; no code changes to logic |

---

## 6. Success Criteria

- ✅ "Opus Plan" appears in model dropdown
- ✅ Selecting OpusPlan creates missions with `model: "opusplan"`
- ✅ Claude CLI receives `--model opusplan` argument
- ✅ Sessions execute successfully with model switching
- ✅ UI displays model information correctly
- ✅ All automated tests pass
- ✅ No regressions in existing model options
- ✅ Code reviewed and merged

---

## 7. Future Enhancements

### Short-term (Optional)
1. **Add Tooltips**: Explain what each model does
   - Haiku: "Fast and efficient"
   - Sonnet: "Balanced performance"
   - Opus: "Maximum capability"
   - Opus Plan: "Opus for planning, Sonnet for execution"

2. **Cost Indicator**: Show relative cost indicator (💰 symbols)

3. **Model Descriptions**: Expand dropdown with descriptions

### Long-term (Not in scope)
1. **Model Analytics**: Track which models are used most
2. **Smart Model Selection**: Suggest model based on prompt
3. **Custom Model Aliases**: Allow users to define their own aliases
4. **Model Performance Metrics**: Show speed/cost stats per model

---

## 8. Appendix: Technical Details

### Model Flow Diagram
```
User selects "Opus Plan" in Dashboard
  ↓
Stored as: { model: "opusplan" }
  ↓
Passed to IPC: createAssignmentForProject({ model: "opusplan", ... })
  ↓
TerminalService.startAgent(..., model="opusplan", ...)
  ↓
getClaudeArgs() builds: ["--model", "opusplan", ...]
  ↓
Spawns: claude --model opusplan --permission-mode plan ...
  ↓
Claude Code CLI: Uses Opus 4.5 for plan mode
  ↓
Claude Code CLI: Switches to Sonnet 4.5 for execution
  ↓
Session JSONL records:
  - Initial: "model": "claude-opus-4-5-20251101"
  - After switch: "model": "claude-sonnet-4-5-20250929"
  ↓
ClaudeSessionInfoService reads JSONL and extracts:
  - actualModel: "claude-opus-4-5-20251101" (or latest)
  - modelHistory: [{ model: "claude-opus-4-5-20251101", timestamp: "..." }, ...]
  ↓
SessionInfoPanel displays: "claude-opus-4-5" (formatted)
```

### Files Modified Summary
| File | Lines Changed | Type |
|------|---------------|------|
| Dashboard.tsx | +1 line (~682) | UI Addition |
| Dashboard.test.tsx | +30 lines | New Test File |
| TerminalService.test.ts | +20 lines | New Test File |
| ClaudeSessionInfoService.test.ts | +25 lines | Test Addition |
| opusplan-session.jsonl | +3 lines | Test Fixture |

**Total Code Change**: ~1 line of production code, ~78 lines of test code

---

## References

- **Claude Code CLI Documentation**: https://code.claude.com/docs/en/model-config.md
- **Claude Models Overview**: https://docs.anthropic.com/en/docs/models-overview
- **Project Type Definitions**: gui/src/main/services/types/ProjectConfig.ts
- **Existing Model Tests**: gui/src/main/services/__tests__/ClaudeSessionInfoService.test.ts
