# Testing Guide for Minion Orchestrator GUI

This guide covers both automated and manual testing for the Minion Orchestrator GUI.

## Automated Testing

The project has comprehensive automated tests. This is the preferred way to verify functionality.

### Running Unit Tests

```bash
# RECOMMENDED: Run only tests affected by your changes (fast, memory-efficient)
npm run test:changed

# Run all unit tests
npm test

# Run specific test file
npm test -- src/main/services/__tests__/AgentService.test.ts

# Run with coverage
npm test -- --coverage
```

### Running E2E Tests

E2E tests use Playwright to test the actual Electron application.

```bash
# Run all E2E tests
npm run test:e2e

# Run with visible browser (debugging)
npm run test:e2e:headed

# Run specific tests by name
npm run test:e2e -- --grep "project selection"

# View HTML report after running
npm run test:e2e:report
```

See `CLAUDE.md` for more details on the test infrastructure.

---

## Manual Testing

Manual testing is useful for exploratory testing and UX verification.

### Prerequisites

1. Install dependencies:
   ```bash
   cd gui
   npm install
   ```

2. Start the app:
   ```bash
   npm run dev
   ```

## Test 1: Project Selection

**Objective**: Verify project picker and recent projects.

1. You should see the Project Picker screen on first launch.

2. Click "Select Project Folder" and navigate to a git repository.

3. **Expected Result**:
   - App loads the project successfully
   - If project doesn't have `minions.json`, setup wizard is offered
   - Project name appears in sidebar

4. Close and reopen the app.

5. **Expected Result**:
   - Project appears in "Recent Projects"
   - Clicking it loads the project immediately

**✅ Pass Criteria**: Project selection works, recent projects persist.

---

## Test 2: Missions Dashboard

**Objective**: Verify mission display and creation.

### Part A: View Agents

1. Navigate to Home (if not already there).

2. **Expected Result**:
   - Dashboard shows existing agents
   - Agent cards show ID, branch, tool, status

### Part B: Create Agent

1. Click "+" button to create new agent.

2. Fill in the form:
   - Branch name: `test-feature`
   - Prompt: `Test task description`
   - Tool: `claude`
   - Model: Select a model

3. Click "Create Mission".

4. **Expected Result**:
   - Modal closes
   - New agent appears in sidebar
   - `minions.json` file updated (if using new format)
   - `.minions/agents/{id}.json` created (if using new format)
   - Git worktree created

**✅ Pass Criteria**: Agents display correctly, new agents can be created.

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

2. In a terminal, edit agent state files:
   - For new format: Edit `.minions/agents/{id}.json`
   - For legacy format: Edit `.agent-info` file

3. **Expected Result**:
   - Sidebar updates automatically within 1-2 seconds
   - No need to refresh

4. Create a new agent worktree manually:
   ```bash
   ./minions/bin/setup.sh agent-new feature/agent-new/test
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

## Test 8: Signal Workflow

**Objective**: Test the signal protocol end-to-end.

1. In GUI, create or select an agent.

2. In the agent's terminal, manually echo signals to test detection:
   ```bash
   echo "===SIGNAL:PLAN_READY==="
   sleep 2
   echo "===SIGNAL:WORKING==="
   sleep 2
   echo "===SIGNAL:DEV_COMPLETED==="
   ```

3. **Expected Result**:
   - `===SIGNAL:PLAN_READY===` → GUI shows notification
   - `===SIGNAL:WORKING===` → GUI shows "working" status
   - `===SIGNAL:DEV_COMPLETED===` → GUI shows "completed" status

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

### "Agent not found" error
- Run `setup.sh` to create the worktree first
- For new format: Check that `.minions/agents/{id}.json` exists
- For legacy format: Check that `.agent-info` file exists in worktree

### Terminal not showing output
- Verify the tool (`claude`, `cursor`, `codex`) is installed
- Check PATH environment variable
- Look at Electron dev console for errors (Cmd+Option+I / Ctrl+Shift+I)

### Signals not detected
- Ensure signal is on its own line
- Check exact format: `===SIGNAL:NAME===`
- Verify TerminalService is running (check console logs)

### File watcher not updating
- Check file permissions on project directory
- For new format: Try `touch .minions/agents/{id}.json`
- For legacy format: Try `touch minions/config.json`

### Tmux issues
- Verify tmux is installed: `which tmux`
- Check terminal mode in Settings (can fall back to tabs mode)
- If tmux session is stuck: `tmux kill-session -t minion-{agentId}`

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

