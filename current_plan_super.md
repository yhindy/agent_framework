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

## Implementation Milestones

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
- [ ] **Milestone 6: Creation Flow & Routing**
  - Add "New Super Mission" button and form.
  - Register `/super/:agentId` route.

### Phase 3: Backend & Orchestration
- [ ] **Milestone 7: Backend Creation Logic**
  - Implement `createSuperAssignment` in `AgentService`.
  - Update `listAgents` to assemble recursive child trees.
- [ ] **Milestone 8: Signal Protocol Extension**
  - Detect `PLANS_READY` signal.
  - Implement reading/writing of `.pending-plans.json`.
- [ ] **Milestone 9: Child Spawning Engine**
  - Logic to create child worktrees from approved plans.
  - Automatic `parentAgentId` linking.
- [ ] **Milestone 10: Final Integration & Rules**
  - Create `super-minion-rules.md` for the AI to follow.
  - End-to-end testing of the full orchestration loop.

---

## Testing Strategy

| Milestone | Testing Type | Plan |
|-----------|--------------|------|
| **1-2** | Unit / Manual | Verify `isSuperMinion` type guard. Inspect `SuperAgentView` via mock data injection. |
| **3-4** | Component | Verify components react correctly to prop changes (status badges, plan counts). |
| **5-6** | Integration | Mock Electron IPC to verify sidebar tree expansion and routing triggers. |
| **7** | Integration | Create super minion, verify filesystem worktree and `.agent-info` JSON validity. |
| **8-9** | Integration | Manually drop a `.pending-plans.json` file and verify the GUI detects and displays it. |
| **10** | E2E | Use a real Claude session to generate a plan, approve it, and watch the child minion spawn. |

---

## Commit Log Plan

- `[feat] add SuperAgentInfo type extending AgentInfo` (DONE)
- `[feat] add SuperAgentView component skeleton with mock data` (DONE)
- `[feat] extract ChildStatusCard and PlanApproval components`
- `[feat] sidebar tree display for super/child hierarchy`
- `[feat] super mission creation form and routing`
- `[feat] AgentService support for super minion creation`
- `[feat] plan proposal detection and spawn logic`
- `[feat] finalize orchestration loop and rules file`
