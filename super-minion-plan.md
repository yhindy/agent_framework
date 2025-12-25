# Super Minion Planning Mode Enhancement

## Overview

Enhance the super minion's planning mode to properly enforce budget constraints and provide clear instructions to Claude about how many child minions it can create.

**Scope**: Planning mode only. Overseeing mode deferred to future work.

---

## Current State

### What Exists
- Super minion type system with `SuperAgentInfo`, `ChildPlan` interfaces
- File-based orchestration: `.pending-plans.json`, `.children-status.json`
- Signal protocol: `PLANS_READY`, `DEV_COMPLETED`, etc.
- Planning mode starts Claude with `--permission-mode plan`
- Children spawned with `--permission-mode acceptEdits`
- Rules file: `super-minion-rules.md` copied to worktree

### Gaps to Fix
- No budget enforcement (can approve more plans than budget allows)
- Claude doesn't know about the budget when planning
- `ChildPlan` missing `branch` and `childAgentId` fields
- No explicit mode tracking on `SuperAgentInfo`

---

## Implementation Steps

### Step 1: Update Type System

**File: `gui/src/main/services/types/ProjectConfig.ts`**

Add fields to `ChildPlan`:
```typescript
interface ChildPlan {
  id: string
  shortName: string
  branch?: string              // ADD: Optional explicit branch name
  description: string
  prompt: string
  estimatedComplexity: 'small' | 'medium' | 'large'
  status: 'pending' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'failed'
  childAgentId?: string        // ADD: Populated after approval
}
```

Update `SuperAgentInfo` to track mode explicitly (for future overseeing):
```typescript
interface SuperAgentInfo extends AgentInfo {
  isSuperMinion: true
  minionBudget: number
  children: AgentInfo[]
  pendingPlans: ChildPlan[]
  // mode is already on AgentInfo as 'planning' | 'dev' | 'auto' etc.
}
```

### Step 2: Budget Enforcement in approvePlan()

**File: `gui/src/main/services/AgentService.ts`**

In `approvePlan()` method, add check before creating child:
```typescript
// Before line: const childAgent = await this.createAssignment(...)

// Check budget
const superDetails = await this.getSuperAgentDetails(projectPath, superAgentId)
if (superDetails.children.length >= superDetails.minionBudget) {
  throw new Error(`Budget exceeded: already have ${superDetails.children.length}/${superDetails.minionBudget} children`)
}
```

After creating child, update plan with childAgentId:
```typescript
// After child is created
plan.childAgentId = childAgent.agentId
```

### Step 3: Update Planning Rules

**File: `gui/resources/minions/rules/super-minion-rules.md`**

Update to include budget awareness:
- Add section explaining budget constraints
- Update JSON schema to include optional `branch` field
- Clarify that plans must be between 1 and budget count

### Step 4: Pass Budget in Planning Prompt

**File: `gui/src/main/services/TerminalService.ts`**

In `getClaudeArgs()` when mode is 'planning', include budget info:
```typescript
if (mode === 'planning') {
  // Read budget from agent info if available
  const planPrompt = `You are a Super Minion with a budget of ${budget} child minions. Create a plan for: ${prompt}`
  // ...
}
```

This requires passing budget through to TerminalService, or reading it from .agent-info.

---

## Automated Tests

### Test 1: Type System Tests

**File: `gui/src/main/services/__tests__/SuperMinionTypes.test.ts`** (update existing)

```typescript
describe('ChildPlan type', () => {
  it('should allow optional branch field', () => {
    const plan: ChildPlan = {
      id: 'test-1',
      shortName: 'test',
      branch: 'feature/custom-branch',  // optional
      description: 'Test plan',
      prompt: 'Do something',
      estimatedComplexity: 'small',
      status: 'pending'
    }
    expect(plan.branch).toBe('feature/custom-branch')
  })

  it('should allow childAgentId after approval', () => {
    const plan: ChildPlan = {
      id: 'test-1',
      shortName: 'test',
      description: 'Test plan',
      prompt: 'Do something',
      estimatedComplexity: 'small',
      status: 'approved',
      childAgentId: 'project-abc123'
    }
    expect(plan.childAgentId).toBe('project-abc123')
  })
})
```

### Test 2: Budget Enforcement Tests

**File: `gui/src/main/services/__tests__/BudgetEnforcement.test.ts`** (new)

```typescript
describe('Budget Enforcement', () => {
  it('should reject approval when budget is exhausted', async () => {
    // Setup: super minion with budget of 2, already has 2 children
    // Action: try to approve another plan
    // Assert: throws error with budget message
  })

  it('should allow approval when under budget', async () => {
    // Setup: super minion with budget of 3, has 1 child
    // Action: approve a plan
    // Assert: succeeds, child created
  })

  it('should update plan with childAgentId after approval', async () => {
    // Setup: super minion with pending plan
    // Action: approve the plan
    // Assert: plan.childAgentId is set to new agent's ID
  })
})
```

### Test 3: Planning Prompt Tests

**File: `gui/src/main/services/__tests__/PlanningPrompt.test.ts`** (new)

```typescript
describe('Planning Prompt', () => {
  it('should include budget in planning prompt', () => {
    // Verify getClaudeArgs includes budget info for planning mode
  })
})
```

