# Workflow: Standard Workflow

> Plan, implement, then validate

## Steps

Execute steps in order. Wait for each step to complete before starting the next.

### Step 1: Planning

**Execution**: Parallel (2 agents)

Run these agents simultaneously:

- **Explorer**: Quick codebase reconnaissance - searches files, reads code
- **Planner**: Architecture and design planning - creates technical specifications

### Step 2: Implementation

**Agent**: Implementer

Full implementation following TDD - writes tests first, then code

### Step 3: Validation

**Execution**: Parallel (2 agents)

Run these agents simultaneously:

- **Debugger**: Debug unexpected behavior - traces bugs, adds logging, fixes issues
- **Implementer**: Full implementation following TDD - writes tests first, then code

---

## Available Agents

- **Explorer** (`explore`): Quick codebase reconnaissance - searches files, reads code
- **Implementer** (`implement`): Full implementation following TDD - writes tests first, then code
- **Planner** (`plan`): Architecture and design planning - creates technical specifications
- **Debugger** (`debug`): Debug unexpected behavior - traces bugs, adds logging, fixes issues