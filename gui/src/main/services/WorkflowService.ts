import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { createLogger } from './logger'
import {
  SubagentType,
  WorkflowConfig,
  WorkflowSystemConfig,
  ProjectWorkflowConfig,
  WorkflowItem,
  WorkflowStep,
  isWorkflowStep,
  isParallelGroup
} from './types/WorkflowTypes'

const log = createLogger('WorkflowService')

/**
 * Lock information for workflow editing during execution.
 */
interface WorkflowLock {
  agentId: string
  lockedAt: string
}

/**
 * WorkflowService manages workflow configurations for the super minion system.
 *
 * Responsibilities:
 * - Loading system-wide subagent types and default workflows from bundled resources
 * - Managing project-specific workflow configurations
 * - CRUD operations for custom workflows
 * - Template management for reusable workflows
 * - Workflow locking during execution
 * - Generating dynamic rules markdown for super minions
 */
export class WorkflowService {
  private systemConfig: WorkflowSystemConfig | null = null
  private templates: WorkflowConfig[] = []
  private workflowLocks: Map<string, WorkflowLock> = new Map()

  constructor() {
    this.loadSystemConfig()
  }

  // ============================================
  // Config Loading
  // ============================================

  /**
   * Load subagent-types.json and default-workflow.json from bundled resources.
   * Handles both packaged app and development paths.
   */
  loadSystemConfig(): void {
    try {
      const configDir = this.getConfigPath()
      log.info('Loading system config from:', configDir)

      // Load subagent types
      const subagentTypesPath = join(configDir, 'subagent-types.json')
      if (!existsSync(subagentTypesPath)) {
        log.error('subagent-types.json not found at:', subagentTypesPath)
        throw new Error(`System config not found: ${subagentTypesPath}`)
      }

      const subagentTypesData = JSON.parse(readFileSync(subagentTypesPath, 'utf-8')) as {
        version: number
        subagentTypes: SubagentType[]
      }

      // Load default workflow
      const defaultWorkflowPath = join(configDir, 'default-workflow.json')
      if (!existsSync(defaultWorkflowPath)) {
        log.error('default-workflow.json not found at:', defaultWorkflowPath)
        throw new Error(`Default workflow not found: ${defaultWorkflowPath}`)
      }

      const defaultWorkflow = JSON.parse(readFileSync(defaultWorkflowPath, 'utf-8')) as WorkflowConfig
      defaultWorkflow.isTemplate = true // Mark as read-only template

      // Build system config
      this.systemConfig = {
        subagentTypes: subagentTypesData.subagentTypes,
        workflows: [defaultWorkflow],
        defaultWorkflowId: defaultWorkflow.id,
        version: subagentTypesData.version
      }

      // Store default workflow as a template
      this.templates = [defaultWorkflow]

      log.info('System config loaded successfully:', {
        subagentTypes: this.systemConfig.subagentTypes.length,
        workflows: this.systemConfig.workflows.length,
        defaultWorkflowId: this.systemConfig.defaultWorkflowId
      })
    } catch (error) {
      log.error('Failed to load system config:', error)
      throw error
    }
  }

  /**
   * Get the cached system configuration.
   * Reloads if not cached.
   */
  getSystemConfig(): WorkflowSystemConfig {
    if (!this.systemConfig) {
      this.loadSystemConfig()
    }
    return this.systemConfig!
  }

  /**
   * Get all available subagent types.
   */
  getSubagentTypes(): SubagentType[] {
    return this.getSystemConfig().subagentTypes
  }

  /**
   * Get a specific subagent type by ID.
   */
  getSubagentType(id: string): SubagentType | undefined {
    return this.getSubagentTypes().find(t => t.id === id)
  }

  // ============================================
  // Project Workflow Management
  // ============================================

