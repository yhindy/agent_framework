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
 * A single step in a workflow.
 * If a step has multiple agents, they run in parallel automatically.
 */
export interface WorkflowStep {
  id: string        // Unique identifier
  name: string      // Display name (e.g., "Planning", "Implementation")
  agents: string[]  // Array of SubagentType.ids - multiple = parallel execution
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
    id: 'implement',
    name: 'Implementer',
    description: 'Full implementation following TDD - writes tests first, then code'
  },
  {
    id: 'plan',
    name: 'Planner',
    description: 'Architecture and design planning - creates technical specifications'
  },
  {
    id: 'debug',
    name: 'Debugger',
    description: 'Debug unexpected behavior - traces bugs, adds logging, fixes issues'
  }
]

/**
 * Default workflow matching the original super-minion behavior.
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  id: 'default',
  name: 'Standard Workflow',
  description: 'Plan, implement, then validate',
  steps: [
    { id: 'step-1', name: 'Planning', agents: ['explore', 'plan'] },
    { id: 'step-2', name: 'Implementation', agents: ['implement'] },
    { id: 'step-3', name: 'Validation', agents: ['debug', 'implement'] }
  ],
  isDefault: true
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