---

## Implementation Order

1. **Step 1: Type System** - Add `branch` and `childAgentId` to `ChildPlan`
2. **Step 2: Budget Enforcement** - Add check in `approvePlan()`
3. **Step 3: Update Rules** - Modify `super-minion-rules.md`
4. **Step 4: Budget in Prompt** - Pass budget to Claude when starting planning
5. **Run automated tests**
6. **STOP for manual testing**

---

## Manual Testing Checklist

After automated tests pass, manually verify:

- [ ] Create a super minion with budget of 2
- [ ] Super minion receives planning prompt that mentions budget
- [ ] Super minion creates plans (verify in `.pending-plans.json`)
- [ ] Approve first plan - child spawns successfully
- [ ] Approve second plan - child spawns successfully
- [ ] Try to approve third plan - should fail with budget error
- [ ] Verify `.pending-plans.json` has `childAgentId` set for approved plans

---

## Phase 2: Overseeing Mode (Future Implementation)

### 2.1 Architecture Decision: How Super Minion Observes Children

**Option A: Aggregated File Updates (Simpler)**
- Backend periodically updates `.children-status.json` with richer info
- Include last N lines of output, current status, any blockers
- Super minion reads this file to understand state
- Super minion writes responses to `.super-response-{childId}.txt`
- Backend reads and injects into child's terminal

**Option B: Claude Code Print Mode Pipeline (More Powerful)** ✓ RECOMMENDED
- Use Claude Code's `--output-format stream-json` for children
- Backend captures structured JSON output from each child
- Backend aggregates and presents to super minion via its own stdin
- Super minion can respond; backend routes to correct child

**Option C: MCP Server (Most Integrated)**
- Create custom MCP server that super minion can call
- Tools like `get_child_status(childId)`, `send_to_child(childId, message)`
- Most native Claude experience but more complex setup

### 2.2 Recommended: Option B - JSON Streaming Pipeline

#### Child Launch Changes

**File: `gui/src/main/services/TerminalService.ts`**

For children of super minions, launch in print mode with JSON streaming:
```typescript
// For child of super minion
if (parentAgentId && isSuperMinionChild) {
  args = [
    '-p',
    '--output-format', 'stream-json',
    '--session-id', sessionId,
    '--permission-mode', 'acceptEdits'
  ]
  if (prompt) args.push(prompt)
}
```

#### Output Aggregation

**New File: `gui/src/main/services/SupervisionService.ts`**

```typescript
class SupervisionService {
  private childOutputStreams: Map<string, TransformStream>

  // Aggregate child outputs into digestible updates
  aggregateChildStatus(superAgentId: string): ChildStatusUpdate[]

  // Send message to child's stdin (for print mode, this continues the conversation)
  sendToChild(childAgentId: string, message: string): void

  // Format updates for super minion consumption
  formatForSuperMinion(updates: ChildStatusUpdate[]): string
}
```

#### Super Minion in Overseeing Mode

When transitioning to overseeing mode:

1. **Transition Trigger**: All pending plans approved OR user manually switches
2. **Start Overseeing Session**: New Claude session with overseeing prompt
3. **Input Loop**:
   - Backend monitors all children's JSON output
   - Every N seconds or on signal, send update to super minion
   - Super minion can respond with instructions for specific children

### 2.3 Overseeing Mode Rules

**New File: `gui/resources/minions/rules/super-minion-overseeing.md`**

```markdown
# Super Minion Overseeing Protocol

You are now in **Overseeing Mode**. Your children are working on their assigned tasks.

## Your Responsibilities
1. Monitor progress of each child
2. Identify blockers and help resolve them
3. Coordinate between children when needed
4. Ensure overall mission success

## Available Commands
- To send a message to a child: `@child-{id}: your message`
- To request status update: `===SIGNAL:STATUS_REQUEST===`
- To mark mission complete: `===SIGNAL:MISSION_COMPLETE===`

## Status Updates
You will receive periodic updates in this format:
```json
{
  "children": [
    {
      "agentId": "...",
      "status": "working|waiting|completed|blocked",
      "lastOutput": "...",
      "currentTask": "..."
    }
  ]
}
```
```

### 2.4 Mode Transition

**File: `gui/src/main/services/AgentService.ts`**

```typescript
async transitionToOverseeingMode(projectPath: string, superAgentId: string): Promise<void> {
  // 1. Stop current planning session
  // 2. Update .agent-info with mode: 'overseeing'
  // 3. Emit signal to UI
  // 4. Start new Claude session with overseeing rules
}
```

**Automatic Transition**:
- When all plans are approved and children spawned
- OR when budget is exhausted

**Manual Transition**:
- User clicks "Start Overseeing" button in UI

### 2.5 UI Updates for Overseeing

**File: `gui/src/renderer/components/SuperAgentView.tsx`**

- Show current mode prominently: "Planning" / "Overseeing"
- Planning mode:
  - Full terminal view
  - Pending plans section with approve/reject
  - Budget indicator: "3/5 children used"
- Overseeing mode:
  - Main terminal for super minion
  - Split view or tabs showing each child's status/output
  - Ability to focus on specific child