  /**
   * Get the project's workflow configuration.
   * Returns custom project config if it exists, otherwise creates a default one.
   */
  getProjectWorkflow(projectPath: string): ProjectWorkflowConfig {
    const configPath = this.getProjectWorkflowPath(projectPath)

    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8')
        const config = JSON.parse(content) as ProjectWorkflowConfig
        log.debug('Loaded project workflow config:', projectPath)
        return config
      } catch (error) {
        log.error('Failed to parse project workflow config:', error)
        // Fall through to return default
      }
    }

    // Return default config
    const systemConfig = this.getSystemConfig()
    return {
      activeWorkflowId: systemConfig.defaultWorkflowId,
      customWorkflows: []
    }
  }

  /**
   * Save the project's workflow configuration.
   */
  saveProjectWorkflow(projectPath: string, config: ProjectWorkflowConfig): void {
    const configPath = this.getProjectWorkflowPath(projectPath)
    const configDir = join(projectPath, 'minions')

    // Ensure minions directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
      log.info('Created minions directory:', configDir)
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2))
    log.info('Saved project workflow config:', configPath)
  }

  /**
   * Get the currently active workflow for a project.
   * Resolves from project custom workflows or system defaults.
   */
  getActiveWorkflow(projectPath: string): WorkflowConfig {
    const projectConfig = this.getProjectWorkflow(projectPath)
    const activeId = projectConfig.activeWorkflowId

    // First check project's custom workflows
    const customWorkflow = projectConfig.customWorkflows.find(w => w.id === activeId)
    if (customWorkflow) {
      return customWorkflow
    }

    // Fall back to system workflows
    const systemConfig = this.getSystemConfig()
    const systemWorkflow = systemConfig.workflows.find(w => w.id === activeId)
    if (systemWorkflow) {
      return systemWorkflow
    }

    // Last resort: return default workflow
    const defaultWorkflow = systemConfig.workflows.find(w => w.id === systemConfig.defaultWorkflowId)
    if (defaultWorkflow) {
      log.warn('Active workflow not found, using default:', systemConfig.defaultWorkflowId)
      return defaultWorkflow
    }

    throw new Error('No workflow available - system config may be corrupted')
  }

  /**
   * Set which workflow is active for a project.
   */
  setActiveWorkflow(projectPath: string, workflowId: string): void {
    const projectConfig = this.getProjectWorkflow(projectPath)

    // Validate that the workflow exists
    const customExists = projectConfig.customWorkflows.some(w => w.id === workflowId)
    const systemExists = this.getSystemConfig().workflows.some(w => w.id === workflowId)

    if (!customExists && !systemExists) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    projectConfig.activeWorkflowId = workflowId
    this.saveProjectWorkflow(projectPath, projectConfig)
    log.info('Set active workflow:', { projectPath, workflowId })
  }

  /**
   * Get all workflows available for a project (custom + system).
   */
  getAllWorkflows(projectPath: string): WorkflowConfig[] {
    const projectConfig = this.getProjectWorkflow(projectPath)
    const systemConfig = this.getSystemConfig()

    return [...systemConfig.workflows, ...projectConfig.customWorkflows]
  }

  // ============================================
  // Workflow CRUD
  // ============================================

  /**
   * Create a new custom workflow for a project.
   */
  createWorkflow(projectPath: string, workflow: Omit<WorkflowConfig, 'id' | 'createdAt' | 'updatedAt' | 'version'>): WorkflowConfig {
    const projectConfig = this.getProjectWorkflow(projectPath)

    const now = new Date().toISOString()
    const newWorkflow: WorkflowConfig = {
      ...workflow,
      id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDefault: false,
      isTemplate: false
    }

    projectConfig.customWorkflows.push(newWorkflow)
    this.saveProjectWorkflow(projectPath, projectConfig)

    log.info('Created workflow:', { projectPath, workflowId: newWorkflow.id, name: newWorkflow.name })
    return newWorkflow
  }

  /**
   * Update an existing custom workflow.
   * Cannot update system/template workflows.
   *
   * @param projectPath - Path to the project
   * @param workflowId - ID of the workflow to update
   * @param updates - Partial workflow updates (without id, createdAt)
   * @param expectedVersion - Optional version for optimistic locking
   */
  updateWorkflow(
    projectPath: string,
    workflowId: string,
    updates: Partial<Omit<WorkflowConfig, 'id' | 'createdAt' | 'version'>>,
    expectedVersion?: number
  ): WorkflowConfig {
    const projectConfig = this.getProjectWorkflow(projectPath)
    const index = projectConfig.customWorkflows.findIndex(w => w.id === workflowId)

    if (index === -1) {
      // Check if trying to update a system workflow
      const systemWorkflow = this.getSystemConfig().workflows.find(w => w.id === workflowId)
      if (systemWorkflow) {
        throw new Error('Cannot update system/template workflows. Create a copy first.')
      }
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const existing = projectConfig.customWorkflows[index]

    // Check for optimistic locking if version provided
    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      throw new Error('Workflow was modified by another process. Please refresh and try again.')
    }

    const updated: WorkflowConfig = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      createdAt: existing.createdAt, // Prevent createdAt change
      updatedAt: new Date().toISOString(),
      version: existing.version + 1
    }

    projectConfig.customWorkflows[index] = updated
    this.saveProjectWorkflow(projectPath, projectConfig)

    log.info('Updated workflow:', { projectPath, workflowId, version: updated.version })
    return updated
  }

  /**
   * Delete a custom workflow from a project.
   * Cannot delete system/default workflows.
   */
  deleteWorkflow(projectPath: string, workflowId: string): void {
    const projectConfig = this.getProjectWorkflow(projectPath)
    const index = projectConfig.customWorkflows.findIndex(w => w.id === workflowId)

    if (index === -1) {
      // Check if trying to delete a system workflow
      const systemWorkflow = this.getSystemConfig().workflows.find(w => w.id === workflowId)
      if (systemWorkflow) {
        throw new Error('Cannot delete system/default workflows')
      }
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const workflow = projectConfig.customWorkflows[index]
    if (workflow.isDefault) {
      throw new Error('Cannot delete the default workflow')
    }

    // If deleting the active workflow, switch to system default
    if (projectConfig.activeWorkflowId === workflowId) {
      projectConfig.activeWorkflowId = this.getSystemConfig().defaultWorkflowId
      log.info('Switched to default workflow after deletion')
    }

    projectConfig.customWorkflows.splice(index, 1)
    this.saveProjectWorkflow(projectPath, projectConfig)

    log.info('Deleted workflow:', { projectPath, workflowId })
  }

  // ============================================
  // Template Management
  // ============================================

  /**
   * Get all available workflow templates.
   */
  getTemplates(): WorkflowConfig[] {
    return this.templates
  }

  /**
   * Save a workflow as a reusable template.
   * Templates are stored in-memory for this session (could be persisted later).
   */
  saveAsTemplate(workflow: WorkflowConfig, name: string): WorkflowConfig {
    const now = new Date().toISOString()
    const template: WorkflowConfig = {
      ...workflow,
      id: `template-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name,
      isTemplate: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      lockedBy: undefined,
      lockedAt: undefined
    }

    this.templates.push(template)
    log.info('Saved workflow as template:', { templateId: template.id, name })

    return template
  }

  /**
   * Create a workflow from a template for a specific project.
   */
  createFromTemplate(projectPath: string, templateId: string, name?: string): WorkflowConfig {
    const template = this.templates.find(t => t.id === templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    // Deep clone the template items
    const clonedItems = JSON.parse(JSON.stringify(template.items)) as WorkflowItem[]

    return this.createWorkflow(projectPath, {
      name: name || `${template.name} (Copy)`,
      description: template.description,
      items: clonedItems,
      isDefault: false,
      isTemplate: false
    })
  }

  // ============================================
  // Locking
  // ============================================

  /**
   * Lock a workflow for editing during execution.
   * Prevents concurrent modifications.
   */
  lockWorkflow(projectPath: string, agentId: string): boolean {
    const lockKey = this.getLockKey(projectPath)
    const existingLock = this.workflowLocks.get(lockKey)

    if (existingLock) {
      if (existingLock.agentId === agentId) {
        // Same agent, refresh lock
        existingLock.lockedAt = new Date().toISOString()
        return true
      }
      log.warn('Workflow already locked:', { projectPath, lockedBy: existingLock.agentId })
      return false
    }

    this.workflowLocks.set(lockKey, {
      agentId,
      lockedAt: new Date().toISOString()
    })

    log.info('Workflow locked:', { projectPath, agentId })
    return true
  }

  /**
   * Unlock a workflow after execution completes.
   */
  unlockWorkflow(projectPath: string, agentId: string): boolean {
    const lockKey = this.getLockKey(projectPath)
    const existingLock = this.workflowLocks.get(lockKey)

    if (!existingLock) {
      log.warn('No lock found to unlock:', projectPath)
      return false
    }

    if (existingLock.agentId !== agentId) {
      log.error('Cannot unlock - different agent holds lock:', {
        projectPath,
        holdingAgent: existingLock.agentId,
        requestingAgent: agentId
      })
      return false
    }

    this.workflowLocks.delete(lockKey)
    log.info('Workflow unlocked:', { projectPath, agentId })
    return true
  }

  /**
   * Check if a workflow is currently locked.
   */
  isWorkflowLocked(projectPath: string): { locked: boolean; lockedBy?: string; lockedAt?: string } {
    const lockKey = this.getLockKey(projectPath)
    const lock = this.workflowLocks.get(lockKey)

    if (lock) {
      return {
        locked: true,
        lockedBy: lock.agentId,
        lockedAt: lock.lockedAt
      }
    }

    return { locked: false }
  }

  /**
   * Force unlock a workflow (admin operation).
   */
  forceUnlockWorkflow(projectPath: string): void {
    const lockKey = this.getLockKey(projectPath)
    const existingLock = this.workflowLocks.get(lockKey)

    if (existingLock) {
      log.warn('Force unlocking workflow:', { projectPath, previousHolder: existingLock.agentId })
    }

    this.workflowLocks.delete(lockKey)
  }

  // ============================================
  // Rules Generation (AC5)
  // ============================================

  /**
   * Generate dynamic super-minion-rules.md content from a workflow configuration.
   * This produces markdown that the super minion can follow to execute the workflow.
   */
  generateRulesMarkdown(workflow: WorkflowConfig): string {
    const systemConfig = this.getSystemConfig()
    const lines: string[] = []

    // Header
    lines.push(`# Super Minion Workflow: ${workflow.name}`)
    lines.push('')
    if (workflow.description) {
      lines.push(`> ${workflow.description}`)
      lines.push('')
    }
    lines.push(`Generated at: ${new Date().toISOString()}`)
    lines.push('')

    // Workflow overview
    lines.push('## Workflow Overview')
    lines.push('')
    lines.push('Execute the following phases in order. Each phase must complete before moving to the next.')
    lines.push('')

    // Process each workflow item
    let phaseNumber = 1
    for (const item of workflow.items) {
      if (!this.isItemEnabled(item)) {
        continue
      }

      if (isWorkflowStep(item)) {
        lines.push(...this.generateStepMarkdown(item, phaseNumber, systemConfig.subagentTypes))
      } else if (isParallelGroup(item)) {
        lines.push(...this.generateParallelGroupMarkdown(item, phaseNumber, systemConfig.subagentTypes))
      }

      phaseNumber++
      lines.push('')
    }

    // Footer with subagent reference
    lines.push('---')
    lines.push('')
    lines.push('## Subagent Type Reference')
    lines.push('')
    for (const type of systemConfig.subagentTypes) {
      lines.push(`### ${type.name} (${type.id})`)
      lines.push(`- **Description**: ${type.description}`)
      if (type.capabilities && type.capabilities.length > 0) {
        lines.push(`- **Capabilities**: ${type.capabilities.join(', ')}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Generate markdown for a single sequential step.
   */
  private generateStepMarkdown(step: WorkflowStep, phaseNumber: number, subagentTypes: SubagentType[]): string[] {
    const lines: string[] = []
    const subagentType = subagentTypes.find(t => t.id === step.subagentTypeId)

    lines.push(`### Phase ${phaseNumber}: ${step.name}`)
    lines.push('')
    lines.push(`**Execution Type**: Sequential`)
    lines.push(`**Subagent Type**: ${subagentType?.name || step.subagentTypeId}`)
    lines.push('')

    // Prompt/instructions
    const prompt = step.promptOverride || subagentType?.defaultPromptTemplate
    if (prompt) {
      lines.push('**Instructions**:')
      lines.push('')
      lines.push('```')
      lines.push(prompt)
      lines.push('```')
      lines.push('')
    }

    // Configuration if present
    if (step.config) {
      lines.push('**Configuration**:')
      if (step.config.timeout) {
        lines.push(`- Timeout: ${step.config.timeout}ms`)
      }
      if (step.config.retryOnFailure) {
        lines.push(`- Retry on failure: Yes`)
      }
      if (step.config.continueOnFailure) {
        lines.push(`- Continue on failure: Yes`)
      }
      lines.push('')
    }

    return lines
  }

  /**
   * Generate markdown for a parallel execution group.
   */
  private generateParallelGroupMarkdown(group: { id: string; steps: WorkflowStep[] }, phaseNumber: number, subagentTypes: SubagentType[]): string[] {
    const lines: string[] = []
    const enabledSteps = group.steps.filter(s => s.enabled)

    lines.push(`### Phase ${phaseNumber}: Parallel Execution Group`)
    lines.push('')
    lines.push(`**Execution Type**: Parallel (${enabledSteps.length} concurrent tasks)`)
    lines.push('')
    lines.push('The following steps should be executed **simultaneously**:')
    lines.push('')

    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i]
      const subagentType = subagentTypes.find(t => t.id === step.subagentTypeId)
      const stepLetter = String.fromCharCode(97 + i) // a, b, c, ...

      lines.push(`#### ${phaseNumber}${stepLetter}. ${step.name}`)
      lines.push('')
      lines.push(`**Subagent Type**: ${subagentType?.name || step.subagentTypeId}`)
      lines.push('')

      const prompt = step.promptOverride || subagentType?.defaultPromptTemplate
      if (prompt) {
        lines.push('**Instructions**:')
        lines.push('')
        lines.push('```')
        lines.push(prompt)
        lines.push('```')
        lines.push('')
      }
    }

    lines.push('**Synchronization**: Wait for ALL parallel tasks to complete before proceeding to the next phase.')

    return lines
  }

  /**
   * Check if a workflow item is enabled.
   */
  private isItemEnabled(item: WorkflowItem): boolean {
    if (isWorkflowStep(item)) {
      return item.enabled
    }
    if (isParallelGroup(item)) {
      // Group is enabled if any step is enabled
      return item.steps.some(s => s.enabled)
    }
    return true
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Get the path to bundled config files.
   * Handles both packaged and development environments.
   */
  private getConfigPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'minions', 'config')
    } else {
      return join(app.getAppPath(), 'resources', 'minions', 'config')
    }
  }

  /**
   * Get the path to a project's workflow config file.
   */
  private getProjectWorkflowPath(projectPath: string): string {
    return join(projectPath, 'minions', 'workflow-config.json')
  }

  /**
   * Generate a lock key for a project.
   */
  private getLockKey(projectPath: string): string {
    return `workflow-lock:${projectPath}`
  }
}
