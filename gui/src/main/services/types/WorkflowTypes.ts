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
 */
export const DEFAULT_SUBAGENT_TYPES: SubagentType[] = [
  {
    id: 'explore',
    name: 'Explorer',
    description: 'Quick codebase reconnaissance - searches files, reads code'
  },
  {
    id: 'plan',
    name: 'Planner',
    description: 'Architecture and design planning - creates technical specifications'
  },
  {
    id: 'review',
    name: 'Reviewer',
    description: 'Code review and validation - checks quality, patterns, and requirements'
  },
  {
    id: 'implement',
    name: 'Implementer',
    description: 'Full implementation following TDD - writes tests first, then code'
  },
  {
    id: 'test',
    name: 'Tester',
    description: 'Test execution and validation - runs tests, checks coverage'
  },
  {
    id: 'debug',
    name: 'Debugger',
    description: 'Debug unexpected behavior - traces bugs, adds logging, fixes issues'
  },
  {
    id: 'document',
    name: 'Documenter',
    description: 'Documentation updates - writes READMEs, API docs, code comments'
  },
  {
    id: 'simplify',
    name: 'Simplifier',
    description: 'Code simplification - refactors, removes duplication, improves clarity'
  }
]

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
  description: 'Standard workflow with 5 phases: explore, design, review, implement, validate',
  steps: [
    { id: 'step-1', name: 'Explore Codebase', agents: [{ id: 'a1', typeId: 'explore' }] },
    { id: 'step-2', name: 'Engineering Design', agents: [{ id: 'a2', typeId: 'plan' }] },
    {
      id: 'step-3',
      name: 'Design Review',
      agents: [
        { id: 'a3', typeId: 'review', customPrompt: 'Review the engineering design for technical correctness and best practices' },
        { id: 'a4', typeId: 'review', customPrompt: 'Review the design against acceptance criteria and requirements' }
      ]
    },
    { id: 'step-4', name: 'Implementation', agents: [{ id: 'a5', typeId: 'implement' }] },
    {
      id: 'step-5',
      name: 'Validation',
      agents: [
        { id: 'a6', typeId: 'simplify' },
        { id: 'a7', typeId: 'test' },
        { id: 'a8', typeId: 'review', customPrompt: 'Final code review before merge' },
        { id: 'a9', typeId: 'document' }
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
        { id: 'd1', typeId: 'explore', customPrompt: 'Find the code related to the bug and understand the current behavior' },
        { id: 'd2', typeId: 'debug', customPrompt: 'Reproduce the bug and document the steps to trigger it' }
      ]
    },
    {
      id: 'dbg-2',
      name: 'Root Cause Analysis',
      agents: [{ id: 'd3', typeId: 'debug', customPrompt: 'Identify the root cause of the bug using logging, breakpoints, and code analysis' }]
    },
    {
      id: 'dbg-3',
      name: 'Fix Implementation',
      agents: [{ id: 'd4', typeId: 'implement', customPrompt: 'Implement the fix with minimal changes. Write a regression test first.' }]
    },
    {
      id: 'dbg-4',
      name: 'Verification',
      agents: [
        { id: 'd5', typeId: 'test', customPrompt: 'Run all tests and verify the fix works' },
        { id: 'd6', typeId: 'review', customPrompt: 'Review the fix for correctness and potential side effects' }
      ]
    }
  ],
  isDefault: false
}

// Legacy type aliases for backward compatibility during migration
// TODO: Remove these after all code is migrated

/** @deprecated Use WorkflowStep with multiple agents instead */
export interface ParallelGroup {
  id: string
  type: 'parallel'
  steps: LegacyWorkflowStep[]
}

/** @deprecated Use WorkflowStep instead */
export interface LegacyWorkflowStep {
  id: string
  type: 'step'
  name: string
  subagentTypeId: string
  promptOverride?: string
  enabled: boolean
  config?: {
    timeout?: number
    retryOnFailure?: boolean
    continueOnFailure?: boolean
  }
}

/** @deprecated Use WorkflowStep instead */
export type WorkflowItem = LegacyWorkflowStep | ParallelGroup

/** @deprecated */
export function isWorkflowStep(item: WorkflowItem): item is LegacyWorkflowStep {
  return item.type === 'step'
}

/** @deprecated */
export function isParallelGroup(item: WorkflowItem): item is ParallelGroup {
  return item.type === 'parallel'
}
