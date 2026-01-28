---
name: Super Handoff
description: Spawn super minions for delegated workflow tasks
---

# Super Handoff Skill

This skill allows you to spawn multiple "super minions" - workflow-driven agents that work on tasks in parallel.

## When to Use

- When you have multiple independent tasks that can be parallelized
- When tasks require structured workflows (debugging, feature development)
- When you want to delegate work while continuing your own task

## How to Invoke

You can invoke this skill by:
1. Using `/super-handoff` command with optional arguments
2. Using natural language like "spawn super minions for these tasks"

## Arguments

- `--plan <text>`: Inline plan for a single spawn
- No arguments: Interactive mode asking for spawn details

## API Integration

This skill calls the local orchestrator API:
- Endpoint: `POST http://127.0.0.1:19234/api/spawn-super`
- The orchestrator will create fresh worktrees and start agents

## API Request Format

```json
{
  "sourceAgentId": "your-current-agent-id",
  "spawns": [
    {
      "plan": "Description of work for this super minion",
      "workflowId": "debug-workflow",  // Optional: auto-detected if omitted
      "shortName": "fix-auth"          // Optional: custom branch suffix
    },
    {
      "plan": "Another task description"
    }
  ]
}
```

## Available Workflows

- **default** (Standard Workflow): 5-phase workflow with acceptance criteria, design, review, implement, validate
- **debug-workflow** (Debug Workflow): Systematic debugging: reproduce, investigate, fix, verify

Workflow is auto-detected based on keywords in the plan:
- 2+ debug keywords (debug, bug, fix, investigate, root cause, crash, broken, failing, error, issue) -> Debug Workflow
- Otherwise -> Standard Workflow

For reliability, specify explicit `workflowId` in your request.

## Natural Language Triggers

The following phrases trigger super minion spawning:
- "spawn super minions for these"
- "delegate these to workflows"
- "create super agents for"
- "spin up workflows for"
- "start parallel agents for"

## Output Format

Present spawns in a table before confirmation:

| # | Feature | Workflow | Branch |
|---|---------|----------|--------|
| 1 | Fix login bug | Debug | fix-login |
| 2 | Add caching | Standard | add-cache |

## Confirmation Flow

Ask for confirmation using AskUserQuestion with these exact options:

```
AskUserQuestion(questions=[{
  "question": "Ready to spawn X super minions. Each will work independently in its own worktree. Proceed?",
  "header": "Spawn",
  "options": [
    {"label": "Spawn all", "description": "Create all super minions and start them"},
    {"label": "Modify list", "description": "Edit the spawn list before proceeding"},
    {"label": "Cancel", "description": "Abort the operation"}
  ],
  "multiSelect": false
}])
```

- If "Spawn all" -> Call API and show results
- If "Modify list" -> Ask what to change, then re-present table
- If "Cancel" -> Abort without calling API

## Error Handling

### API Unreachable

If connection to `localhost:19234` fails:

```
Unable to reach the orchestrator API at localhost:19234.

This usually means the Minion GUI is not running.

AskUserQuestion(questions=[{
  "question": "Would you like to retry connecting to the orchestrator?",
  "header": "Retry",
  "options": [
    {"label": "Retry", "description": "Try connecting again"},
    {"label": "Cancel", "description": "Abort the spawn operation"}
  ]
}])
```

### Partial Failure

If some spawns succeed and others fail:

```
Spawned 2 of 3 super minions:

[SUCCESS] project-user-auth (Standard) - Started
[SUCCESS] project-search-api (Standard) - Started
[FAILED] project-fix-login - Branch already exists

Would you like to:
- Retry failed spawns with different branch names?
- Continue with the successful spawns only?
```

## API Response Format

**Success:**
```json
{
  "success": true,
  "partialSuccess": false,
  "batchId": "batch-1706400000000",
  "results": [
    {"success": true, "agentId": "myproject-xyz789", "workflowId": "debug-workflow"},
    {"success": true, "agentId": "myproject-def456", "workflowId": "default"}
  ],
  "totalRequested": 2,
  "totalSucceeded": 2,
  "totalFailed": 0
}
```

**Partial Failure:**
```json
{
  "success": false,
  "partialSuccess": true,
  "batchId": "batch-1706400000000",
  "results": [
    {"success": true, "agentId": "myproject-xyz789", "workflowId": "debug-workflow"},
    {"success": false, "error": "Failed to create worktree: git error"}
  ],
  "totalRequested": 2,
  "totalSucceeded": 1,
  "totalFailed": 1
}
```

## Limits

- Maximum 10 spawns per request
- Each super minion runs in its own fresh worktree (branched from main)
- Super minions use `planning` mode with the specified workflow
