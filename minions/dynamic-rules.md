# Workflow: Standard Workflow

> Standard workflow with 5 phases: explore, design, review, implement, validate

## Steps

Execute steps in order. Wait for each step to complete before starting the next.

### Step 1: Explore Codebase

**Agent**: Explorer

Fast codebase reconnaissance - searches files, reads code, finds patterns

### Step 2: Engineering Design

**Agent**: Planner

Architecture and design planning - creates technical specifications and implementation plans

### Step 3: Design Review

**Execution**: Parallel (2 agents)

Run these agents simultaneously:

- **General Purpose**: Act as a **senior engineer**. Review the engineering design for technical correctness, best practices, and architectural soundness.
- **General Purpose**: Act as a **criteria validator**. Verify the design addresses every acceptance criterion and requirements.

### Step 4: Implementation

**Agent**: General Purpose

Implement the requirements.

### Step 5: Validation

**Execution**: Parallel (4 agents)

Run these agents simultaneously:

- **Simplifier**: Code simplification - refactors for clarity, removes duplication, improves maintainability
- **General Purpose**: Run all tests and verify they pass. Report any failures.
- **General Purpose**: Act as an **acceptance criteria checker**. Verify each acceptance criterion is satisfied by the implementation.
- **General Purpose**: Update all relevant documentation.

---

## Available Agents

### Built-in Agents
- **Explorer** (`Explore`): Fast codebase reconnaissance - searches files, reads code, finds patterns
- **Planner** (`Plan`): Architecture and design planning - creates technical specifications and implementation plans
- **General Purpose** (`general-purpose`): Versatile agent for implementation, review, testing, and documentation tasks
- **Debugger** (`debugger`): Debug unexpected behavior - systematic hypothesis generation, adds logging, finds root causes
- **Simplifier** (`code-simplifier`): Code simplification - refactors for clarity, removes duplication, improves maintainability
- **Frontend Designer** (`bold-frontend-designer`): UI/UX specialist - creates bold visual designs, improves layouts, and component styling

### Imported Agents
- **code-simplifier** (`imported:claude-plugins-official/code-simplifier:code-simplifier`): Simplifies and refines code for clarity, consistency, and maintainability while preserving all functionality. Focuses on recently modified code unless instructed otherwise.
- **frontend-design** (`imported:claude-plugins-official/frontend-design:skill:frontend-design`): Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.