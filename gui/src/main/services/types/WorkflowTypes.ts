/**
 * Workflow Editor Type Definitions (Simplified)
 *
 * Simple model: A workflow is a sequence of steps.
 * Each step has one or more agents - multiple agents run in parallel automatically.
 */

/**
 * Defines an agent type that can be used in workflow steps.
 */
export interface SubagentType {
  id: string        // e.g., 'explore', 'implement', 'plan', 'debug'
  name: string      // Human-readable name
  description: string
  promptContent?: string  // Full prompt for custom (non-Claude-native) agent types
}

/**
 * Claude Code's built-in subagent types that can be used directly with Task tool.
 * Custom types (not in this list) must use general-purpose with promptContent.
 */
export const CLAUDE_NATIVE_SUBAGENT_TYPES = [
  'Explore',
  'Plan',
  'general-purpose',
  'debugger',
  'code-simplifier',
  'bold-frontend-designer'
] as const

/**
 * Check if a subagent type is natively supported by Claude Code.
 */
export function isClaudeNativeType(typeId: string): boolean {
  return CLAUDE_NATIVE_SUBAGENT_TYPES.includes(typeId as any)
}

/**
 * An agent instance within a step.
 * Can have a custom prompt to override the default behavior.
 */
export interface StepAgent {
  id: string           // Unique instance ID (e.g., 'agent-1234')
  typeId: string       // Reference to SubagentType.id (e.g., 'review')
  customPrompt?: string // Optional custom instructions for this specific agent
}

/**
 * A single step in a workflow.
 * If a step has multiple agents, they run in parallel automatically.
 */
export interface WorkflowStep {
  id: string          // Unique identifier
  name: string        // Display name (e.g., "Planning", "Implementation")
  agents: StepAgent[] // Array of agent instances - multiple = parallel execution
}

/**
 * A complete workflow configuration.
 */
export interface WorkflowConfig {
  id: string
  name: string
  description?: string
  steps: WorkflowStep[]
  isDefault?: boolean
}

/**
 * Available agent types for the workflow system.
 * These map directly to Claude Code's Task tool subagent_type parameter.
 */
export const DEFAULT_SUBAGENT_TYPES: SubagentType[] = [
  {
    id: 'acceptance-criteria',
    name: 'Acceptance Criteria',
    description: 'Propose and get human approval for acceptance criteria before implementation',
    promptContent: `You are an Acceptance Criteria agent. Your job is to ensure alignment with the user before any implementation work begins.

## Your Process

1. **Explore** the codebase to understand context, existing patterns, and constraints
2. **Ask clarifying questions** using AskUserQuestion if requirements are ambiguous - do this BEFORE proposing criteria
3. **Propose** clear, numbered, testable acceptance criteria:
   - Functional: "1. Users can log in with email/password"
   - Engineering: "2. All new code has unit tests with >80% coverage"
   - Performance: "3. API response time < 200ms"
4. **Request approval** using AskUserQuestion:
   \`\`\`
   AskUserQuestion(questions=[{
     "question": "Do you agree with these acceptance criteria?",
     "header": "Criteria",
     "options": [
       {"label": "Yes, proceed", "description": "Move to next phase"},
       {"label": "Modify criteria", "description": "I have feedback"}
     ]
   }])
   \`\`\`
5. **Wait** for explicit "Yes, proceed" before completing

## Critical Rules

- Do NOT complete until you receive explicit "Yes, proceed" approval
- If user says "Modify criteria", incorporate their feedback and re-propose
- Do NOT skip to implementation or design work
- Do NOT propose criteria that include open questions - ask questions first, then propose
- Your ONLY job is getting criteria approved - nothing else`
  },
  {
    id: 'Explore',
    name: 'Explorer',
    description: 'Fast codebase reconnaissance - searches files, reads code, finds patterns'
  },
  {
    id: 'Plan',
    name: 'Planner',
    description: 'Architecture and design planning - creates technical specifications and implementation plans'
  },
  {
    id: 'general-purpose',
    name: 'General Purpose',
    description: 'Versatile agent for implementation, review, testing, and documentation tasks'
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: 'Debug unexpected behavior - systematic hypothesis generation, adds logging, finds root causes'
  },
  {
    id: 'code-simplifier',
    name: 'Simplifier',
    description: 'Code simplification - refactors for clarity, removes duplication, improves maintainability'
  },
  {
    id: 'bold-frontend-designer',
    name: 'Frontend Designer',
    description: 'UI/UX specialist - creates bold visual designs, improves layouts, and component styling'
  }
]

