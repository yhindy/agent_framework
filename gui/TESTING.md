# Testing Guide for Minion Orchestrator GUI

This guide walks you through testing all the features of the Minion Orchestrator GUI.

## Prerequisites

1. Install dependencies:
   ```bash
   cd gui
   npm install
   ```

2. Create test data:
   ```bash
   # From project root
   node minions/bin/migrate-assignments.js
   ```

## Test 1: Project Selection

**Objective**: Verify project picker and recent projects.

1. Start the app:
   ```bash
   npm run dev
   ```

2. You should see the Project Picker screen.

3. Click "Select Project Folder" and navigate to this repository root.

4. **Expected Result**: 
   - App loads the project successfully
   - You're redirected to the Dashboard
   - Project name appears in sidebar

5. Close and reopen the app.

6. **Expected Result**:
   - Project appears in "Recent Projects"
   - Clicking it loads the project immediately

**✅ Pass Criteria**: Project selection works, recent projects persist.

---

## Test 2: Missions Dashboard

**Objective**: Verify mission display and creation.

### Part A: View Assignments

1. Navigate to Home (if not already there).

2. **Expected Result**:
   - Four columns: Pending, In Progress, Review, Completed
   - Mission cards show minion ID, feature name, branch, tool, mode

### Part B: Create Mission

1. Click "+ New Mission" button.

2. Fill in the form:
   - Minion ID: `agent-1`
   - Feature: `Test Feature` (or any description)
   - Tool: `claude`
   - Note: Branch name is auto-generated

3. Click "Create Mission".

4. **Expected Result**:
   - Modal closes
   - New assignment appears in "Pending" column
   - `assignments.json` file updated
   - (Optionally) `setup.sh` runs and creates worktree

**✅ Pass Criteria**: Assignments display correctly, new missions can be created.

---

## Test 3: Sidebar and Navigation

**Objective**: Verify sidebar navigation and Minion list.

1. Look at the sidebar.

2. **Expected Result**:
   - "Home" button at top
   - "Agents" section below
   - If worktrees exist, they appear in the list

3. Click "Home".

4. **Expected Result**: Dashboard loads.

5. If you have an agent, click on it.

6. **Expected Result**: 
   - Minion View loads
   - Sidebar highlights the active minion

**✅ Pass Criteria**: Navigation works, sidebar updates correctly.

---

## Test 4: Terminal Integration (Basic)

**Objective**: Verify terminal can run and display output.

### Part A: Test with Simple Command

1. Create a test worktree manually:
   ```bash
   # From project root
   ./minions/bin/setup.sh agent-test feature/agent-test/terminal-test
   ```

2. In the GUI, the agent should appear in the sidebar after a moment (file watcher).

3. Click on `agent-test`.

4. Select:
   - Tool: `cursor-cli` or `claude` (whichever you have installed)
   - Mode: `planning`

5. Click "Start".

6. **Expected Result**:
   - Terminal appears
   - Shell prompt shows
   - You can type commands

7. Type: `echo "Hello from terminal"`

8. **Expected Result**: 
   - Output appears in terminal
   - Text is properly colored/formatted

**✅ Pass Criteria**: Terminal spawns, input/output works.

---

## Test 5: Signal Detection

**Objective**: Verify the GUI detects Minion signals.

1. Make sure you have an minion running in the terminal.

2. In the terminal, type:
   ```bash
   echo "===SIGNAL:PLAN_READY==="
   ```

3. **Expected Result**:
   - Blue banner appears: "✓ Plan is ready for review"
   - Banner auto-dismisses after 5 seconds

4. Try other signals:
   ```bash
   echo "===SIGNAL:BLOCKER==="
   ```

