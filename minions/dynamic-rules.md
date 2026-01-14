# Workflow: Standard Workflow

> Standard workflow with 5 phases: explore, design, review, implement, validate

## Steps

Execute steps in order. Wait for each step to complete before starting the next.

### Step 1: Explore Codebase

**Agent**: Explorer

Quick codebase reconnaissance - searches files, reads code

### Step 2: Engineering Design

**Agent**: Planner

Architecture and design planning - creates technical specifications

### Step 3: Design Review

**Execution**: Parallel (2 agents)

Run these agents simultaneously:

- **Reviewer**: Code review and validation - checks quality, patterns, and requirements
- **Reviewer**: Code review and validation - checks quality, patterns, and requirements

### Step 4: Implementation

**Agent**: Implementer

Full implementation following TDD - writes tests first, then code

### Step 5: Validation

**Execution**: Parallel (4 agents)

Run these agents simultaneously:

- **Simplifier**: Code simplification - refactors, removes duplication, improves clarity
- **Tester**: Test execution and validation - runs tests, checks coverage
- **Reviewer**: Code review and validation - checks quality, patterns, and requirements
- **Documenter**: Documentation updates - writes READMEs, API docs, code comments

---

## Available Agents

- **Explorer** (`explore`): Quick codebase reconnaissance - searches files, reads code
- **Planner** (`plan`): Architecture and design planning - creates technical specifications
- **Reviewer** (`review`): Code review and validation - checks quality, patterns, and requirements
- **Implementer** (`implement`): Full implementation following TDD - writes tests first, then code
- **Tester** (`test`): Test execution and validation - runs tests, checks coverage
- **Debugger** (`debug`): Debug unexpected behavior - traces bugs, adds logging, fixes issues
- **Documenter** (`document`): Documentation updates - writes READMEs, API docs, code comments
- **Simplifier** (`simplify`): Code simplification - refactors, removes duplication, improves clarity