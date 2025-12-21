# Orchestrator Integration Signals

This document describes the signal protocol for AI agents to communicate with the Agent Orchestrator GUI.

## Overview

When running within the Agent Orchestrator, agents should output special signal markers to communicate their state and request user attention. The GUI terminal will parse these signals and update the UI accordingly.

## Signal Format

Signals are special lines output to stdout with the format:

```
===SIGNAL:<SIGNAL_NAME>===
```

**Important**: Signals must be on their own line and match the exact format above (case-sensitive).

## Available Signals

### `===SIGNAL:PLAN_READY===`

Output this signal when you have completed creating a plan and need human review.

**Example Usage:**
```bash
# After creating a plan
echo "I've created a detailed plan for the user authentication feature."
echo "===SIGNAL:PLAN_READY==="
```

**GUI Behavior:**
- Marks the agent as "Needs Review"
- Shows a badge/notification
- May highlight a "Review Plan" button

---

### `===SIGNAL:DEV_COMPLETED===`

Output this signal when you have completed implementation and the code is ready for review or testing.

**Example Usage:**
```bash
# After implementation
echo "Implementation complete. All tests passing."
echo "===SIGNAL:DEV_COMPLETED==="
```

**GUI Behavior:**
- Marks the agent as "Ready for Review"
- Shows a badge/notification
- May show "Test Code" or "Review Changes" buttons

---

### `===SIGNAL:BLOCKER===`

Output this signal when you encounter a blocker that requires immediate human intervention.

**Example Usage:**
```bash
# When blocked
echo "ERROR: Cannot proceed without database credentials."
echo "===SIGNAL:BLOCKER==="
```

**GUI Behavior:**
- High-priority notification
- Red badge on agent in sidebar
- May show system notification

---

### `===SIGNAL:QUESTION===`

Output this signal when you have a question for the user but it's not blocking progress.

**Example Usage:**
```bash
echo "Should I use PostgreSQL or MySQL for this feature?"
echo "===SIGNAL:QUESTION==="
```

**GUI Behavior:**
- Shows unread badge
- Highlights the agent in sidebar

---

### `===SIGNAL:WORKING===`

Output this signal to indicate you're actively working (optional, can be used for long-running tasks).

**Example Usage:**
```bash
echo "Running tests... (this may take a few minutes)"
echo "===SIGNAL:WORKING==="
```

**GUI Behavior:**
- Shows "working" indicator
- Clears any "attention needed" state

---

## Best Practices

1. **Only use signals at meaningful milestones** - Don't spam signals during normal operation.

2. **Output descriptive text before the signal** - The line(s) before the signal should explain the context.

3. **One signal per milestone** - Don't output multiple signals in rapid succession.

4. **Terminal compatibility** - Signals work alongside colored output and other terminal formatting.

## Examples

### Planning Workflow

```bash
echo "Analyzing requirements..."
# ... do work ...
echo ""
echo "Plan created: 5 components, 12 files to modify"
echo "Please review: docs/agents/assignments/agent-1-feature.md"
echo "===SIGNAL:PLAN_READY==="
```

### Development Workflow

```bash
echo "Implementing feature..."
# ... do work ...
echo ""
echo "✅ Implementation complete"
echo "✅ All tests passing"
echo "✅ Linting clean"
echo "===SIGNAL:DEV_COMPLETED==="
```

### Error Handling

```bash
if [ ! -f ".env" ]; then
  echo "❌ ERROR: .env file not found"
  echo "I need database credentials to proceed."
  echo "===SIGNAL:BLOCKER==="
  exit 1
fi
```

---

## Technical Notes

- Signals are detected by stripping ANSI escape codes from terminal output
- Signal detection is case-sensitive
- Signals on lines with other text will not be detected (must be alone on the line)

