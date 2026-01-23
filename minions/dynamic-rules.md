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

### Skills
- **Babysit Ci** (`command:babysit-ci`): Monitor CI to see the state of the tests that we have and fix any failures. Merge when CI is green.
- **Commit Push Pr** (`command:commit-push-pr`): Commit the changes that you have made for this feature, push them to the origin, and make a PR if one doesnt already exist
- **Commit Push** (`command:commit-push`): Commit the changes that you have made for this feature, push them to the origin
- **Handoff** (`command:handoff`): Create a handoff to delegate work to a new agent. The user has requested: $ARGUMENTS Follow these steps carefully to create a handoff:
- **Merge Latest** (`command:merge-latest`): Merge in the latest from the origin base branch and resolve all conflicts, being careful to keep the changes you have made here as well as the feature(s) that were added on the origin. If you are u...
- **Security Review** (`command:security-review`): Review this code for security vulnerabilities:
- **Send It** (`command:send-it`): Commit your changes, make a PR if one doesnt exist already, then Monitor CI every 60 seconds to see the state of the tests that we have and fix any failures. Merge when CI is green.
- **Simplify** (`command:simplify`): Use the code-simplifier:code-simplifier agent (not just code-simplifier) to simplify the code that has been written
- **bold-frontend-designer** (`agent:bold-frontend-designer`): Use this agent when the user asks about frontend design, UI/UX decisions, component layouts, visual styling, or wants to improve the visual appeal of their interface. This includes requests about making designs more engaging, improving visual hierarchy, spacing decisions, color choices, typography, or when the user mentions their UI looks generic or 'AI-generated'. Examples:\\n\\n<example>\\nContext: User is working on a React dashboard component and wants it to look better.\\nuser: \"This dashboard looks pretty bland, can you make it more visually interesting?\"\\nassistant: \"I'll use the bold-frontend-designer agent to help create a more visually striking design.\"\\n<commentary>\\nSince the user is asking about improving visual design and making something less bland, use the bold-frontend-designer agent which specializes in creating bold, intentional designs rather than generic layouts.\\n</commentary>\\n</example>\\n\\n<example>\\nContext: User is building a landing page and asking about layout.\\nuser: \"How should I arrange the hero section and feature cards on this page?\"\\nassistant: \"Let me bring in the bold-frontend-designer agent to help with the spatial arrangement and visual hierarchy.\"\\n<commentary>\\nThe user is asking about page layout and arrangement, which is a core frontend design question that benefits from intentional spatial thinking.\\n</commentary>\\n</example>\\n\\n<example>\\nContext: User just created a basic form component.\\nuser: \"I made this form but it looks really basic and uninspired\"\\nassistant: \"I'll use the bold-frontend-designer agent to transform this into something more visually compelling.\"\\n<commentary>\\nThe user explicitly mentions their design looks basic/uninspired, which is exactly when the bold-frontend-designer should be engaged to elevate the visual design.\\n</commentary>\\n</example>
- **debugger** (`agent:debugger`): Use this agent when the user reports a bug, unexpected behavior, or asks Claude to 'debug' something. This agent excels at systematic hypothesis generation, adding strategic instrumentation/logging, and methodically narrowing down root causes. It should be invoked when there's a mystery to solve - when code isn't behaving as expected and the cause is unclear.\\n\\nExamples:\\n\\n<example>\\nContext: User reports that their function is returning unexpected values.\\nuser: \"Hey, there's a bug in the calculateTotal function - it's returning NaN sometimes but I can't figure out why\"\\nassistant: \"This sounds like a debugging task. Let me use the debugger agent to systematically investigate why calculateTotal is returning NaN.\"\\n<Task tool invocation to launch debugger agent>\\n</example>\\n\\n<example>\\nContext: User encounters an intermittent failure in their application.\\nuser: \"Can you debug this? The API endpoint works sometimes but randomly returns 500 errors\"\\nassistant: \"I'll launch the debugger agent to investigate this intermittent 500 error. This agent will generate hypotheses and add instrumentation to identify the root cause.\"\\n<Task tool invocation to launch debugger agent>\\n</example>\\n\\n<example>\\nContext: User is confused about unexpected behavior.\\nuser: \"Debug this for me - the user session is getting cleared but I have no idea what's causing it\"\\nassistant: \"Let me bring in the debugger agent to methodically trace through the session handling and identify what's causing the unexpected clearing.\"\\n<Task tool invocation to launch debugger agent>\\n</example>