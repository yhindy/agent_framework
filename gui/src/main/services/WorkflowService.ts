import { createLogger } from './logger'
import {
  SubagentType,
  WorkflowConfig,
  WorkflowStep,
  StepAgent,
  DEFAULT_SUBAGENT_TYPES,
  DEFAULT_WORKFLOW,
  DEBUG_WORKFLOW
} from './types/WorkflowTypes'

const log = createLogger('WorkflowService')

// Counter for generating unique IDs
let idCounter = 0
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idCounter}`
}

/**
 * WorkflowService manages workflow configurations for super minions.
 * A workflow is a sequence of steps, each containing one or more agents.
 * Multiple agents in a step run in parallel automatically.
 */
export class WorkflowService {
  private workflows: Map<string, WorkflowConfig> = new Map()
  private activeWorkflows: Map<string, WorkflowConfig> = new Map()

  constructor() {
    this.workflows.set(DEFAULT_WORKFLOW.id, DEFAULT_WORKFLOW)
    this.workflows.set(DEBUG_WORKFLOW.id, DEBUG_WORKFLOW)
  }

  getSubagentTypes(): SubagentType[] {
    return DEFAULT_SUBAGENT_TYPES
  }

  getSubagentType(id: string): SubagentType | undefined {
    return DEFAULT_SUBAGENT_TYPES.find(t => t.id === id)
  }

  getActiveWorkflow(projectPath: string): WorkflowConfig {
    return this.activeWorkflows.get(projectPath) || DEFAULT_WORKFLOW
  }

  setActiveWorkflow(projectPath: string, workflow: WorkflowConfig): void {
    this.activeWorkflows.set(projectPath, workflow)
    log.info('Set active workflow', { projectPath, workflowId: workflow.id })
  }

  getAllWorkflows(): WorkflowConfig[] {
    return Array.from(this.workflows.values())
  }

  getWorkflow(id: string): WorkflowConfig | undefined {
    return this.workflows.get(id)
  }

  createWorkflow(name: string, description?: string): WorkflowConfig {
    const workflow: WorkflowConfig = {
      id: generateId('workflow'),
      name,
      description,
      steps: [],
      isDefault: false
    }
    this.workflows.set(workflow.id, workflow)
    return workflow
  }

  updateWorkflow(id: string, updates: Partial<WorkflowConfig>): WorkflowConfig {
    const workflow = this.workflows.get(id)
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`)
    }
    // Allow editing all workflows including default ones
    const updated = { ...workflow, ...updates, id: workflow.id }
    this.workflows.set(id, updated)
    return updated
  }

  deleteWorkflow(id: string): void {
    const workflow = this.workflows.get(id)
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`)
    }
    if (workflow.isDefault) {
      throw new Error('Cannot delete the default workflow')
    }
    this.workflows.delete(id)
  }

  addStep(workflowId: string, name: string, agents: string[] | StepAgent[]): WorkflowStep {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const stepAgents: StepAgent[] = agents.map((agent, index) => {
      if (typeof agent === 'string') {
        return { id: generateId(`agent-${index}`), typeId: agent }
      }
      return agent
    })

    const step: WorkflowStep = {
      id: generateId('step'),
      name,
      agents: stepAgents
    }
    workflow.steps.push(step)
    return step
  }

  updateStep(workflowId: string, stepId: string, updates: Partial<WorkflowStep>): WorkflowStep {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const stepIndex = workflow.steps.findIndex(s => s.id === stepId)
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepId}`)
    }

    const step = workflow.steps[stepIndex]
    const updated = { ...step, ...updates, id: step.id }
    workflow.steps[stepIndex] = updated
    return updated
  }

  removeStep(workflowId: string, stepId: string): void {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const index = workflow.steps.findIndex(s => s.id === stepId)
    if (index === -1) {
      throw new Error(`Step not found: ${stepId}`)
    }
    workflow.steps.splice(index, 1)
  }

  reorderSteps(workflowId: string, stepIds: string[]): void {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const reordered = stepIds
      .map(id => workflow.steps.find(s => s.id === id))
      .filter((s): s is WorkflowStep => s !== undefined)

    if (reordered.length !== workflow.steps.length) {
      throw new Error('Invalid step order - missing or extra steps')
    }
    workflow.steps = reordered
  }

  generateRulesMarkdown(workflow: WorkflowConfig): string {
    const lines: string[] = []

    lines.push(`# Workflow: ${workflow.name}`)
    lines.push('')
    if (workflow.description) {
      lines.push(`> ${workflow.description}`)
      lines.push('')
    }

    lines.push('## Steps')
    lines.push('')
    lines.push('Execute steps in order. Wait for each step to complete before starting the next.')
    lines.push('')

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]
      const isParallel = step.agents.length > 1

      lines.push(`### Step ${i + 1}: ${step.name}`)
      lines.push('')

      if (isParallel) {
        lines.push(`**Execution**: Parallel (${step.agents.length} agents)`)
        lines.push('')
        lines.push('Run these agents simultaneously:')
        lines.push('')
        for (const stepAgent of step.agents) {
          const agentType = this.getSubagentType(stepAgent.typeId)
          const description = stepAgent.customPrompt || agentType?.description || ''
          lines.push(`- **${agentType?.name || stepAgent.typeId}**: ${description}`)
        }
      } else {
        const stepAgent = step.agents[0]
        const agentType = this.getSubagentType(stepAgent.typeId)
        const description = stepAgent.customPrompt || agentType?.description || ''
        lines.push(`**Agent**: ${agentType?.name || stepAgent.typeId}`)
        lines.push('')
        lines.push(description)
      }

      lines.push('')
    }

    lines.push('---')
    lines.push('')
    lines.push('## Available Agents')
    lines.push('')
    for (const agent of DEFAULT_SUBAGENT_TYPES) {
      lines.push(`- **${agent.name}** (\`${agent.id}\`): ${agent.description}`)
    }

    return lines.join('\n')
  }
}