5. **Expected Result**:
   - Orange/red banner: "⚠️ Minion is blocked..."
   - Banner persists (doesn't auto-dismiss)

**✅ Pass Criteria**: Signals are detected and displayed correctly.

---

## Test 6: File Watching

**Objective**: Verify the GUI updates when files change.

1. Keep the GUI open with a project loaded.

2. In a terminal, edit `minions/assignments.json`:
   - Change a feature name
   - Change a status

3. **Expected Result**:
   - Dashboard updates automatically within 1-2 seconds
   - No need to refresh

4. Create a new agent worktree manually:
   ```bash
   ./scripts/agents/setup.sh agent-new feature/agent-new/test
   ```

5. **Expected Result**:
   - New agent appears in sidebar automatically

**✅ Pass Criteria**: GUI reacts to file system changes.

---

## Test 7: "Open in Cursor" Button

**Objective**: Verify Cursor integration.

1. Click an minion in the sidebar.

2. Click "Open Folder" or "Open in Cursor" button.

3. **Expected Result**:
   - Cursor IDE opens (or comes to front)
   - The minion's worktree folder is opened

**✅ Pass Criteria**: External Cursor launch works.

---

## Test 8: Test Script Workflow

**Objective**: Run a complete simulated workflow.

1. In GUI, create or select a minion.

2. Set:
   - Tool: `cursor-cli` (or just run in external terminal)
   - Mode: `planning`

3. In the agent's worktree directory, run:
   ```bash
   ../../minions/bin/test_signal.sh
   ```

4. **Expected Result**:
   - Terminal shows animated workflow
   - `===SIGNAL:PLAN_READY===` appears → GUI shows notification
   - `===SIGNAL:WORKING===` appears → GUI shows "working"
   - `===SIGNAL:DEV_COMPLETED===` appears → GUI shows "completed"

**✅ Pass Criteria**: Full signal workflow works end-to-end.

---

## Test 9: Stop Minion

**Objective**: Verify minion can be stopped.

1. Start an agent with a long-running command:
   ```bash
   # In terminal view
   sleep 100
   ```

2. Click "Stop" button.

3. **Expected Result**:
   - Terminal process is killed
   - "Start" button reappears
   - Terminal no longer accepts input

**✅ Pass Criteria**: Stop functionality works.

---

## Test 10: Terminal Resize

**Objective**: Verify terminal resizes correctly.

1. Open an agent with a running terminal.

2. Resize the application window (make it smaller, then larger).

3. **Expected Result**:
   - Terminal content reflows to fit
   - No weird text wrapping or cutoff

**✅ Pass Criteria**: Terminal adapts to window size.

---

## Common Issues

### "Minion not found" error
- Run `setup.sh` to create the worktree first
- Check that `.agent-info` file exists in worktree

### Terminal not showing output
- Verify the tool (`claude`, `cursor`) is installed
- Check PATH environment variable
- Look at Electron dev console for errors (Cmd+Option+I / Ctrl+Shift+I)

### Signals not detected
- Ensure signal is on its own line
- Check exact format: `===SIGNAL:NAME===`
- Verify TerminalService is running (check console logs)

### File watcher not updating
- Check file permissions on `minions/`
- Try manually triggering: touch `assignments.json`

---

## Automated Testing (Future)

To add automated tests:

1. **Unit tests**: Test services in isolation
   ```bash
   npm install --save-dev vitest
   # Add tests in src/main/services/*.test.ts
   ```

2. **Integration tests**: Test IPC communication
   ```bash
   npm install --save-dev @electron/playwright
   ```

3. **E2E tests**: Test full UI flows
   ```bash
   npm install --save-dev playwright
   ```

---

## Performance Testing

Monitor performance:

1. Open Electron DevTools (Cmd+Option+I)
2. Go to Performance tab
3. Record while interacting with the app
4. Look for:
   - Long tasks (> 50ms)
   - Memory leaks
   - Excessive re-renders

---

## Reporting Bugs

When reporting issues, include:

1. Steps to reproduce
2. Expected vs actual behavior
3. Console logs (from main process and renderer)
4. Screenshots
5. OS version and Electron version

---

Good luck testing! 🚀

