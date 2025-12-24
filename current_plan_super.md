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

- [x] **Milestone 10: Plan Detection and Display** ✅
  - Add `PLANS_READY` to `SIGNAL_PATTERNS` in `TerminalService`.
  - Update `SuperAgentView` to listen for `agent:signal` and reload.
  - Verified orchestration loop: Signal -> IPC -> Frontend Refresh -> Read JSON.
  - **Automated Testing**: Backend signal detection test and frontend integration test.

- [x] **Milestone 11: Plan Approval and Child Spawning** ✅
  - Implemented `approvePlan(projectPath, superAgentId, planId)` in `AgentService`.
  - Creates child worktrees with `parentAgentId` linked to super minion.
  - Updates `.pending-plans.json` status to `'approved'`.
  - Writes `.children-status.json` for super minion monitoring.
  - Wired frontend `SuperAgentView` to call IPC on approval button click.
  - **Automated Testing**: Comprehensive backend unit tests for approval flow.

- [ ] **Milestone 12: End-to-End Verification**
  - Full loop with real Claude session.

---

## Testing Strategy

| Milestone | Testing Type | Plan | Status |
|-----------|--------------|------|--------|
| **1-2** | Unit / Manual | Verify types and UI scaffolding. | ✅ Complete |
| **3-4** | Component | Verify components react to props. | ✅ Complete |
| **5-6** | Integration | Verify sidebar tree and routing. | ✅ Complete |
| **7** | Integration | Verify creation logic and persistence. | ✅ Complete |
| **8** | Component | Mock IPC and verify `SuperAgentView` renders real data. | ✅ Complete |
| **9** | Manual | Verify rules file content. | ✅ Complete |
| **10** | Automated | Backend signal detection + frontend integration tests. | ✅ Complete |
| **11** | Automated | Backend plan approval unit tests. | ✅ Complete |
| **12** | E2E | Real Claude session. | 🔄 Pending |

---

## Summary

### Completed Implementation
All core functionality for Super Minions is now complete:

**✅ Type System & UI**
- Recursive `SuperAgentInfo` type with child agents
- `SuperAgentView` with collapsible terminal and grid layout
- Reusable `ChildStatusCard` and `PlanApproval` components
- Sidebar integration with 👑 icon and expandable children
- Sleek modern styling

**✅ Backend Orchestration**
- `createSuperAssignment()` - Super minion creation with budget
- `getSuperAgentDetails()` - Runtime child assembly from `parentAgentId`
- `approvePlan()` - Plan approval → child spawning → status tracking
- File-based communication via `.pending-plans.json` and `.children-status.json`

**✅ Signal Protocol**
- `PLANS_READY` signal detection in `TerminalService`
- Automatic UI refresh on signal emission
- Frontend/backend signal integration

**✅ Testing**
- 20+ automated tests covering types, components, services, and integrations
- Full test coverage for approval flow and signal detection

### Remaining Work
- **M12**: End-to-end verification with a real Claude agent session
- Plan rejection UI (currently stubbed)
- Recursive super-children (super minion spawning another super minion)
