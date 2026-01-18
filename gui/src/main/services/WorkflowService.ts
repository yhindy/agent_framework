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
import type { ClaudeConfigService } from './ClaudeConfigService'
import type { ImportedSubagentType } from './types/ClaudeConfigTypes'

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
  private claudeConfigService: ClaudeConfigService | null = null
  private enabledImports: string[] = []  // IDs of enabled imported agents

  constructor() {
    this.workflows.set(DEFAULT_WORKFLOW.id, DEFAULT_WORKFLOW)
    this.workflows.set(DEBUG_WORKFLOW.id, DEBUG_WORKFLOW)
  }

  /**
   * Set the ClaudeConfigService for accessing imported agents.
   */
  setClaudeConfigService(service: ClaudeConfigService): void {
    this.claudeConfigService = service
  }

  /**
   * Set the list of enabled imported agent IDs.
   * This is updated when settings change.
   */
  setEnabledImports(ids: string[]): void {
    this.enabledImports = ids
    log.debug('Updated enabled imports:', ids.length)
  }

  /**
   * Get imported subagent types from Claude Code plugins.
   */
  getImportedSubagentTypes(): SubagentType[] {
    if (!this.claudeConfigService) {
      return []
    }

    const enabledImports = this.claudeConfigService.getEnabledImports()

    // Filter by the enabledImports list if set
    const filteredImports = this.enabledImports.length > 0
      ? enabledImports.filter(imp => this.enabledImports.includes(imp.id))
      : enabledImports

    // Convert ImportedSubagentType to SubagentType
    return filteredImports.map(imported => this.convertToSubagentType(imported))
  }

  /**
   * Convert an ImportedSubagentType to a SubagentType.
   */
  private convertToSubagentType(imported: ImportedSubagentType): SubagentType {
    return {
      id: imported.id,
      name: imported.name,
      description: imported.description
    }
  }

  getSubagentTypes(): SubagentType[] {
    const builtIn = DEFAULT_SUBAGENT_TYPES
    const imported = this.getImportedSubagentTypes()

    // Combine built-in and imported, with built-ins first
    return [...builtIn, ...imported]
  }

  getSubagentType(id: string): SubagentType | undefined {
    // First check built-in types
    const builtIn = DEFAULT_SUBAGENT_TYPES.find(t => t.id === id)
    if (builtIn) {
      return builtIn
    }

    // Then check imported types
    const imported = this.getImportedSubagentTypes()
    return imported.find(t => t.id === id)
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

    // Include built-in agents
    lines.push('### Built-in Agents')
    for (const agent of DEFAULT_SUBAGENT_TYPES) {
      lines.push(`- **${agent.name}** (\`${agent.id}\`): ${agent.description}`)
    }

    // Include imported agents if any
    const importedAgents = this.getImportedSubagentTypes()
    if (importedAgents.length > 0) {
      lines.push('')
      lines.push('### Imported Agents')
      for (const agent of importedAgents) {
        lines.push(`- **${agent.name}** (\`${agent.id}\`): ${agent.description}`)
      }
    }

    return lines.join('\n')
  }
}
