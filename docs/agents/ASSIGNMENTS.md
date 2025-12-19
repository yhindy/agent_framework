# Active Agent Assignments

> Last Updated: [Date]

This document tracks which features are being worked on by which agents.

## Current Assignments

| Agent | Branch | Feature | Status | Spec File |
|-------|--------|---------|--------|-----------|
| - | - | - | - | - |

## Unassigned Features (Ready for Pickup)

| Feature | Spec File | Notes |
|---------|-----------|-------|
| - | - | - |

## Assignment History

| Agent | Branch | Feature | Completed | Spec File |
|-------|--------|---------|-----------|-----------|
| - | - | - | - | - |

## How to Add an Assignment

1. Create a spec file: `cp templates/FEATURE_SPEC.md assignments/agent-X-feature-name.md`
2. Fill in the spec with requirements
3. Create the worktree: `./scripts/agents/setup.sh agent-X feature/agent-X/feature-name`
4. Add a row to the "Current Assignments" table
5. Point the AI agent at the spec file

## Available Agents

| Agent ID | Status | Notes |
|----------|--------|-------|
| agent-1 | Available | |
| agent-2 | Available | |
| agent-3 | Available | |
| agent-4 | Available | |
| agent-5 | Available | |

## Notes

- Agents should only work on one feature at a time
- Keep features small enough to complete in 1-2 hours
- Coordinate before assigning work that touches shared code
- Review agent work frequently to catch issues early

