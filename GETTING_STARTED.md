# 👋 Getting Started with Agent Framework

Welcome! This guide will help you set up and start using the Agent Framework to run multiple AI coding agents in parallel.

## What is This?

The **Agent Framework** (aka Minion Framework) lets you:
- Run multiple AI coding agents at the same time on different features
- Keep agents isolated using git worktrees (no conflicts!)
- Manage everything through a friendly desktop GUI
- Give agents specific missions and monitor their progress

Think of it like having a team of helpful AI assistants, each working on their own task.

---

## Prerequisites

Before you start, make sure you have:

- **Node.js 18+** - [Download from nodejs.org](https://nodejs.org)
- **Git** - [Download from git-scm.com](https://git-scm.com) (or use your package manager)
- **Python 3** - Usually pre-installed on Mac/Linux. Windows users: [python.org](https://python.org)

To check if you have these:
```bash
node -v    # Should show v18.x.x or higher
git --version
python3 --version
```

---

## Step 1: First-Time Setup 🛠️

Run the setup script from the agent_framework directory:

```bash
./setup.sh
```

This will:
1. ✅ Check that you have all the requirements
2. 📦 Install all dependencies (npm packages)
3. 🔧 Rebuild native modules for the GUI

**First run takes 2-5 minutes.** Grab a coffee! ☕

### Troubleshooting Setup

If you see errors:

- **"node: command not found"** → Install Node.js from [nodejs.org](https://nodejs.org)
- **"Node.js 18+ required"** → Update Node.js to the latest LTS version
- **npm install interrupted/failed** → Run `rm -rf node_modules package-lock.json && ./setup.sh` to start fresh
- **"Cannot find module" errors** → Same as above - clean reinstall
- **Rebuild errors on Linux** → You may need build tools: `sudo apt install build-essential`

---

## Step 2: Launch the GUI 🚀

Once setup is complete, start the application:

```bash
./run.sh
```

This opens the **Agent Framework GUI** - your mission control for managing AI agents!

The GUI will open in a new window. You should see:
- A sidebar (empty at first - no projects yet)
- A "Select Project Folder" button

---

## Step 3: Add Your First Project 📁

1. **Click "Select Project Folder"** in the GUI
2. **Navigate to a git repository** you want to work on
3. The framework will detect if it's already installed in that project
4. If not installed, click **"Install Framework"** when prompted

**Important:** The project MUST be a git repository. The framework uses git worktrees to isolate agent work.

### What Gets Installed?

When you install the framework into a project, it adds:
```
your-project/
├── minions/              # Agent management scripts
│   ├── bin/             # CLI tools (setup, teardown, etc.)
│   ├── assignments/     # Mission files go here
│   ├── rules/           # Agent behavior guidelines
│   └── templates/       # Mission templates
└── .cursor/rules/       # Cursor IDE integration
    └── agent-rules.mdc
```

---

## Step 4: Create Your First Agent 🤖

1. **In the GUI sidebar**, click **"+ Add Agent"**
2. **Enter a branch name** like `feature/agent-1/add-dark-mode`
3. **Click "Create"**

This creates a git worktree - an isolated copy of your project where the agent can work safely.

Behind the scenes, this runs:
```bash
./minions/bin/setup.sh agent-1 feature/agent-1/add-dark-mode
```

Your agent now has its own workspace at `../yourproject-agent-1/`

---

## Step 5: Give Your Agent a Mission 📝

Agents work best when they have clear instructions. Create a mission file:

1. **Copy the template:**
   ```bash
   cd /path/to/your/project
   cp minions/templates/FEATURE_SPEC.md minions/assignments/agent-1-dark-mode.md
   ```

2. **Edit the mission file** with your requirements:
   ```markdown
   # Mission: Add Dark Mode Toggle

   ## Objective
   Add a dark mode toggle to the application settings page.

   ## Allowed Files
   - src/components/Settings.tsx
   - src/styles/theme.css
   - src/hooks/useDarkMode.ts

   ## Blocked Files
   - src/database/**
   - *.config.js

   ## Requirements
   - Toggle persists to localStorage
   - Smooth transition between themes
   - Accessibility: respects prefers-color-scheme
   ```

3. **In the GUI**, select your agent and click **"Assign Mission"** (if available), or just tell the AI to read the file

---

## Step 6: Start Your AI Tool 🎯

The GUI has a built-in terminal for each agent. You can start any AI coding tool:

### Option A: Claude Code (CLI)
```bash
claude "Read minions/assignments/agent-1-dark-mode.md and implement the feature"
```

### Option B: Cursor IDE
1. Open the agent's worktree folder in Cursor: `../yourproject-agent-1/`
2. Start a Cursor agent session
3. Point it to the mission file

### Option C: Any Other AI Tool
Just navigate to the agent's worktree and start your tool:
```bash
cd ../yourproject-agent-1
aider  # or any other tool
```

---

## Step 7: Monitor Progress 👀

The GUI shows you what your agents are doing:

- **Status Indicators**: 🟢 Active, 🟡 Idle, 🔴 Needs Review
- **Live Terminal**: See exactly what the agent is doing
- **Signals**: Agents can emit status signals like:
  - `===SIGNAL:PLAN_READY===` - Agent has a plan for you to review
  - `===SIGNAL:DEV_COMPLETED===` - Implementation done, ready for review
  - `===SIGNAL:BLOCKER===` - Agent is stuck and needs help
  - `===SIGNAL:QUESTION===` - Agent has a non-blocking question

These signals appear in the terminal output and can trigger GUI notifications.

---

## Step 8: Review and Merge 🎉

When your agent finishes:

1. **Review the code** in the agent's worktree
2. **Run tests** to make sure everything works
3. **Merge the branch** into your main branch:
   ```bash
   git checkout main
   git merge feature/agent-1/add-dark-mode
   ```
4. **Remove the agent** in the GUI (or run `./minions/bin/teardown.sh agent-1`)

The agent's worktree gets cleaned up, and you're ready to create another agent!

---

## Running Multiple Agents in Parallel 🚄

The real power is running multiple agents at once:

1. **Create agent-1** for Feature A (e.g., dark mode)
2. **Create agent-2** for Feature B (e.g., add search)
3. **Create agent-3** for Feature C (e.g., fix login bug)

**Key Rule:** Make sure agents work on **different files** to avoid conflicts!

The GUI lets you monitor all agents from one window.

---

## Tips for Success 💡

### Keep Missions Small
- Features completable in 1-2 hours work best
- Break large features into smaller missions

### Assign Non-Overlapping Files
- Each agent should modify different files
- Use the "Allowed Files" section in mission specs

### Review Frequently
- Check agent progress every 15-30 minutes
- Course-correct early if the agent goes off track

### Merge Often
- Don't let branches diverge too far from main
- Merge completed work promptly

---

## Next Steps 🎓

You're all set! Here are some resources:

- **For Users**: Check out the main [README.md](README.md) for more features
- **For Developers**: Read [CLAUDE.md](CLAUDE.md) to understand the codebase
- **For Advanced Usage**: Explore CLI commands in `minions/bin/`

### Quick CLI Reference

All commands run from your project root (where `minions/` is installed):

```bash
# List all active agents
./minions/bin/list.sh

# Create an agent manually (if not using GUI)
./minions/bin/setup.sh agent-2 feature/agent-2/my-feature

# Remove an agent
./minions/bin/teardown.sh agent-2

# Force remove (discards uncommitted changes)
./minions/bin/teardown.sh agent-2 --force

# Check that everything is set up correctly
./minions/bin/preflight.sh
```

---

## Getting Help 🆘

Having trouble?

1. **Check the GUI logs** - Look for error messages in the terminal output
2. **Read the mission file** - Make sure instructions are clear
3. **Verify git status** - Run `git status` in the agent's worktree
4. **Review CLAUDE.md** - Detailed architecture and troubleshooting info

---

## What's Next?

Now that you're set up:

1. 🎯 Try creating your first agent with a simple mission
2. 🔍 Explore the GUI features (terminals, signals, project switching)
3. 🚀 Run multiple agents in parallel on real work

Happy agent orchestrating! 🎉
