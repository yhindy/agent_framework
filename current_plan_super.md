# Super Minion Feature - Implementation Plan

## Overview
A "Super Minion" is a recursive agent structure where a high-level agent (the parent) can break down a large feature into sub-tasks and orchestrate multiple "normal" minions (children) to execute them.

## Core Architecture

### Recursive Type Inheritance
```typescript
interface SuperAgentInfo extends AgentInfo {
  isSuperMinion: true
  minionBudget: number
  children: AgentInfo[]          // Computed at runtime
  pendingPlans: ChildPlan[]      // Plans awaiting approval
}
```

### Orchestration Mechanics
1. **Planning**: Super minion writes `.pending-plans.json` and signals `===SIGNAL:PLANS_READY===`.
2. **Approval**: Human reviews plans in `SuperAgentView` and approves specific sub-tasks.
3. **Spawning**: Backend spawns child worktrees with `parentAgentId` linked back to the super minion.
4. **Monitoring**: Super minion monitors progress via `.children-status.json` written by the backend.

---

## Technical Details

### 1. File-Based Orchestration
The Super Minion and Backend communicate via JSON files in the Super Minion's worktree:

**`.pending-plans.json` (Super Minion → Backend)**
```json
{
  "plans": [
    {
      "id": "plan-uuid",
      "shortName": "fix-header",
      "description": "Fix the navigation header styling",
      "prompt": "The header is overlapping... fix it using Tailwind.",
      "status": "pending"
    }
  ]
}
```

**`.children-status.json` (Backend → Super Minion)**
```json
{
  "children": [
    {
      "agentId": "proj-abc",
      "status": "in_progress",
      "lastSignal": "WORKING"
    }
  ],
  "usedBudget": 1
}
```

### 2. Runtime Child Assembly
The `AgentService` will not store the `children[]` array in the config. Instead:
- Every minion has a `parentAgentId` in its `.agent-info`.
- `listAgents()` scans all worktrees.
- If a minion has a `parentAgentId`, it is nested under that parent in the returned `SuperAgentInfo`.

---

## Implementation Milestones (Revised)

### Phase 1: Scaffolding & Types
- [x] **Milestone 1: Type Definitions**
  - Added `SuperAgentInfo` and `ChildPlan` types.
  - Implemented `isSuperMinion` type guard.
  - Added unit tests.
- [x] **Milestone 2: UI Scaffolding (SuperAgentView)**
  - Created `SuperAgentView.tsx` with mock data.
  - Implemented collapsible orchestration terminal.
  - Designed layouts for "Active Children" and "Proposed Plans".

### Phase 2: Component Extraction & UI Integration
- [x] **Milestone 3: ChildStatusCard Component**
  - Extract reusable card component for child status.
- [x] **Milestone 4: PlanApproval Component**
  - Extract reusable UI for reviewing/approving proposed tasks.
- [x] **Milestone 5: Sidebar Integration**
  - Show 👑 icon for super minions.
  - Implement expandable tree to see children under parent.
- [x] **Milestone 6: Creation Flow & Routing**
  - Add "New Super Mission" button and form.
  - Route to `/workspace/super/:agentId` after creation.

### Phase 3: Backend & Orchestration (Revised)
- [x] **Milestone 7: Backend Creation Logic**
  - Implement `AgentService.createSuperAssignment`.
  - Write `isSuperMinion` to `.agent-info`.
  - Update `listAgents` to preserve super minion metadata.
  - **Bug Fix**: Fixed sidebar crown icon display.
  - **UI Polish**: Sleek modern styling.

- [x] **Milestone 8: Wire Real Data to UI**
  - Implement `getSuperAgentDetails` in `AgentService`.
  - Expose via IPC.
  - Update `SuperAgentView` to fetch real data (removing mock data).
  - Add unit tests for `SuperAgentView` data fetching.

- [x] **Milestone 9: Create AI Rules File** ✅
  - Create `gui/resources/minions/rules/super-minion-rules.md`.
  - Define plan proposal format and monitoring rules.

- [ ] **Milestone 10: Plan Detection and Display**
  - Add `PLANS_READY` to `SIGNAL_PATTERNS`.
  - Implement `readPendingPlans` in `AgentService`.
  - Trigger UI refresh on signal.

- [ ] **Milestone 11: Plan Approval and Child Spawning**
  - Implement `approvePlan` IPC.
  - Logic to create child worktrees from approved plans.
  - Link children via `parentAgentId`.

- [ ] **Milestone 12: End-to-End Verification**
  - Full loop with real Claude session.

---

## Testing Strategy

| Milestone | Testing Type | Plan |
|-----------|--------------|------|
| **1-2** | Unit / Manual | Verify types and UI scaffolding. |
| **3-4** | Component | Verify components react to props. |
| **5-6** | Integration | Verify sidebar tree and routing. |
| **7** | Integration | Verify creation logic and persistence. |
| **8** | Component | Mock IPC and verify `SuperAgentView` renders real data. |
| **9** | Manual | Verify rules file content. |
| **10** | Integration | Manually drop `.pending-plans.json` and verify UI detection. |
| **11** | Integration | Approve plan manually and verify child creation. |
| **12** | E2E | Real Claude session. |
