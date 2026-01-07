# How to Use the Agent Framework

This guide covers how to use the Agent Framework after you've completed setup.

## Starting the GUI

```bash
./run.sh
```

This opens the Agent Framework GUI (Electron app).

---

## Step 1: Select a Project

When the GUI opens, click **"Select Project Folder"** and choose a git repository you want to work with.

- The project must be a git repository
- If the minion framework isn't installed yet, the GUI will offer to install it

---

## Step 2: Create an Agent

1. Click **"+ Add Agent"** in the sidebar
2. Enter a branch name (e.g., `feature/agent-1/my-feature`)
3. Click **Create**

This creates a git worktree with an isolated working directory for the agent to work in.

---

## Step 3: Assign a Mission

1. Create a mission file:
   ```bash
   cp minions/templates/FEATURE_SPEC.md minions/assignments/agent-1-my-feature.md
   ```

2. Edit the mission file with your requirements:
   - Feature description
   - Allowed files (what the agent can modify)
   - Blocked files (what the agent should NOT touch)

3. In the GUI, select the agent and assign the mission file

---

## Step 4: Start an AI Tool

The GUI has built-in terminal integration. You can:

1. **Click the terminal tab** for an agent
2. **Start your AI tool** in that terminal:

| Tool | Command |
|------|---------|
| Claude Code | `claude "Read mission and implement"` |
| Cursor IDE | Open the worktree folder in Cursor |

---

## Step 5: Monitor Progress

The GUI shows:
- **Agent status** - Active, idle, needs review
- **Terminal output** - Live view of agent work
- **Signals** - Agents emit signals like `===SIGNAL:PLAN_READY===` to indicate status

---

## Removing an Agent

When an agent is done:

1. Review and merge the agent's branch
2. Click **"Remove"** on the agent in the sidebar
3. Or use the CLI: `./minions/bin/teardown.sh agent-1`

---

## CLI Commands Reference

All commands run from your project root (where minions/ is installed):

```bash
# List all agent worktrees
./minions/bin/list.sh

# Create a new agent worktree
./minions/bin/setup.sh agent-1 feature/agent-1/my-feature

# Remove an agent worktree
./minions/bin/teardown.sh agent-1

# Force remove (discards uncommitted changes)
./minions/bin/teardown.sh agent-1 --force

# Verify setup
./minions/bin/preflight.sh
```

---

## Tips

- **Keep missions small** - Features completable in 1-2 hours work best
- **Assign non-overlapping files** - Each agent should touch different files
- **Review frequently** - Check agent progress and course-correct early
- **Merge often** - Don't let branches diverge too far
