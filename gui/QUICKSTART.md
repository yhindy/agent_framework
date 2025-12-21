# Quick Start Guide

Get the Minion Orchestrator GUI up and running in 5 minutes. 🍌

## Step 1: Prerequisites

```bash
# Verify Node.js is installed (need 18+)
node --version

# Verify you have the agent framework set up
ls minions/
```

## Step 2: Install Dependencies

```bash
cd gui
npm install

# Rebuild native modules for Electron
npx @electron/rebuild
```

This will take 1-2 minutes.

> **Note**: The `@electron/rebuild` step is important to ensure `node-pty` works with Electron's Node.js version.

## Step 3: Prepare Your Project

If you have an existing `ASSIGNMENTS.md`, migrate it:

```bash
cd ..  # Back to project root
node minions/bin/migrate-assignments.js
```

Otherwise, the `assignments.json` file was already created.

## Step 4: Start the App

```bash
cd gui
npm run dev
```

The app window will open automatically.

## Step 5: Select Your Project

1. Click "Select Project Folder"
2. Navigate to your project root (the one with `minions/`)
3. Click "Select"

## Step 6: Create Your First Mission

1. Click "+ New Mission"
2. Fill in:
   - **Minion ID**: `agent-1`
   - **Feature**: Describe what you want built (e.g., "Create a user authentication system")
   - **Tool**: `claude` (or `cursor`)
3. The branch name is auto-generated from your feature description
4. Click "Create Mission"

## Step 7: Start Working

### Option A: Use Claude CLI

1. Click `agent-1` in the sidebar
2. Set Mode to `planning`
3. Click "Start"
4. The terminal will open and run Claude
5. When Claude outputs `===SIGNAL:PLAN_READY===`, you'll see a notification!

### Option B: Use Cursor

1. Click `agent-1` in the sidebar
2. Set Tool to `cursor`
3. Click "Open in Cursor"
4. Work in Cursor normally

### Option C: Test the Signal System

1. Click `agent-1` in the sidebar
2. In the terminal, type:
   ```bash
   ../../minions/bin/test_signal.sh
   ```
3. Watch the signals appear as notifications!

## What's Next?

- Read [`TESTING.md`](TESTING.md) for comprehensive test scenarios
- Read [`README.md`](README.md) for full documentation
- Check out the signal protocol in `../minions/rules/orchestrator_signals.md`

## Troubleshooting

### "Project path does not exist"
Make sure you're selecting the actual project root, not a subdirectory.

### "Not a valid minion framework project"
Your project needs a `minions/` directory. Run `../minions/bin/init.sh` first.

### Terminal shows nothing
- Verify `claude` or `cursor` is installed: `which claude` / `which cursor`
- Check your PATH environment variable

### App won't start
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run dev
```

## Production Build

When ready to distribute:

```bash
npm run build
```

The app will be in the `dist/` folder.

---

**Happy minion-ing! 🍌**

