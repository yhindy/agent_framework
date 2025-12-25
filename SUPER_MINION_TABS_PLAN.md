# Implementation Plan: Test Environment Tabs for Super Minion Agent

## Overview
Add a tab-based interface to the Super Minion agent view that displays test environments and allows creating new plain terminals, matching the functionality currently available in regular agent views.

## Current State Analysis

### What Works Today
- **Regular agents (AgentView.tsx)** have a complete tab system with:
  - Agent Terminal tab (main minion terminal)
  - Plain Terminal tabs (user-created shells)
  - Test Environment tabs (each test command gets a tab)
  - "Add Terminal" button for creating new shells

- **Super minion (SuperAgentView.tsx)** currently has:
  - Single collapsible terminal section for orchestration logs
  - Grid layout with active children and plan approval
  - No tab system or test environment integration

- **Test environments** are managed by TestEnvService.ts but only shown in regular agent views

### Gap
Super minion agents cannot access test environments or create additional terminals, limiting their ability to monitor and interact with the development environment during orchestration.

## Proposed Solution

### Architecture Changes

#### 1. Add Tab System to SuperAgentView
**File**: `gui/src/renderer/src/components/SuperAgentView.tsx`

**Changes**:
- Add `activeTab` state management (similar to AgentView)
- Create a tab bar component above the current terminal section
- Support three types of tabs:
  1. **Orchestration Terminal** (existing terminal, now in a tab)
  2. **Test Environment Tabs** (one per test command)
  3. **Plain Terminal Tabs** (user-created shells)

