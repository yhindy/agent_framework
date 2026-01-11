# Cloud Background Agent Guidelines

This document provides guidance for agents on when and how to use cloud background agents for compute-heavy work.

## Overview

The Agent Framework uses a **local test budget** to prevent resource exhaustion. When the budget is exhausted, compute-heavy tasks are offloaded to cloud background agents running on remote infrastructure.

## Local Test Budget

The framework enforces a local budget for resource-intensive operations:

| Resource | Default Limit | Purpose |
|----------|---------------|---------|
| Concurrent test runs | 1 | Prevent CPU/memory exhaustion |
| Concurrent builds | 1 | Prevent disk I/O contention |

## When to Use Cloud Agents

### Automatic Offloading

The orchestrator automatically handles these scenarios:

1. **Test Runs** - When local budget is exhausted, tests run on cloud agents
2. **CI Builds** - Large builds may be offloaded automatically
3. **Parallel Work** - Multiple compute-heavy tasks trigger cloud offloading

### Manual Cloud Agent Usage

When you need to run compute-heavy work while continuing interactive development, use `run_in_background=true`:

```
Task(subagent_type="general-purpose",
     description="Run full test suite",
     prompt="Run npm test and report all results",
     run_in_background=true)  ← KEY: This runs on cloud compute!
```

**The `run_in_background=true` parameter:**
- Spawns the agent on cloud infrastructure (not local)
- Returns immediately with an `output_file` path
- Frees your local machine for interactive work
- Agent appears in sidebar with ☁️ icon

## Identifying Cloud vs Local Agents

Cloud agents are marked in the UI and data model:

```typescript
interface AgentSession {
  // ...
  isCloudAgent?: boolean  // True if running in cloud/background
}
```

**UI Indicators:**
- Cloud agents display with a cloud icon in the sidebar
- Local agents display with the standard agent icon

## Best Practices

### 1. Be Aware of Resource Constraints

Before running expensive operations, consider:
- Is another agent already running tests locally?
- Would this benefit from cloud execution?
- Can this wait for local budget to free up?

### 2. Prefer Cloud for Parallel Work

When working alongside other agents:
```
Good:
- Run tests in cloud agent while editing locally
- Spawn background task for large build

Avoid:
- Multiple agents running tests locally simultaneously
- Blocking interactive work with long-running builds
```

### 3. Use Task Tool for Heavy Compute

The Task tool in Claude Code can spawn agents that run on cloud compute:

```
# Spawn a cloud agent for test execution
Task(subagent_type="general-purpose",
     description="Execute test suite",
     prompt="Run: npm test -- --coverage. Report pass/fail counts and coverage.",
     run_in_background=true)  ← Runs on cloud!
```

**Checking results later:**
```
# The task returns an output_file path
Read(file_path="/path/to/output_file")
```

### 4. Check Budget Before Intensive Operations

If you're uncertain about resource availability:
1. Check the sidebar for actively running agents
2. Look for spinning indicators (local compute in use)
3. Consider using cloud offloading for non-blocking work

## Configuration

Projects can configure cloud agent behavior in `minions/config.json`:

```json
{
  "testBudget": {
    "maxLocalConcurrent": 1,
    "enableCloudOverflow": true
  }
}
```

| Setting | Description |
|---------|-------------|
| `maxLocalConcurrent` | Max simultaneous local test runs (default: 1) |
| `enableCloudOverflow` | Enable cloud offloading when budget exhausted (default: true) |

## Signal Protocol for Cloud Agents

Cloud agents use the same signal protocol as local agents:

```bash
===SIGNAL:WORKING===      # Cloud agent actively processing
===SIGNAL:DEV_COMPLETED=== # Cloud work finished
===SIGNAL:BLOCKER===      # Cloud agent blocked (rare)
```

## Troubleshooting

### Cloud Agent Not Appearing

1. Check that cloud overflow is enabled in config
2. Verify the cloud infrastructure is accessible
3. Check orchestrator logs for errors

### Tests Not Offloading

1. Verify local budget is actually exhausted
2. Check `enableCloudOverflow: true` in config
3. Ensure the orchestrator is running

### Cloud Agent Stuck

1. Check cloud infrastructure status
2. Review agent logs for errors
3. The orchestrator will timeout and report stuck agents

---

## Summary

- **Default Budget**: 1 concurrent local test run
- **Overflow**: Automatic offloading to cloud agents
- **UI**: Cloud agents marked with cloud icon
- **Task Tool**: Use for manual cloud execution
- **Config**: `minions/config.json` for budget settings
