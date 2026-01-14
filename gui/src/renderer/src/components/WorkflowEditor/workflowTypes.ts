// =============================================================================
// WORKFLOW EDITOR TYPES
// Type definitions for the workflow editor components
// =============================================================================

export type StepType = 'explore' | 'implement' | 'plan' | 'debug'

export interface SubagentType {
  id: StepType
  name: string
  description: string
  color: string
}

export interface WorkflowStep {
  id: string
  type: StepType
  name: string
  description?: string
  enabled: boolean
}

export interface ParallelGroup {
  id: string
  type: 'parallel'
  steps: WorkflowStep[]
}

export type WorkflowItem = WorkflowStep | ParallelGroup

export interface Workflow {
  items: WorkflowItem[]
  version: number
  lastModified: string
}

// Type guard to check if an item is a parallel group
export function isParallelGroup(item: WorkflowItem): item is ParallelGroup {
  return (item as ParallelGroup).type === 'parallel'
}

// Type guard to check if an item is a workflow step
export function isWorkflowStep(item: WorkflowItem): item is WorkflowStep {
  return !isParallelGroup(item) && 'enabled' in item
}

// Default subagent types with colors matching the design spec
export const DEFAULT_SUBAGENT_TYPES: SubagentType[] = [
  {
    id: 'explore',
    name: 'Explore',
    description: 'Search codebase for context',
    color: 'var(--color-info)'
  },
  {
    id: 'implement',
    name: 'Implement',
    description: 'Build features and write code',
    color: 'var(--color-success)'
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Create and organize tasks',
    color: 'var(--color-warning)'
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Test and fix issues',
    color: 'var(--color-error)'
  }
]
