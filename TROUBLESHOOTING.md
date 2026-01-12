# Troubleshooting Guide

This guide covers common issues and their solutions when using the Minion Framework.

---

## Table of Contents

- [macOS Notifications](#macos-notifications)
- [Native Module Issues](#native-module-issues)
- [Claude Session Detection](#claude-session-detection)
- [Codex Tool Issues](#codex-tool-issues)
- [Build and CI Issues](#build-and-ci-issues)
- [E2E Test Issues](#e2e-test-issues)
- [Git Worktree Issues](#git-worktree-issues)

---

## macOS Notifications

The GUI sends desktop notifications when agents need attention (e.g., waiting for input, plan ready for review). If notifications aren't working on macOS, follow these steps:

### 1. Enable Notifications in System Settings

1. Open **System Settings** (or System Preferences on older macOS)
2. Go to **Notifications**
3. Find **Agent Orchestrator** (or **Electron** if running in dev mode) in the app list
4. Enable the following:
   - **Allow Notifications**: On
   - **Show in Notification Center**: On
   - **Show on Lock Screen**: Optional
   - **Play sound for notifications**: Recommended
   - **Badge app icon**: Optional
   - **Alert style**: Choose "Alerts" or "Banners"

### 2. Grant Notification Permissions (First Launch)

On first launch, macOS should prompt for notification permissions. If you dismissed this prompt:

1. Open **System Settings** > **Privacy & Security** > **Notifications**
2. Enable notifications for the app

### 3. Development Mode Considerations

When running in development mode (`npm run gui:dev`), the app runs as "Electron" rather than "Agent Orchestrator":

- Look for **Electron** in your notification settings
- The app must appear in the Dock for notifications to work
- The framework automatically shows the dock icon in dev mode

### 4. Notification Not Appearing?

If notifications still don't appear:

1. **Check Focus Mode**: Ensure "Do Not Disturb" or Focus modes aren't blocking notifications
2. **Check app focus**: Notifications only appear when the app window is unfocused (by design, to avoid interrupting you while actively using the app)
3. **Check cooldown**: There's a 30-second cooldown between notifications for the same agent to prevent spam
4. **Restart the app**: Sometimes macOS needs a fresh app launch to register notification permissions

### 5. Testing Notifications

To test if notifications are working:

1. Start an agent with a task
2. Switch to another application (unfocus the Agent Orchestrator window)
3. Wait for the agent to complete a task or request input
4. A notification should appear

### 6. Notification Behavior

Understanding when notifications are sent:

| Event | Notification? | Notes |
|-------|--------------|-------|
| Agent waiting for input | Yes | When Claude/Cursor/Codex needs your input |
| Agent completed task | Yes | Task finished successfully |
| Plan ready for review | Yes | Super minion has a plan to approve |
| Agent actively working | No | No notification while agent is busy |
| Window is focused | No | Notifications suppressed when app is in focus |

---

## Native Module Issues

### node-pty Build Failures

If you see errors related to `node-pty` during installation or build:

```bash
# Rebuild native modules for your Electron version
cd gui && npm run rebuild
```

### Missing Native Dependencies

On some systems, you may need build tools:

**macOS:**
```bash
xcode-select --install
```

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential python3
```

---

## Claude Session Detection

The framework monitors Claude's JSONL session files to detect when Claude is waiting for input.

### Session Not Detected

If the GUI doesn't detect when Claude is waiting:

1. **Check JSONL file exists**: Claude stores session data in `~/.claude/projects/<project-hash>/`
2. **Verify session ID**: The session ID in `.agent-info` should match an active session
3. **Check file permissions**: The app needs read access to the `~/.claude` directory
4. **View logs**: Check the terminal output for `[ClaudeSessionInfoService]` messages

### Common JSONL Issues

- **Stale session**: If you killed Claude and restarted, the old session ID may be invalid
- **Wrong project**: Claude uses project-specific folders; ensure you're in the right worktree
- **File locking**: On some systems, the JSONL file may be locked during writes

---

## Codex Tool Issues

### Codex Command Not Found

If Codex isn't available:

```bash
# Check if codex is installed
which codex

# If not found, install it
npm install -g openai-codex-cli

# Verify PATH includes npm global bin
npm bin -g
```

The `install.sh` script warns if `codex` is not found but allows installation to continue.

### API Key Issues

Codex requires an OpenAI API key:

```bash
# Set the environment variable
export OPENAI_API_KEY="your-api-key-here"

# Add to shell config for persistence
echo 'export OPENAI_API_KEY="your-key"' >> ~/.zshrc

# Reload shell config
source ~/.zshrc

# Test directly
codex --model gpt-5.2-codex "test prompt"
```

### Model Selection Not Available

This is expected behavior. Codex always uses the `gpt-5.2-codex` model, which is hardcoded in the TerminalService. Model selection in the GUI is disabled for Codex.

---

## Build and CI Issues

### electron package not found

If the GUI build fails with "Cannot find module 'electron/package.json'":

1. Verify `electron` is in root `package.json` devDependencies
2. Check installation: `ls node_modules/electron/package.json`
3. Reinstall dependencies: `npm ci`

See [Dependency Management](CLAUDE.md#dependency-management) for the convention on where to place dependencies.

### Tests Fail in CI but Pass Locally

Common causes:

- **Node.js version mismatch**: CI uses Node.js 20.x
- **Native module architecture**: Modules built for different OS/arch
- **Platform-specific paths**: Check for hardcoded paths or separators
- **Timing issues**: CI runners may be slower; increase timeouts if needed

### Type Check Failures

```bash
# Run type check locally
cd gui && npm run typecheck

# Fix errors before committing
```

---

## E2E Test Issues

### Tests Hang or Timeout

1. **Build first**: `npm run build -w gui`
2. **Check for zombie processes**: Kill any lingering Electron processes
3. **Increase timeout**: Edit `playwright.config.ts` if needed

### Cannot Find electronAPI

The app may not have fully loaded. Ensure tests call `waitForAppReady()` before interacting with the API.

### Tests Fail in CI but Pass Locally

- CI uses macOS runner - check for platform-specific issues
- Install Playwright browsers: `npx playwright install chromium`
- Check artifacts in GitHub Actions for screenshots and traces

### Viewing Test Results

After running E2E tests:
- **JSON results**: `gui/e2e-results.json`
- **HTML report**: `gui/e2e-report/` (open with `npm run test:e2e:report`)
- **Failure artifacts**: `gui/e2e-results/` (screenshots, traces)

---

## Git Worktree Issues

### Worktree Creation Fails

```bash
# List existing worktrees
git worktree list

# Remove stale worktree references
git worktree prune

# Try creating again
./minions/bin/setup.sh agent-1 feature/my-feature
```

### Branch Already Exists

If the branch already exists remotely:

```bash
# Fetch remote branches
git fetch origin

# Create worktree from existing branch
git worktree add ../yourproject-agent-1 feature/existing-branch
```

### Worktree Cleanup Issues

If teardown fails:

```bash
# Manual cleanup
cd /path/to/main/repo
git worktree remove ../yourproject-agent-1 --force

# If still stuck
rm -rf ../yourproject-agent-1
git worktree prune
```

---

## Getting More Help

If your issue isn't covered here:

1. Check the [CLAUDE.md](CLAUDE.md) file for additional technical details
2. Review the [GUI README](gui/README.md) for GUI-specific information
3. Open an issue on the repository with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant logs or error messages
   - OS and Node.js version