/**
 * Maps legacy agent IDs to current valid Claude subagent types.
 * Used for backwards compatibility with existing saved workflows.
 */
export const LEGACY_AGENT_ID_MAP: Record<string, string> = {
  'explore': 'Explore',
  'plan': 'Plan',
  'review': 'general-purpose',
  'implement': 'general-purpose',
  'test': 'general-purpose',
  'debug': 'debugger',
  'document': 'general-purpose',
  'simplify': 'code-simplifier'
}

/**
 * Helper to create a simple agent (no custom prompt).
 */
export function createAgent(typeId: string): StepAgent {
  return { id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, typeId }
}

/**
 * Default workflow matching the original super-minion 5-phase workflow.
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  id: 'default',
  name: 'Standard Workflow',
  description: 'Standard workflow with 5 phases: acceptance criteria, design, review, implement, validate',
  steps: [
    { id: 'step-0', name: 'Acceptance Criteria', agents: [{ id: 'a0', typeId: 'acceptance-criteria' }] },
    { id: 'step-1', name: 'Engineering Design', agents: [{ id: 'a1', typeId: 'Plan' }] },
    {
      id: 'step-2',
      name: 'Design Review',
      agents: [
        { id: 'a2', typeId: 'general-purpose', customPrompt: 'Act as a **senior engineer**. Review the engineering design for technical correctness, best practices, and architectural soundness.' },
        { id: 'a3', typeId: 'general-purpose', customPrompt: 'Act as a **criteria validator**. Verify the design addresses every acceptance criterion and requirements.' }
      ]
    },
    { id: 'step-3', name: 'Implementation', agents: [{ id: 'a4', typeId: 'general-purpose' }] },
    {
      id: 'step-4',
      name: 'Validation',
      agents: [
        { id: 'a5', typeId: 'code-simplifier' },
        { id: 'a6', typeId: 'general-purpose', customPrompt: 'Run all tests and verify they pass. Report any failures.' },
        { id: 'a7', typeId: 'general-purpose', customPrompt: 'Act as an **acceptance criteria checker**. Verify each acceptance criterion is satisfied by the implementation.' },
        { id: 'a8', typeId: 'general-purpose', customPrompt: 'Update documentation as needed based on the implementation changes.' }
      ]
    }
  ],
  isDefault: true
}

/**
 * Debugging workflow for investigating and fixing bugs.
 */
export const DEBUG_WORKFLOW: WorkflowConfig = {
  id: 'debug-workflow',
  name: 'Debug Workflow',
  description: 'Systematic debugging: reproduce, investigate, fix, verify',
  steps: [
    {
      id: 'dbg-1',
      name: 'Reproduce & Understand',
      agents: [
        { id: 'd1', typeId: 'Explore', customPrompt: 'Find the code related to the bug and understand the current behavior' },
        { id: 'd2', typeId: 'debugger', customPrompt: 'Reproduce the bug and document the steps to trigger it' }
      ]
    },
    {
      id: 'dbg-2',
      name: 'Root Cause Analysis',
      agents: [{ id: 'd3', typeId: 'debugger', customPrompt: 'Identify the root cause of the bug using logging, breakpoints, and code analysis' }]
    },
    {
      id: 'dbg-3',
      name: 'Fix Implementation',
      agents: [{ id: 'd4', typeId: 'general-purpose', customPrompt: 'Implement the fix with minimal changes. Write a regression test first.' }]
    },
    {
      id: 'dbg-4',
      name: 'Verification',
      agents: [
        { id: 'd5', typeId: 'general-purpose', customPrompt: 'Run all tests and verify the fix works' },
        { id: 'd6', typeId: 'general-purpose', customPrompt: 'Review the fix for correctness and potential side effects' }
      ]
    }
  ],
  isDefault: false
}