**UI Structure** (modify existing layout):
```
┌─────────────────────────────────────────────────────────┐
│ Header (Agent ID, Budget, Actions)                      │
├─────────────────────────────────────────────────────────┤
│ Info Bar (Mission Description)                          │
├─────────────────────────────────────────────────────────┤
│ ┌─ Tabs ─────────────────────────────────────────────┐ │
│ │ [Orchestration] [Test: Dev Server] [Terminal 1]    │ │
│ │                                     [+ Add Terminal]│ │
│ └───────────────────────────────────────────────────── ┘│
│ ┌─ Active Tab Content ──────────────────────────────┐ │
│ │                                                     │ │
│ │  [Terminal output or test environment controls]    │ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│ Grid Layout:                                            │
│ ┌──────────────────┬──────────────────────────────────┐ │
│ │ Active Children  │ Plan Approval                    │ │
│ └──────────────────┴──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Preserve Existing Behavior**:
- When in `planning` mode, show full-screen orchestration terminal (current behavior)
- Collapsible terminal functionality becomes collapsible tab section
- Grid layout remains below the tab section

#### 2. Integrate Test Environment Management
**File**: `gui/src/renderer/src/components/SuperAgentView.tsx`

**Add State Management**:
- Fetch test environment configuration from `window.electronAPI.getTestEnvConfig(agentId)`
- Track running test environments with `testEnvStatuses` state
- Subscribe to test environment events (`testEnv:started`, `testEnv:stopped`, `testEnv:output`)

**Add Controls**:
- Start/Stop buttons per test environment tab (similar to TestEnvPanel pattern)
- Status indicators (running/stopped dots)
- Port display if configured

#### 3. Add Plain Terminal Support
**File**: `gui/src/renderer/src/components/SuperAgentView.tsx`

**Add State Management**:
- Track plain terminals with `plainTerminals` state array
- Auto-increment terminal IDs (`terminal-1`, `terminal-2`, etc.)

**Add Controls**:
- "Add Terminal" button in tab bar
- Close buttons on plain terminal tabs
- Create terminals via `window.electronAPI.createPlainTerminal(agentId, terminalId)`

#### 4. Reuse Existing Components

**No changes needed** to these existing components (just import and use):
- `TestEnvTerminal.tsx` - for rendering test environment output
- `PlainTerminal.tsx` - for rendering plain shell terminals
- `Terminal.tsx` - for orchestration terminal (already in use)

**Services (no changes needed)**:
- `TestEnvService.ts` - already handles multi-agent test environments
- `TerminalService.ts` - already supports multiple terminals per agent

## Implementation Steps

### Step 1: Add Tab Bar UI Structure
- [ ] Add state variables to SuperAgentView:
  - `activeTab: string` (tracks which tab is visible)
  - `plainTerminals: string[]` (array of terminal IDs)
  - `testEnvStatuses: Record<string, boolean>` (running state per command)
  - `isTerminalCollapsed: boolean` (replaces current isCollapsed for tab section)

- [ ] Create tab bar component rendering:
  - Orchestration tab (always present)
  - Test environment tabs (from config)
  - Plain terminal tabs (from state)
  - Add Terminal button

- [ ] Add tab click handlers to switch `activeTab`

### Step 2: Implement Tab Content Rendering
- [ ] Create content section below tabs
- [ ] Conditionally render based on `activeTab`:
  - `orchestration` → existing Terminal component
  - `testEnv-{commandId}` → TestEnvTerminal component
  - `terminal-{id}` → PlainTerminal component

- [ ] Add collapse/expand functionality for entire tab section
- [ ] Maintain full-screen orchestration terminal in planning mode

### Step 3: Integrate Test Environment Data
- [ ] Fetch test env config on component mount via `window.electronAPI.getTestEnvConfig(agentId)`
- [ ] Subscribe to test environment events in useEffect:
  - `testEnv:started` → update testEnvStatuses
  - `testEnv:stopped` → update testEnvStatuses
  - `testEnv:exited` → update testEnvStatuses

- [ ] Add start/stop handlers:
  - Call `window.electronAPI.startTestEnv(agentId, commandId)`
  - Call `window.electronAPI.stopTestEnv(agentId, commandId)`

- [ ] Render status indicators (colored dots) in tab labels

### Step 4: Implement Plain Terminal Management
- [ ] Add "Add Terminal" button handler:
  - Generate new terminal ID (`terminal-${nextId}`)
  - Add to `plainTerminals` array
  - Call `window.electronAPI.createPlainTerminal(agentId, terminalId)`
  - Switch to new terminal tab

- [ ] Add close button handler for plain terminals:
  - Remove from `plainTerminals` array
  - Switch to previous tab
  - Call `window.electronAPI.closePlainTerminal(agentId, terminalId)`

- [ ] Prevent closing orchestration or test env tabs (only plain terminals closable)

### Step 5: Style and Polish
- [ ] Apply existing tab styles from AgentView (`.unified-tabs`, `.tab` classes)
- [ ] Add status indicators (running/stopped dots) to test env tabs
- [ ] Add close buttons (×) to plain terminal tabs
- [ ] Ensure responsive layout with grid below
- [ ] Add smooth collapse/expand animation for tab section

### Step 6: Testing
- [ ] Test with super minion that has test environments configured
- [ ] Test creating multiple plain terminals
- [ ] Test closing plain terminals
- [ ] Test starting/stopping test environments
- [ ] Test tab switching maintains terminal state
- [ ] Test planning mode still shows full-screen orchestration terminal
- [ ] Test collapse/expand functionality
- [ ] Test with super minion with no test environments (should only show orchestration tab)

## Files to Modify

### Primary Changes
1. **`gui/src/renderer/src/components/SuperAgentView.tsx`** (~300 lines changed)
   - Add tab state management
   - Add tab bar UI
   - Add tab content rendering
   - Integrate test environments
   - Add plain terminal support

### No Changes Needed (Reuse Existing)
- `gui/src/renderer/src/components/TestEnvTerminal.tsx` (existing component)
- `gui/src/renderer/src/components/PlainTerminal.tsx` (existing component)
- `gui/src/renderer/src/components/Terminal.tsx` (existing component)
- `gui/src/main/services/TestEnvService.ts` (existing service)
- `gui/src/main/services/TerminalService.ts` (existing service)

## Edge Cases to Handle

1. **No test environments configured**: Only show orchestration tab + ability to add plain terminals
2. **Planning mode**: Preserve full-screen orchestration terminal behavior
3. **Tab switching during terminal output**: Terminal components handle state preservation
4. **Super agent cleanup**: Ensure all terminals and test envs are cleaned up
5. **Test environment exit**: Handle graceful exit and update status indicators
6. **Rapid tab creation**: Prevent duplicate terminal IDs with proper ID generation

## Technical Considerations

### State Management
- Use React useState for local tab state (no global state needed)
- Test env statuses updated via event listeners
- Plain terminals managed as array of IDs

### Performance
- Terminal components already implement output caching and virtual scrolling
- Tab content only renders when active (conditional rendering)
- Event listeners cleaned up in useEffect cleanup

### Backward Compatibility
- Planning mode behavior preserved (full-screen orchestration terminal)
- Grid layout with children and plans remains below tabs
- Existing super minion features unaffected

## Success Criteria

- [ ] Super minion view has tab system matching regular agent view
- [ ] Test environments visible and controllable from super minion
- [ ] Can create and close plain terminals from super minion
- [ ] Tab switching works smoothly
- [ ] Orchestration logs still accessible (first tab)
- [ ] Planning mode still shows full-screen orchestration terminal
- [ ] Status indicators show test environment state accurately
- [ ] Grid layout with children and plans still functional below tabs

## Future Enhancements (Out of Scope)

- Drag-and-drop tab reordering
- Persistent tab preferences per super agent
- Split-pane view (multiple tabs visible simultaneously)
- Terminal search within tabs
- Tab keyboard shortcuts
