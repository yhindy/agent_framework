# Super Minion Workflow: Default Super Minion Workflow

> Standard workflow matching original super-minion-rules with 5 phases

Generated at: 2026-01-14T06:09:44.540Z

## Workflow Overview

Execute the following phases in order. Each phase must complete before moving to the next.

### Phase 1: Implementation

**Execution Type**: Sequential
**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```


### Phase 2: Parallel Execution Group

**Execution Type**: Parallel (2 concurrent tasks)

The following steps should be executed **simultaneously**:

#### 2a. Test Execution

**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```

#### 2b. Documentation Update

**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```

**Synchronization**: Wait for ALL parallel tasks to complete before proceeding to the next phase.

---

## Subagent Type Reference

### Explore (explore)
- **Description**: Quick codebase reconnaissance - searches files, reads code, understands structure
- **Capabilities**: read-only

### Implementer (general-purpose)
- **Description**: Full implementation following TDD - writes tests first, then code
- **Capabilities**: file-edit, test-execution

### Planner (plan)
- **Description**: Architecture and design planning - creates technical specifications
- **Capabilities**: read-only

### Debugger (debugger)
- **Description**: Debug unexpected behavior - traces bugs, adds logging, fixes issues
- **Capabilities**: file-edit, test-execution
