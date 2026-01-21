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
 * These map directly to Claude Code's Task tool subagent_type parameter.
 */
export const DEFAULT_SUBAGENT_TYPES: SubagentType[] = [
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
  description: 'Standard workflow with 5 phases: explore, design, review, implement, validate',
  steps: [
    { id: 'step-1', name: 'Explore Codebase', agents: [{ id: 'a1', typeId: 'Explore' }] },
    { id: 'step-2', name: 'Engineering Design', agents: [{ id: 'a2', typeId: 'Plan' }] },
    {
      id: 'step-3',
      name: 'Design Review',
      agents: [
        { id: 'a3', typeId: 'general-purpose', customPrompt: 'Act as a **senior engineer**. Review the engineering design for technical correctness, best practices, and architectural soundness.' },
        { id: 'a4', typeId: 'general-purpose', customPrompt: 'Act as a **criteria validator**. Verify the design addresses every acceptance criterion and requirements.' }
      ]
    },
    { id: 'step-4', name: 'Implementation', agents: [{ id: 'a5', typeId: 'general-purpose' }] },
    {
      id: 'step-5',
      name: 'Validation',
      agents: [
        { id: 'a6', typeId: 'code-simplifier' },
        { id: 'a7', typeId: 'general-purpose', customPrompt: 'Run all tests and verify they pass. Report any failures.' },
        { id: 'a8', typeId: 'general-purpose', customPrompt: 'Act as an **acceptance criteria checker**. Verify each acceptance criterion is satisfied by the implementation.' },
        { id: 'a9', typeId: 'general-purpose', customPrompt: 'Update documentation as needed based on the implementation changes.' }
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

