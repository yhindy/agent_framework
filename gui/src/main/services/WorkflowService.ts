import Store from 'electron-store'
import * as fs from 'fs'
import * as path from 'path'
import { createLogger } from './logger'
import {
  SubagentType,
  WorkflowConfig,
  WorkflowStep,
  StepAgent,
  DEFAULT_SUBAGENT_TYPES,
  DEFAULT_WORKFLOW,
  DEBUG_WORKFLOW,
  LEGACY_AGENT_ID_MAP
} from './types/WorkflowTypes'
import type { ClaudeConfigService } from './ClaudeConfigService'
import type { SkillsLibraryService } from './SkillsLibraryService'

const log = createLogger('WorkflowService')

/**
 * Schema for global workflow persistence via electron-store.
 */
export interface WorkflowStoreSchema {
  version: number
  workflows: WorkflowConfig[]
  activeWorkflowByProject: Record<string, string> // projectPath -> workflowId
}

/**
 * Schema for per-project workflow file (.minions/workflows.json).
 */
export interface ProjectWorkflowFile {
  version: number
  workflows: WorkflowConfig[]
}

// Counter for generating unique IDs
let idCounter = 0
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idCounter}`
}

/**
 * WorkflowService manages workflow configurations for super minions.
 * A workflow is a sequence of steps, each containing one or more agents.
 * Multiple agents in a step run in parallel automatically.
 *
 * Workflows are persisted in two tiers:
 * 1. Global workflows - stored via electron-store
 * 2. Per-project workflows - stored in {project}/.minions/workflows.json
 */
export class WorkflowService {
  private workflows: Map<string, WorkflowConfig> = new Map()
  private activeWorkflows: Map<string, WorkflowConfig> = new Map()
  private claudeConfigService: ClaudeConfigService | null = null
  private skillsLibraryService: SkillsLibraryService | null = null
  private store: Store<WorkflowStoreSchema>

  constructor() {
    this.store = new Store<WorkflowStoreSchema>({
      name: 'workflows',
      defaults: {
        version: 1,
        workflows: [DEFAULT_WORKFLOW, DEBUG_WORKFLOW],
        activeWorkflowByProject: {}
      }
    })
    this.loadFromStore()
  }

  /**
   * Load workflows from the global store into memory.
   */
  private loadFromStore(): void {
    const data = this.store.store
    log.info('Loading workflows from store', { count: data.workflows.length })

    // Clear existing and load from store
    this.workflows.clear()
    for (const workflow of data.workflows) {
      this.workflows.set(workflow.id, workflow)
    }

    // Restore active workflow selections
    const activeByProject = data.activeWorkflowByProject || {}
    for (const [projectPath, workflowId] of Object.entries(activeByProject)) {
      const workflow = this.workflows.get(workflowId)
      if (workflow) {
        this.activeWorkflows.set(projectPath, workflow)
      }
    }
  }

  /**
   * Save current workflows to the global store.
   */
  private saveToStore(): void {
    const workflows = Array.from(this.workflows.values())
    this.store.set('workflows', workflows)
    log.debug('Saved workflows to store', { count: workflows.length })
  }

  /**
   * Save active workflow selection to the store.
   */
  private saveActiveWorkflowSelection(projectPath: string, workflowId: string): void {
    const byProject = this.store.get('activeWorkflowByProject', {})
    byProject[projectPath] = workflowId
    this.store.set('activeWorkflowByProject', byProject)
  }

  /**
   * Set the ClaudeConfigService for accessing imported agents.
   */
  setClaudeConfigService(service: ClaudeConfigService): void {
    this.claudeConfigService = service
  }

  /**
   * Set the SkillsLibraryService for accessing Vercel and project skills.
   */
  setSkillsLibraryService(service: SkillsLibraryService): void {
    this.skillsLibraryService = service
  }

  /**
   * Get imported subagent types from Claude Code plugins.
   */
  getImportedSubagentTypes(): SubagentType[] {
    if (!this.claudeConfigService) {
      return []
    }

    return this.claudeConfigService.getEnabledImports().map(({ id, name, description }) => ({
      id,
      name,
      description
    }))
  }

  /**
   * Get skill subagent types from Vercel and project skills.
   */
  getSkillSubagentTypes(projectPath?: string): SubagentType[] {
    if (!this.skillsLibraryService) {
      return []
    }

    return this.skillsLibraryService.getEnabledSkills(projectPath).map(({ id, name, description }) => ({
      id,
      name,
      description
    }))
  }

  getSubagentTypes(projectPath?: string): SubagentType[] {
    return [
      ...DEFAULT_SUBAGENT_TYPES,
      ...this.getImportedSubagentTypes(),
      ...this.getSkillSubagentTypes(projectPath)
    ]
  }

  getSubagentType(id: string, projectPath?: string): SubagentType | undefined {
    // Map legacy IDs to current IDs for backwards compatibility
    const mappedId = LEGACY_AGENT_ID_MAP[id] || id

    // Built-in types take precedence, then imported, then skills
    return DEFAULT_SUBAGENT_TYPES.find(t => t.id === mappedId)
      ?? this.getImportedSubagentTypes().find(t => t.id === mappedId)
      ?? this.getSkillSubagentTypes(projectPath).find(t => t.id === mappedId)
  }

  /**
   * Normalize an agent type ID, mapping legacy IDs to current ones.
   */
  normalizeAgentId(id: string): string {
    return LEGACY_AGENT_ID_MAP[id] || id
  }

  getActiveWorkflow(projectPath: string): WorkflowConfig {
    return this.activeWorkflows.get(projectPath) || DEFAULT_WORKFLOW
  }

  setActiveWorkflow(projectPath: string, workflow: WorkflowConfig): void {
    this.activeWorkflows.set(projectPath, workflow)
    this.saveActiveWorkflowSelection(projectPath, workflow.id)
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
    this.saveToStore()
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
    this.saveToStore()
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
    this.saveToStore()
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
    this.saveToStore()
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
    this.saveToStore()
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
    this.saveToStore()
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
    this.saveToStore()
  }

  /**
   * Get the path to the per-project workflows file.
   */
  private getProjectWorkflowsPath(projectPath: string): string {
    return path.join(projectPath, '.minions', 'workflows.json')
  }

  /**
   * Load workflows from a project's .minions/workflows.json file.
   * Returns an empty array if the file doesn't exist or is invalid.
   */
  loadProjectWorkflows(projectPath: string): WorkflowConfig[] {
    const filePath = this.getProjectWorkflowsPath(projectPath)

    try {
      if (!fs.existsSync(filePath)) {
        return []
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      const data: ProjectWorkflowFile = JSON.parse(content)

      if (!data.workflows || !Array.isArray(data.workflows)) {
        log.warn('Invalid project workflows file format', { projectPath })
        return []
      }

      log.info('Loaded project workflows', { projectPath, count: data.workflows.length })
      return data.workflows
    } catch (error) {
      log.error('Failed to load project workflows', { projectPath, error })
      return []
    }
  }

  /**
   * Save workflows to a project's .minions/workflows.json file.
   * Creates the .minions directory if it doesn't exist.
   */
  saveProjectWorkflows(projectPath: string, workflows: WorkflowConfig[]): void {
    const filePath = this.getProjectWorkflowsPath(projectPath)
    const dirPath = path.dirname(filePath)

    try {
      // Ensure .minions directory exists
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }

      const data: ProjectWorkflowFile = {
        version: 1,
        workflows
      }

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
      log.info('Saved project workflows', { projectPath, count: workflows.length })
    } catch (error) {
      log.error('Failed to save project workflows', { projectPath, error })
      throw error
    }
  }

  /**
   * Get all workflows available for a project.
   * Returns global workflows merged with project-specific workflows.
   * Project workflows with the same ID override global ones.
   */
  getWorkflowsForProject(projectPath: string): WorkflowConfig[] {
    const globalWorkflows = this.getAllWorkflows()
    const projectWorkflows = this.loadProjectWorkflows(projectPath)

    // Project workflows override global ones with the same ID
    const workflowMap = new Map<string, WorkflowConfig>(
      [...globalWorkflows, ...projectWorkflows].map(w => [w.id, w])
    )

    return Array.from(workflowMap.values())
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

    // Include skills if any
    const skills = this.getSkillSubagentTypes()
    if (skills.length > 0) {
      lines.push('')
      lines.push('### Skills')
      for (const skill of skills) {
        lines.push(`- **${skill.name}** (\`${skill.id}\`): ${skill.description}`)
      }
    }

    return lines.join('\n')
  }
}
