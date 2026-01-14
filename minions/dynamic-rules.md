# Super Minion Workflow: Default Super Minion Workflow

> Standard workflow matching original super-minion-rules with 5 phases

Generated at: 2026-01-14T05:03:01.116Z

## Workflow Overview

Execute the following phases in order. Each phase must complete before moving to the next.

### Phase 1: Explore Codebase

**Execution Type**: Sequential
**Subagent Type**: Explore

**Instructions**:

```
You are an Explorer agent. Your task is to thoroughly investigate the codebase to understand context before implementation begins.

Focus on:
- Finding relevant files and patterns
- Understanding existing architecture
- Identifying dependencies and constraints

Report your findings clearly and concisely.
```


### Phase 2: Engineering Design

**Execution Type**: Sequential
**Subagent Type**: Planner

**Instructions**:

```
You are a Planner agent. Create a detailed engineering design for the feature.

Your design should include:
- Architecture overview
- Data models and interfaces
- Component breakdown
- Implementation approach
- Testing strategy

Write the design to a markdown file.
```


### Phase 3: Parallel Execution Group

**Execution Type**: Parallel (2 concurrent tasks)

The following steps should be executed **simultaneously**:

#### 3a. Senior Engineer Review

**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```

#### 3b. Criteria Validation

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

### Phase 4: Implementation

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


### Phase 5: Parallel Execution Group

**Execution Type**: Parallel (4 concurrent tasks)

The following steps should be executed **simultaneously**:

#### 5a. Code Simplification

**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```

#### 5b. Test Execution

**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```

#### 5c. Acceptance Criteria Check

**Subagent Type**: Implementer

**Instructions**:

```
You are an Implementer agent. Follow Test-Driven Development:

1. Write failing tests first that define expected behavior
2. Implement minimal code to make tests pass
3. Refactor while keeping tests green

Ensure your implementation is clean, well-documented, and follows existing patterns.
```

#### 5d. Documentation Update

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
