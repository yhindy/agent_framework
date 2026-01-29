import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { ProjectConfig, Assignment, AgentInfo, SuperAgentInfo, ChildPlan, UIState, ArchivedAgent, HandoffRequest, HandoffResult, HandoffSource, SpawnSource, SpawnResult } from './types/ProjectConfig'
import { ClaudeSessionInfoService, TaskInvocation } from './ClaudeSessionInfoService'
import { Mutex } from 'async-mutex'
import { createLogger } from './logger'
import { ProjectConfigHelper } from './ProjectConfigHelper'
import { WorktreeService } from './WorktreeService'
import { PRTrackingService } from './PRTrackingService'
import { AgentMigrationService } from './AgentMigrationService'
import { AgentArchiveService } from './AgentArchiveService'

const log = createLogger('AgentService')
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// Reserved branch name suffixes that would collide with special agents or git references
const RESERVED_BRANCH_SUFFIXES = ['base', 'main', 'master', 'origin', 'head']

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  mode?: string
  tool?: string
  isSuperMinion?: boolean
  parentAgentId?: string
  handoffSource?: HandoffSource
  isBaseBranchAgent?: boolean
  branch?: string
  displayBranchName?: string  // Custom/detected branch name for display (e.g., from teleport metadata)

  // Session persistence fields
  claudeSessionId?: string
  cloudSessionId?: string
  isTeleportedSession?: boolean
  claudeSessionActive?: boolean
  isWaitingForInput?: boolean
  prompt?: string
  model?: string
  yolo?: boolean
  chrome?: boolean

  // UI state persistence
  uiState?: UIState
}

export class AgentService {
  private sessions: Map<string, AgentSession>
  private claudeSessionInfoService?: ClaudeSessionInfoService
  // NOTE: PR detection cache has been consolidated to PRPollingService
  // No longer maintaining duplicate cache here

  // Cache for agent/assignment ID to project path mapping.
  // Avoids repeated git worktree list calls which can cause EAGAIN spawn errors.
  private projectLookupCache: Map<string, { timestamp: number; projectPath: string }> = new Map()
  private readonly PROJECT_LOOKUP_CACHE_TTL_MS = 30 * 1000 // 30 seconds

  // Mutex for serializing worktree creation operations to prevent race conditions
  // when multiple spawns happen in parallel (git worktree operations can conflict)
  private worktreeMutex = new Mutex()

  // Extracted service delegates
  private projectConfigHelper: ProjectConfigHelper
  private worktreeService: WorktreeService
  private prTrackingService: PRTrackingService
  private agentMigrationService: AgentMigrationService
  private agentArchiveService: AgentArchiveService

  constructor() {
    this.sessions = new Map()

    // Initialize extracted services
    this.projectConfigHelper = new ProjectConfigHelper()
    this.worktreeService = new WorktreeService(this.projectConfigHelper)
    this.prTrackingService = new PRTrackingService(
      this.projectConfigHelper,
      this.worktreeService,
      {
        getAssignments: (projectPath) => this.getAssignments(projectPath),
        readAgentInfo: (...args) => this.readAgentInfo(...args),
        writeAgentInfo: (...args) => this.writeAgentInfo(...args),
        updateAgentInfo: (...args) => this.updateAgentInfo(...args),
      }
    )
    this.agentMigrationService = new AgentMigrationService(
      this.projectConfigHelper,
      this.worktreeService,
      {
        writeAgentInfo: (...args) => this.writeAgentInfo(...args),
      }
    )
    // Use arrow functions instead of .bind() so that vi.spyOn() on AgentService methods
    // is visible to the delegate (bound refs capture the original, not the spy)
    this.agentArchiveService = new AgentArchiveService({
      listAgents: (projectPath) => this.listAgents(projectPath),
      readAgentInfo: (worktreePath) => this.readAgentInfo(worktreePath),
      createAssignment: (projectPath, assignment) => this.createAssignment(projectPath, assignment),
    })
  }

  setClaudeSessionInfoService(service: ClaudeSessionInfoService): void {
    this.claudeSessionInfoService = service
  }

  /**
   * Validate a teleported session to ensure it can be resumed.
   * Checks if JSONL file exists, is not corrupted, and is resumable.
   *
   * @param agentInfo - The agent info containing session details
   * @param worktreePath - The worktree path (required to find JSONL file correctly)
   */
  async validateTeleportSession(agentInfo: AgentInfo, worktreePath?: string): Promise<{
    isValid: boolean
    reason?: string
    canResume: boolean
  }> {
    const invalid = (reason: string) => ({ isValid: false, reason, canResume: false })

    // Validate teleport session requirements
    if (!agentInfo.cloudSessionId && !agentInfo.isTeleportedSession) {
      return invalid('Not a teleported session (missing cloudSessionId)')
    }
    if (!agentInfo.cloudSessionId) {
      return invalid('Teleported session missing cloudSessionId')
    }

    // Find JSONL file: try ClaudeSessionInfoService first, then legacy path
    const jsonlPath = this.findJsonlPath(agentInfo, worktreePath)
    if (!jsonlPath) {
      return invalid('JSONL file not found (checked worktree hash directory and legacy paths)')
    }

    // Validate file freshness (must be modified within 7 days)
    try {
      const stats = statSync(jsonlPath)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
      if (stats.mtimeMs < sevenDaysAgo) {
        return invalid('JSONL file is stale (older than 7 days)')
      }
    } catch {
      return invalid('Failed to read JSONL file stats')
    }

    // Validate file content (must be non-empty valid JSONL)
    try {
      const content = readFileSync(jsonlPath, 'utf-8')
      if (!content.trim()) {
        return invalid('JSONL file is empty')
      }
      JSON.parse(content.split('\n')[0])
    } catch {
      return invalid('JSONL file is corrupted (invalid JSON)')
    }

    // Check if session state is resumable
    if (agentInfo.status === 'completed' || agentInfo.status === 'closed') {
      return { isValid: true, reason: 'Session is completed or closed', canResume: false }
    }

    return { isValid: true, canResume: true }
  }

  /**
   * Find the JSONL file path for a teleported session.
   * Tries ClaudeSessionInfoService first (worktree hash directory), then legacy path.
   *
   * Precondition: agentInfo.cloudSessionId must be defined (caller validates this).
   */
  private findJsonlPath(agentInfo: AgentInfo, worktreePath?: string): string | null {
    const cloudSessionId = agentInfo.cloudSessionId!

    // Try ClaudeSessionInfoService for correct path lookup
    if (this.claudeSessionInfoService && worktreePath) {
      const sessionId = agentInfo.claudeSessionId || cloudSessionId
      const path = this.claudeSessionInfoService.findSessionFile(sessionId, worktreePath)
      if (path) return path
    }

    // Fallback to legacy path for backwards compatibility
    const legacyPath = join(homedir(), '.claude', 'projects', cloudSessionId, 'session.jsonl')
    return existsSync(legacyPath) ? legacyPath : null
  }

  // --- Delegated to PRTrackingService ---

  async checkDependencies(): Promise<{ ghInstalled: boolean; ghAuthenticated: boolean; error?: string }> {
    return this.prTrackingService.checkDependencies()
  }

  // --- Session helpers ---

  /**
   * Create a new AgentSession from AgentInfo
   */
  private createSessionFromInfo(agentInfo: AgentInfo, worktreePath: string, isBase: boolean): AgentSession {
    return {
      id: agentInfo.agentId,
      assignmentId: agentInfo.id,
      worktreePath,
      terminalPid: null,
      hasUnread: agentInfo.hasUnread || false,
      lastActivity: agentInfo.lastActivity,
      mode: agentInfo.mode,
      tool: agentInfo.tool,
      isSuperMinion: (agentInfo as any).isSuperMinion || false,
      parentAgentId: agentInfo.parentAgentId,
      handoffSource: agentInfo.handoffSource,
      isBaseBranchAgent: isBase,
      claudeSessionId: agentInfo.claudeSessionId,
      cloudSessionId: agentInfo.cloudSessionId,
      isTeleportedSession: agentInfo.isTeleportedSession,
      claudeSessionActive: agentInfo.claudeSessionActive,
      isWaitingForInput: agentInfo.isWaitingForInput,
      prompt: agentInfo.prompt,
      model: agentInfo.model,
      uiState: agentInfo.uiState,
      branch: agentInfo.branch,
      displayBranchName: agentInfo.displayBranchName,
      yolo: agentInfo.yolo,
      chrome: agentInfo.chrome
    }
  }

  /**
   * Update an existing AgentSession with data from AgentInfo
   */
  private updateSessionFromInfo(session: AgentSession, agentInfo: AgentInfo): void {
    Object.assign(session, {
      assignmentId: agentInfo.id,
      mode: agentInfo.mode,
      tool: agentInfo.tool,
      hasUnread: agentInfo.hasUnread || session.hasUnread,
      lastActivity: agentInfo.lastActivity,
      isSuperMinion: (agentInfo as any).isSuperMinion,
      parentAgentId: agentInfo.parentAgentId,
      handoffSource: agentInfo.handoffSource,
      claudeSessionId: agentInfo.claudeSessionId,
      cloudSessionId: agentInfo.cloudSessionId,
      isTeleportedSession: agentInfo.isTeleportedSession,
      claudeSessionActive: agentInfo.claudeSessionActive,
      isWaitingForInput: agentInfo.isWaitingForInput,
      prompt: agentInfo.prompt,
      model: agentInfo.model,
      uiState: agentInfo.uiState,
      branch: agentInfo.branch,
      displayBranchName: agentInfo.displayBranchName,
      yolo: agentInfo.yolo,
      chrome: agentInfo.chrome
    })
  }

  async listAgents(projectPath: string): Promise<AgentSession[]> {
    const agents: AgentSession[] = []

    try {
      // Get base agent if it exists
      const baseInfoPath = join(projectPath, '.minions-base-info')
      if (existsSync(baseInfoPath)) {
        try {
          const content = readFileSync(baseInfoPath, 'utf-8')
          const baseAgentInfo = JSON.parse(content) as AgentInfo
          if (baseAgentInfo.isBaseBranchAgent) {
            let session = this.sessions.get(baseAgentInfo.agentId)
            if (!session) {
              session = this.createSessionFromInfo(baseAgentInfo, projectPath, true)
              this.sessions.set(baseAgentInfo.agentId, session)
            } else {
              this.updateSessionFromInfo(session, baseAgentInfo)
              session.isBaseBranchAgent = true
            }
            agents.push(session)
          }
        } catch (error) {
          log.error('Error reading base agent info', error)
        }
      }

      // Get worktrees from git
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectPath })

      const config = this.getProjectConfig(projectPath)
      const projectName = config.project?.name || projectPath.split('/').pop() || 'project'
      const worktrees = this.parseWorktrees(stdout, projectName)

      for (const worktree of worktrees) {
        // Read agent info from .agent-info file (supports both old and new formats)
        const agentInfo = this.readAgentInfo(worktree.path)

        if (agentInfo) {
          // Skip agents with missing/empty critical fields (corrupted agent info)
          if (!agentInfo.agentId || agentInfo.agentId.trim() === '') {
            log.warn(`Skipping agent with corrupted info at ${worktree.path}: missing agentId`)
            continue
          }

          // Get or create session
          let session = this.sessions.get(agentInfo.agentId)
          if (!session) {
            session = this.createSessionFromInfo(agentInfo, worktree.path, false)
            this.sessions.set(agentInfo.agentId, session)
          } else {
            this.updateSessionFromInfo(session, agentInfo)
          }

          agents.push(session)
        }
      }
    } catch (error) {
      log.error('Error listing agents', error)
    }

    return agents
  }

  // --- Delegated to WorktreeService ---

  parseWorktrees(output: string, projectName: string): Array<{ path: string; branch: string }> {
    return this.worktreeService.parseWorktrees(output, projectName)
  }

  // --- Delegated to AgentMigrationService ---

  parseAgentInfo(filePath: string): Record<string, string> {
    return this.agentMigrationService.parseAgentInfo(filePath)
  }

  // --- Agent info read/write (stays in AgentService - used by many callers) ---

  /**
   * Read agent info from file system.
   * For new format projects with minions.json, checks .minions/agents/{id}.json first.
   * Falls back to .agent-info in worktree for legacy projects.
   *
   * @param worktreePath - Path to the worktree (or project root for base agents)
   * @param agentId - Optional agent ID for new format lookup
   * @param projectPath - Optional project path for new format lookup
   * @returns AgentInfo or null if not found
   */
  readAgentInfo(worktreePath: string, agentId?: string, projectPath?: string): AgentInfo | null {
    // If agentId and projectPath provided, try new format first
    if (agentId && projectPath) {
      const newAgentInfoPath = join(projectPath, '.minions', 'agents', `${agentId}.json`)
      if (existsSync(newAgentInfoPath)) {
        try {
          const content = readFileSync(newAgentInfoPath, 'utf-8')
          return JSON.parse(content) as AgentInfo
        } catch (error) {
          console.error(`Error reading new format agent info at ${newAgentInfoPath}:`, error)
          // Fall through to legacy locations
        }
      }
    }

    // Check for base agent info first (.minions-base-info in project root)
    const baseInfoPath = join(worktreePath, '.minions-base-info')
    if (existsSync(baseInfoPath)) {
      try {
        const content = readFileSync(baseInfoPath, 'utf-8')
        const info = JSON.parse(content) as AgentInfo
        if (info.isBaseBranchAgent) {
          return info
        }
      } catch {
        // Fall through to check .agent-info
      }
    }

    // Check for regular agent info (.agent-info in worktree)
    const agentInfoPath = join(worktreePath, '.agent-info')
    if (!existsSync(agentInfoPath)) {
      return null
    }

    try {
      const content = readFileSync(agentInfoPath, 'utf-8')

      // Try to parse as JSON first (new format)
      try {
        return JSON.parse(content)
      } catch {
        // Fall back to parsing old key=value format
        const info = this.parseAgentInfo(agentInfoPath)

        // Convert to AgentInfo format
        return {
          id: info.AGENT_ID || '',
          agentId: info.AGENT_ID || '',
          branch: info.BRANCH || '',
          project: info.PROJECT || '',
          feature: '',  // Not available in old format
          status: 'active',  // Default status
          tool: 'claude',  // Default tool
          mode: 'auto',  // Default mode
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        }
      }
    } catch (error) {
      log.error('Error reading .agent-info', error)
      return null
    }
  }

  /**
   * Write agent info to file system.
   * For new format projects with minions.json, writes to .minions/agents/{id}.json.
   * For legacy projects, writes to .agent-info in worktree.
   *
   * @param worktreePath - Path to the worktree (or project root for base agents)
   * @param info - AgentInfo to write
   * @param projectPath - Optional project path for new format detection
   */
  writeAgentInfo(worktreePath: string, info: AgentInfo, projectPath?: string): void {
    // Base agents are handled separately via writeBaseAgentInfo
    if (info.isBaseBranchAgent) {
      const baseInfoPath = join(worktreePath, '.minions-base-info')
      writeFileSync(baseInfoPath, JSON.stringify(info, null, 2))
      return
    }

    // Check if this is a new format project
    const effectiveProjectPath = projectPath || worktreePath
    if (this.isNewFormatProject(effectiveProjectPath)) {
      const agentsDir = join(effectiveProjectPath, '.minions', 'agents')
      mkdirSync(agentsDir, { recursive: true })
      const agentInfoPath = join(agentsDir, `${info.agentId}.json`)
      writeFileSync(agentInfoPath, JSON.stringify(info, null, 2))
    } else {
      // Legacy: write to .agent-info in worktree
      const agentInfoPath = join(worktreePath, '.agent-info')
      writeFileSync(agentInfoPath, JSON.stringify(info, null, 2))
    }
  }

  /**
   * Read base agent info from file system.
   * For new format projects, checks .minions/base-agent.json first.
   * Falls back to .minions-base-info for legacy projects.
   *
   * @param projectPath - Path to the project root
   * @returns AgentInfo or null if not found
   */
  readBaseAgentInfo(projectPath: string): AgentInfo | null {
    // New format first: .minions/base-agent.json
    const newBaseInfoPath = join(projectPath, '.minions', 'base-agent.json')
    if (existsSync(newBaseInfoPath)) {
      try {
        const content = readFileSync(newBaseInfoPath, 'utf-8')
        return JSON.parse(content) as AgentInfo
      } catch (error) {
        console.error(`Error reading new format base agent info at ${newBaseInfoPath}:`, error)
        // Fall through to legacy location
      }
    }

    // Legacy fallback: .minions-base-info
    const legacyBaseInfoPath = join(projectPath, '.minions-base-info')
    if (existsSync(legacyBaseInfoPath)) {
      try {
        const content = readFileSync(legacyBaseInfoPath, 'utf-8')
        return JSON.parse(content) as AgentInfo
      } catch (error) {
        console.error(`Error reading legacy base agent info at ${legacyBaseInfoPath}:`, error)
        return null
      }
    }

    return null
  }

  /**
   * Write base agent info to file system.
   * For new format projects with minions.json, writes to .minions/base-agent.json.
   * For legacy projects, writes to .minions-base-info.
   *
   * @param projectPath - Path to the project root
   * @param info - AgentInfo to write
   */
  writeBaseAgentInfo(projectPath: string, info: AgentInfo): void {
    if (this.isNewFormatProject(projectPath)) {
      const minionsDir = join(projectPath, '.minions')
      mkdirSync(minionsDir, { recursive: true })
      const baseInfoPath = join(minionsDir, 'base-agent.json')
      writeFileSync(baseInfoPath, JSON.stringify(info, null, 2))
    } else {
      // Legacy: write to .minions-base-info
      const baseInfoPath = join(projectPath, '.minions-base-info')
      writeFileSync(baseInfoPath, JSON.stringify(info, null, 2))
    }
  }

  /**
   * Update agent info with partial updates.
   * For new format projects, agentId and projectPath should be provided.
   *
   * @param worktreePath - Path to the worktree
   * @param updates - Partial AgentInfo updates to apply
   * @param agentId - Optional agent ID for new format lookup
   * @param projectPath - Optional project path for new format lookup
   */
  updateAgentInfo(worktreePath: string, updates: Partial<AgentInfo>, agentId?: string, projectPath?: string): void {
    const current = this.readAgentInfo(worktreePath, agentId, projectPath)
    if (!current) {
      throw new Error(`Agent info not found at worktree path: ${worktreePath}`)
    }

    const updated = { ...current, ...updates, lastActivity: new Date().toISOString() }
    this.writeAgentInfo(worktreePath, updated, projectPath)
  }

  /**
   * Mark an agent session as failed with a specific reason.
   * Sets failureReason and marks session as inactive.
   *
   * @param worktreePath - Path to the worktree
   * @param reason - Failure reason message
   * @param agentId - Optional agent ID for new format lookup
   * @param projectPath - Optional project path for new format lookup
   */
  async markAgentAsFailed(worktreePath: string, reason: string, agentId?: string, projectPath?: string): Promise<void> {
    this.updateAgentInfo(worktreePath, {
      failureReason: reason,
      claudeSessionActive: false
    }, agentId, projectPath)
  }

  /**
   * Update the display branch name for an agent (used for teleported sessions)
   */
  async updateAgentBranchName(projectPath: string, agentId: string, branchName: string): Promise<void> {
    const agents = await this.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)

    if (!agent) {
      throw new Error('Agent not found')
    }

    this.updateAgentInfo(agent.worktreePath, {
      displayBranchName: branchName
    }, agentId, projectPath)
  }

  /**
   * Get cached project path for an agent/assignment ID if still valid.
   * Returns null if cache miss, expired, or project is no longer active.
   */
  private getCachedProjectPath(id: string, activeProjectPaths: string[]): string | null {
    const cached = this.projectLookupCache.get(id)
    if (!cached) return null

    const isValid = Date.now() - cached.timestamp < this.PROJECT_LOOKUP_CACHE_TTL_MS
      && activeProjectPaths.includes(cached.projectPath)

    return isValid ? cached.projectPath : null
  }

  /**
   * Update the project lookup cache for multiple IDs belonging to the same project.
   */
  private updateProjectLookupCache(ids: string[], projectPath: string): void {
    const now = Date.now()
    for (const id of ids) {
      this.projectLookupCache.set(id, { timestamp: now, projectPath })
    }
  }

  async findProjectForAgent(activeProjectPaths: string[], agentId: string): Promise<string> {
    const cached = this.getCachedProjectPath(agentId, activeProjectPaths)
    if (cached) return cached

    for (const projectPath of activeProjectPaths) {
      const agents = await this.listAgents(projectPath)
      this.updateProjectLookupCache(agents.map(a => a.id), projectPath)
      if (agents.some(a => a.id === agentId)) {
        return projectPath
      }
    }
    throw new Error(`Agent ${agentId} not found in any active project`)
  }

  async findProjectForAssignment(activeProjectPaths: string[], assignmentId: string): Promise<string> {
    const cached = this.getCachedProjectPath(assignmentId, activeProjectPaths)
    if (cached) return cached

    for (const projectPath of activeProjectPaths) {
      const { assignments } = await this.getAssignments(projectPath)
      this.updateProjectLookupCache(assignments.map(a => a.id), projectPath)
      if (assignments.some(a => a.id === assignmentId)) {
        return projectPath
      }
    }
    throw new Error(`Assignment ${assignmentId} not found in any active project`)
  }

  // --- Delegated to ProjectConfigHelper ---

  private getMinionsPath(): string {
    return this.projectConfigHelper.getMinionsPath()
  }

  getSuperMinionRulesPath(): string {
    const minionsPath = this.getMinionsPath()
    return join(minionsPath, 'rules', 'super-minion-rules.md')
  }

  private getProjectConfigPath(projectPath: string): string {
    return this.projectConfigHelper.getProjectConfigPath(projectPath)
  }

  /**
   * Check if this project uses the new minions.json format.
   * @param projectPath - Path to the project root
   * @returns true if minions.json exists at project root
   */
  isNewFormatProject(projectPath: string): boolean {
    return this.projectConfigHelper.isNewFormatProject(projectPath)
  }

  /**
   * Get the project name from config, falling back to directory name.
   * This must be used consistently for worktree path computation.
   */
  getProjectName(projectPath: string): string {
    return this.projectConfigHelper.getProjectName(projectPath)
  }

  private getProjectConfig(projectPath: string): ProjectConfig {
    return this.projectConfigHelper.getProjectConfig(projectPath)
  }

  // saveProjectConfig is available via this.projectConfigHelper.saveProjectConfig()

  // --- Assignment creation (stays in AgentService - core lifecycle logic) ---

  async createAssignment(projectPath: string, assignment: Partial<Assignment>): Promise<AgentInfo> {
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project.name || projectPath.split('/').pop() || 'project'

    // Auto-generate agent ID from branch suffix if not provided
    let agentId = assignment.agentId
    let branch = assignment.branch!

    if (!agentId) {
      // Extract branch suffix and use it for agentId (sanitize for git/filesystem)
      const branchSuffix = branch.startsWith('feature/')
        ? branch.replace(/^feature\//, '').split('/').pop() || branch
        : branch
      const sanitizedSuffix = branchSuffix
        .replace(/[^a-zA-Z0-9_-]/g, '-')  // Replace invalid chars with dashes
        .replace(/-+/g, '-')               // Collapse multiple dashes
        .replace(/^-|-$/g, '')             // Remove leading/trailing dashes

      // Validate against reserved names (case-insensitive)
      if (RESERVED_BRANCH_SUFFIXES.includes(sanitizedSuffix.toLowerCase())) {
        throw new Error(
          `Branch name "${sanitizedSuffix}" is reserved. Reserved names: ${RESERVED_BRANCH_SUFFIXES.join(', ')}. ` +
          `These names conflict with special agents or git references.`
        )
      }

      agentId = `${projectName}-${sanitizedSuffix}`
    }

    // Auto-generate branch name if not provided
    if (!branch.startsWith('feature/')) {
      branch = `feature/${branch}`
    }

    // Calculate worktree path
    const worktreePath = this.projectConfigHelper.getWorktreePath(projectPath, agentId)

    // Create AgentInfo object
    const agentInfo: AgentInfo = {
      id: assignment.id || `${agentId}-${Date.now()}`,
      agentId: agentId,
      branch: branch,
      project: projectName,
      feature: assignment.feature!,
      status: assignment.status as any || 'active',
      tool: assignment.tool || 'claude',
      model: assignment.model,
      mode: assignment.mode as any || 'auto',
      yolo: assignment.yolo,
      chrome: assignment.chrome !== false,
      prompt: assignment.prompt,
      prUrl: undefined,
      prStatus: undefined,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    }

    // Run setup.sh to create the agent worktree
    const setupScript = join(this.getMinionsPath(), 'bin', 'setup.sh')
    const configPath = this.getProjectConfigPath(projectPath)

    try {
      const { stdout, stderr } = await execFileAsync(
        setupScript,
        [agentInfo.agentId, agentInfo.branch, '--config', configPath],
        { cwd: projectPath }
      )
      log.debug('Setup script output:', stdout)
      if (stderr) log.warn('Setup script errors:', stderr)

      // Write agent info to .agent-info file in the worktree
      this.writeAgentInfo(worktreePath, agentInfo)

      // Commit any setup files to prevent git dirty state
      // This is important for teleport which fails on dirty worktrees
      await this.commitSetupFiles(worktreePath)
    } catch (error: any) {
      log.error('Failed to run setup.sh', error)
      throw error
    }

    return agentInfo
  }

  // --- Delegated to WorktreeService ---

  private async commitSetupFiles(worktreePath: string): Promise<void> {
    return this.worktreeService.commitSetupFiles(worktreePath)
  }

  private async commitCurrentChanges(worktreePath: string): Promise<{ success: boolean; error?: string }> {
    return this.worktreeService.commitCurrentChanges(worktreePath)
  }

  /**
   * Read the yolo flag from a source agent, checking active sessions first
   * then falling back to reading from the worktree on disk.
   * Returns false if the source agent cannot be found or read.
   */
  private readSourceAgentYolo(sourceAgentId: string, projectPath: string): boolean {
    try {
      const sourceSession = this.sessions.get(sourceAgentId)
      const worktreePath = sourceSession?.worktreePath
        ?? join(dirname(projectPath), sourceAgentId)

      const sourceInfo = this.readAgentInfo(worktreePath)
      return sourceInfo?.yolo ?? false
    } catch (err: any) {
      log.debug(`Could not read source agent ${sourceAgentId} for yolo inheritance: ${err.message}`)
      return false
    }
  }

  // --- Delegated to WorktreeService ---

  private sanitizeBranchName(name: string): string {
    return this.worktreeService.sanitizeBranchName(name)
  }

  private generateBranchSuffix(shortName?: string, prompt?: string): string {
    return this.worktreeService.generateBranchSuffix(shortName, prompt)
  }

  // --- Handoff logic (stays in AgentService - core lifecycle) ---

  /**
   * Generate context to prepend to the new agent's prompt.
   * Provides 2-3 lines of context about the parent feature.
   */
  private generateHandoffContext(sourceAgentInfo: AgentInfo, branchMode: 'inherit' | 'fresh'): string {
    const sourceBranch = sourceAgentInfo.branch
    const sourceFeature = this.truncateFeatureDescription(sourceAgentInfo)

    const modeDescription = branchMode === 'inherit'
      ? `You are continuing work from branch \`${sourceBranch}\`.`
      : `You are starting fresh from main, related to prior work on \`${sourceBranch}\`.`

    return `## Handoff Context

${modeDescription}
Parent agent was working on: ${sourceFeature}

---

`
  }

  /**
   * Extract a truncated feature description from agent info.
   * Falls back to prompt excerpt or default text.
   */
  private truncateFeatureDescription(agentInfo: AgentInfo, maxLength: number = 200): string {
    const description = agentInfo.feature || agentInfo.prompt?.substring(0, 150) || 'parent agent work'
    return description.substring(0, maxLength)
  }

  /**
   * Validate a handoff request payload.
   * Checks that all required fields are present and valid.
   */
  private isValidHandoffPayload(payload: any): payload is HandoffRequest {
    if (!payload || typeof payload !== 'object') return false

    const hasValidSourceAgentId = typeof payload.sourceAgentId === 'string' && payload.sourceAgentId.trim() !== ''
    const hasValidPrompt = typeof payload.prompt === 'string' && payload.prompt.trim() !== ''
    const hasValidBranchMode = payload.branchMode === 'inherit' || payload.branchMode === 'fresh'

    return hasValidSourceAgentId && hasValidPrompt && hasValidBranchMode
  }

  /**
   * Handoff from one agent to another.
   * Creates a new agent that can optionally inherit the source agent's branch.
   *
   * @param projectPath - The path to the project
   * @param request - The handoff request containing source agent, prompt, and options
   * @returns HandoffResult with the new agent or error information
   */
  async handoffAgent(projectPath: string, request: HandoffRequest): Promise<HandoffResult> {
    // Validate the request
    if (!this.isValidHandoffPayload(request)) {
      return {
        success: false,
        error: 'Invalid handoff request: missing or invalid required fields (sourceAgentId, prompt, branchMode)'
      }
    }

    try {
      // Find the source agent
      const agents = await this.listAgents(projectPath)
      const sourceSession = agents.find(a => a.id === request.sourceAgentId)

      if (!sourceSession) {
        return {
          success: false,
          error: `Source agent ${request.sourceAgentId} not found`
        }
      }

      // Read the source agent's full info
      const sourceAgentInfo = this.readAgentInfo(sourceSession.worktreePath)
      if (!sourceAgentInfo) {
        return {
          success: false,
          error: `Failed to read source agent info for ${request.sourceAgentId}`
        }
      }

      // Commit current changes in source agent's worktree before handoff
      log.info(`Committing current changes before handoff from ${request.sourceAgentId}`)
      const commitResult = await this.commitCurrentChanges(sourceSession.worktreePath)
      if (!commitResult.success) {
        return {
          success: false,
          error: commitResult.error || 'Failed to commit changes before handoff'
        }
      }

      // Determine tool and model (use overrides or inherit from source)
      const tool = request.tool || sourceAgentInfo.tool
      const model = request.model || sourceAgentInfo.model

      // Determine yolo and chrome flags (use explicit override or inherit from source)
      const yolo = request.yolo ?? sourceAgentInfo.yolo
      const chrome = request.chrome ?? sourceAgentInfo.chrome

      // Generate branch name
      const config = this.getProjectConfig(projectPath)
      const projectName = config.project.name || projectPath.split('/').pop() || 'project'
      const hash = Math.random().toString(36).substring(2, 9)
      const agentId = `${projectName}-${hash}`

      // Generate branch suffix (custom or auto-generated from prompt)
      const branchSuffix = this.generateBranchSuffix(request.shortName, request.prompt)

      const branch = `feature/${agentId}/${branchSuffix}`

      // Determine base branch for worktree creation
      // In 'inherit' mode, we branch from the source agent's branch
      // In 'fresh' mode, we branch from main/master
      const baseBranch = request.branchMode === 'inherit'
        ? sourceAgentInfo.branch
        : config.project.defaultBaseBranch || 'main'

      // Create handoff source metadata
      const handoffSource: HandoffSource = {
        agentId: request.sourceAgentId,
        branchMode: request.branchMode,
        originalBranch: sourceAgentInfo.branch,
        handoffTimestamp: new Date().toISOString()
      }

      // Calculate worktree path
      const worktreePath = join(dirname(projectPath), agentId)

      // Generate handoff context to prepend to the prompt
      const handoffContext = this.generateHandoffContext(sourceAgentInfo, request.branchMode)
      const promptWithContext = handoffContext + request.prompt

      // Create AgentInfo for the new agent
      const newAgentInfo: AgentInfo = {
        id: `${agentId}-${Date.now()}`,
        agentId: agentId,
        branch: branch,
        project: projectName,
        feature: request.prompt.substring(0, 100), // First 100 chars as feature description (without context prefix)
        status: 'active',
        tool: tool,
        model: model,
        mode: 'dev',
        yolo: yolo,
        chrome: chrome !== false,
        prompt: promptWithContext,  // Prompt includes handoff context
        parentAgentId: request.sourceAgentId, // Track lineage for tree hierarchy
        handoffSource: handoffSource,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      // Run setup.sh to create the agent worktree
      const setupScript = join(this.getMinionsPath(), 'bin', 'setup.sh')
      const configPath = this.getProjectConfigPath(projectPath)

      try {
        // For inherit mode, pass the base branch as 3rd positional arg (before --config)
        // setup.sh signature: <agent-id> <branch-name> [base-branch] [--config path]
        const setupArgs = request.branchMode === 'inherit'
          ? [newAgentInfo.agentId, newAgentInfo.branch, baseBranch, '--config', configPath]
          : [newAgentInfo.agentId, newAgentInfo.branch, '--config', configPath]

        const { stdout, stderr } = await execFileAsync(
          setupScript,
          setupArgs,
          { cwd: projectPath }
        )
        log.debug('Setup script output:', stdout)
        if (stderr) log.warn('Setup script errors:', stderr)

        // Write agent info to .agent-info file in the worktree
        this.writeAgentInfo(worktreePath, newAgentInfo)

        // Commit any setup files to prevent git dirty state
        await this.commitSetupFiles(worktreePath)

        log.info(`Handoff completed: ${request.sourceAgentId} -> ${newAgentInfo.agentId}`)

        return {
          success: true,
          newAgent: newAgentInfo
        }
      } catch (error: any) {
        log.error('Failed to run setup.sh for handoff', error)
        return {
          success: false,
          error: `Failed to create handoff agent: ${error.message}`
        }
      }
    } catch (error: any) {
      log.error('Handoff failed', error)
      return {
        success: false,
        error: `Handoff failed: ${error.message}`
      }
    }
  }

  /**
   * Spawn a super minion with minimal context.
   * Creates fresh worktree from main, sets up workflow, and returns the agent info.
   *
   * Uses a mutex to serialize worktree creation operations, preventing race conditions
   * when multiple spawns happen in parallel.
   *
   * @param projectPath - Project to spawn in
   * @param plan - Work description (minimal context)
   * @param workflowId - Which workflow to use
   * @param sourceAgentId - Parent agent ID for lineage
   * @param batchId - Batch ID for tracking
   * @param shortName - Optional branch suffix
   */
  async spawnSuperMinion(
    projectPath: string,
    plan: string,
    workflowId: string,
    sourceAgentId: string,
    batchId: string,
    shortName?: string
  ): Promise<SpawnResult> {
    try {
      // Get project config
      const config = this.getProjectConfig(projectPath)
      const projectName = config.project.name || projectPath.split('/').pop() || 'project'
      const baseBranch = config.project.defaultBaseBranch || 'main'

      // Inherit yolo mode from source agent
      // Try active session first, then fall back to worktree path on disk
      const sourceYolo = this.readSourceAgentYolo(sourceAgentId, projectPath)

      // Generate branch name and agent ID
      const hash = Math.random().toString(36).substring(2, 9)
      const agentId = `${projectName}-${hash}`
      const branchSuffix = shortName
        ? this.sanitizeBranchName(shortName)
        : `super-${hash}`
      const branch = `feature/${agentId}/${branchSuffix}`

      // Calculate worktree path
      const worktreePath = join(dirname(projectPath), agentId)

      // Create AgentInfo for the super minion
      // Note: No parentAgentId set — spawned super minions are top-level agents.
      // Lineage is tracked via spawnSource instead (unlike handoff which uses parentAgentId for sidebar nesting).
      const now = new Date().toISOString()
      const agentInfo = {
        id: `${agentId}-${Date.now()}`,
        agentId,
        branch,
        project: projectName,
        feature: plan.substring(0, 100),
        status: 'active',
        tool: 'claude',
        mode: 'planning',
        yolo: sourceYolo,
        chrome: true,
        prompt: plan,
        workflowId,
        spawnSource: {
          parentAgentId: sourceAgentId,
          spawnTimestamp: now,
          workflowId,
          batchId,
        } as SpawnSource,
        isSuperMinion: true,
        createdAt: now,
        lastActivity: now,
      } as AgentInfo & { isSuperMinion: true; workflowId: string }

      // Acquire mutex for worktree creation (serialize git operations)
      const release = await this.worktreeMutex.acquire()
      try {
        // Run setup.sh to create the agent worktree (always fresh from main/master)
        const setupScript = join(this.getMinionsPath(), 'bin', 'setup.sh')
        const configPath = this.getProjectConfigPath(projectPath)

        // For spawn, always branch from base (fresh mode)
        const setupArgs = [agentInfo.agentId, agentInfo.branch, baseBranch, '--config', configPath]

        log.info('Spawning super minion', {
          batchId,
          agentId,
          workflowId,
          branchSuffix,
          baseBranch
        })

        const { stdout, stderr } = await execFileAsync(
          setupScript,
          setupArgs,
          { cwd: projectPath }
        )
        log.debug('Setup script output:', stdout)
        if (stderr) log.warn('Setup script errors:', stderr)

        // Write agent info to .agent-info file in the worktree
        this.writeAgentInfo(worktreePath, agentInfo)

        // Commit any setup files to prevent git dirty state
        await this.commitSetupFiles(worktreePath)
      } finally {
        release()
      }

      log.info(`Super minion spawned: ${agentInfo.agentId}`, {
        batchId,
        workflowId
      })

      return {
        success: true,
        agentId: agentInfo.agentId,
        workflowId: workflowId
      }
    } catch (error: any) {
      log.error('Spawn super minion failed', {
        error: error.message,
        sourceAgentId,
        batchId
      })
      return {
        success: false,
        error: `Failed to spawn super minion: ${error.message}`
      }
    }
  }

  async updateAssignment(projectPath: string, assignmentId: string, updates: Partial<AgentInfo>): Promise<void> {
    // Find the worktree for this assignment
    const { assignments } = await this.getAssignments(projectPath)
    const assignment = assignments.find(a => a.id === assignmentId)

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    // Calculate worktree path
    const worktreePath = this.projectConfigHelper.getWorktreePath(projectPath, assignment.agentId)

    // Update the .agent-info file
    this.updateAgentInfo(worktreePath, updates, assignment.agentId, projectPath)
  }

  async getSuperAgentDetails(projectPath: string, agentId: string): Promise<SuperAgentInfo> {
    // 1. Get all agents to find the super agent and its children
    const agents = await this.listAgents(projectPath)
    const session = agents.find(a => a.id === agentId)

    if (!session) {
      throw new Error('Super agent not found')
    }

    // 2. Read full agent info for the super agent
    const agentInfo = this.readAgentInfo(session.worktreePath)
    if (!agentInfo) {
      throw new Error('Failed to read super agent info')
    }

    if (!(agentInfo as any).isSuperMinion) {
      throw new Error('Agent is not a super minion')
    }

    // 3. Find and read full info for all children
    const childSessions = agents.filter(a => a.parentAgentId === agentId)
    const children: AgentInfo[] = []

    for (const childSession of childSessions) {
      const childInfo = this.readAgentInfo(childSession.worktreePath)
      if (childInfo) {
        children.push(childInfo)
      }
    }

    // 4. Read pending plans from .pending-plans.json
    let pendingPlans: ChildPlan[] = []

    const plansPath = join(session.worktreePath, '.pending-plans.json')
    if (existsSync(plansPath)) {
      try {
        const content = readFileSync(plansPath, 'utf-8')
        const data = JSON.parse(content)
        if (data.plans && Array.isArray(data.plans)) {
          // Only show pending plans to the user
          pendingPlans = data.plans.filter((p: ChildPlan) => p.status === 'pending')
        }
      } catch (error) {
        log.error('Error reading .pending-plans.json', error)
      }
    }

    // 5. Auto-transition from planning to dev mode when plans are ready
    // This is more robust than relying on signals - it's based on actual file state
    if (pendingPlans.length > 0 && agentInfo.mode === 'planning') {
      agentInfo.mode = 'dev'
      this.updateAgentInfo(session.worktreePath, { mode: 'dev' }, agentId, projectPath)
    }

    // 6. Get task invocations from JSONL if we have a session and service
    let taskInvocations: TaskInvocation[] = []
    if (agentInfo.claudeSessionId && this.claudeSessionInfoService) {
      const sessionInfo = await this.claudeSessionInfoService.parseSessionInfo(
        agentInfo.claudeSessionId,
        session.worktreePath
      )
      if (sessionInfo) {
        taskInvocations = sessionInfo.taskInvocations
      }
    }

    return {
      ...agentInfo,
      isSuperMinion: true,
      children,
      pendingPlans,
      taskInvocations
    } as SuperAgentInfo
  }

  async approvePlan(projectPath: string, superAgentId: string, planId: string): Promise<AgentInfo> {
    // 1. Get super agent details to find worktree path
    const agents = await this.listAgents(projectPath)
    const session = agents.find(a => a.id === superAgentId)

    if (!session) {
      throw new Error('Super agent not found')
    }

    const agentInfo = this.readAgentInfo(session.worktreePath)
    if (!agentInfo || !(agentInfo as any).isSuperMinion) {
      throw new Error('Agent is not a super minion')
    }

    // 2. Read .pending-plans.json
    const plansPath = join(session.worktreePath, '.pending-plans.json')
    if (!existsSync(plansPath)) {
      throw new Error('No pending plans file found')
    }

    let plansData: { plans: ChildPlan[] }
    try {
      const content = readFileSync(plansPath, 'utf-8')
      plansData = JSON.parse(content)
    } catch (error) {
      throw new Error('Failed to read pending plans file')
    }

    // 3. Find the plan
    const plan = plansData.plans.find(p => p.id === planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    if (plan.status !== 'pending') {
      throw new Error('Plan is not in pending status')
    }

    // 4. Create child agent
    const childAssignment = {
      branch: plan.shortName,
      feature: plan.description,
      prompt: plan.prompt,
      tool: agentInfo.tool,
      model: agentInfo.model,
      mode: 'dev' as const
    }

    const childAgent = await this.createAssignment(projectPath, childAssignment)

    // 4.5. Set childAgentId on the plan
    plan.childAgentId = childAgent.agentId

    // 5. Update child's .agent-info to set parentAgentId
    const childWorktreePath = this.projectConfigHelper.getWorktreePath(projectPath, childAgent.agentId)

    this.updateAgentInfo(childWorktreePath, {
      parentAgentId: superAgentId
    }, childAgent.agentId, projectPath)

    // 6. Mark plan as approved in .pending-plans.json
    plan.status = 'approved'
    writeFileSync(plansPath, JSON.stringify(plansData, null, 2))

    // 7. Update .children-status.json
    const statusPath = join(session.worktreePath, '.children-status.json')
    let statusData: { children: any[] } = { children: [] }

    if (existsSync(statusPath)) {
      try {
        const content = readFileSync(statusPath, 'utf-8')
        statusData = JSON.parse(content)
      } catch (error) {
        // If parse fails, start fresh
      }
    }

    // Add new child to status
    statusData.children.push({
      agentId: childAgent.agentId,
      status: childAgent.status,
      lastSignal: null
    })

    writeFileSync(statusPath, JSON.stringify(statusData, null, 2))

    return childAgent
  }

  async createSuperAssignment(projectPath: string, assignment: any): Promise<AgentInfo> {
    // Create the base assignment
    const result = await this.createAssignment(projectPath, {
      ...assignment,
      mode: 'planning'
    })

    // Calculate worktree path to update .agent-info with super minion metadata
    const worktreePath = this.projectConfigHelper.getWorktreePath(projectPath, result.agentId)

    // Update .agent-info with super minion fields
    const workflowId = assignment.workflow?.id
    this.updateAgentInfo(worktreePath, {
      isSuperMinion: true,
      children: [],
      pendingPlans: [],
      workflowId
    } as any, result.agentId, projectPath)

    // Log workflow selection
    if (assignment.workflow) {
      log.debug(`Super minion ${result.agentId} using workflow: ${assignment.workflow.name} (${workflowId})`)
    }

    // Return the updated info
    return {
      ...result,
      isSuperMinion: true,
      children: [],
      pendingPlans: []
    } as any
  }

  async openInEditor(projectPath: string, agentId: string, editor: 'cursor' | 'vscode' | 'zed' = 'cursor'): Promise<void> {
    const agents = await this.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)

    if (!agent) {
      throw new Error('Agent not found')
    }

    // Map editor types to CLI commands
    const editorCommands: Record<string, string> = {
      cursor: 'cursor',
      vscode: 'code',
      zed: 'zed'
    }
    const command = editorCommands[editor] || 'cursor'

    // Open in selected editor
    execFile(command, [agent.worktreePath], (error) => {
      if (error) {
        log.error(`Error opening ${editor}`, error)
        throw new Error(`Failed to open ${editor}. Make sure the '${command}' command is installed and available in your PATH.`)
      }
    })
  }

  clearUnread(agentId: string): void {
    const session = this.sessions.get(agentId)
    if (session) {
      session.hasUnread = false
    }
  }

  setUnread(agentId: string): void {
    const session = this.sessions.get(agentId)
    if (session) {
      session.hasUnread = true
      session.lastActivity = new Date().toISOString()
    }
  }

  async getAssignments(projectPath: string): Promise<{ assignments: AgentInfo[] }> {
    const assignments: AgentInfo[] = []

    try {
      // Add base branch agent if it exists
      const baseInfoPath = join(projectPath, '.minions-base-info')
      if (existsSync(baseInfoPath)) {
        try {
          const content = readFileSync(baseInfoPath, 'utf-8')
          const baseAgentInfo = JSON.parse(content) as AgentInfo
          if (baseAgentInfo.isBaseBranchAgent) {
            assignments.push(baseAgentInfo)
          }
        } catch (error) {
          log.error('Error reading base agent info', error)
        }
      }

      // Get worktrees from git
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectPath })

      const config = this.getProjectConfig(projectPath)
      const projectName = config.project?.name || projectPath.split('/').pop() || 'project'
      const worktrees = this.parseWorktrees(stdout, projectName)

      for (const worktree of worktrees) {
        // Read agent info from .agent-info file
        const agentInfo = this.readAgentInfo(worktree.path)
        if (agentInfo) {
          assignments.push(agentInfo)
        }
      }
    } catch (error) {
      log.error('Error getting assignments', error)
    }

    return { assignments }
  }

  async teardownAgent(projectPath: string, agentId: string, force: boolean = false): Promise<void> {
    const teardownScript = join(this.getMinionsPath(), 'bin', 'teardown.sh')
    const configPath = this.getProjectConfigPath(projectPath)

    // Archive agent metadata before teardown (fail gracefully)
    try {
      await this.archiveAgent(projectPath, agentId)
    } catch (archiveError) {
      log.warn(`Failed to archive agent ${agentId}:`, archiveError)
    }

    try {
      const args = [agentId, '--config', configPath]
      if (force) args.push('--force')
      const { stdout, stderr } = await execFileAsync(
        teardownScript,
        args,
        { cwd: projectPath }
      )
      log.debug('Teardown script output:', stdout)
      if (stderr) log.warn('Teardown script errors:', stderr)

      // Remove from sessions and project lookup cache
      this.sessions.delete(agentId)
      this.projectLookupCache.delete(agentId)

      // No need to update config.json - the .agent-info file is removed with the worktree atomically
    } catch (error: any) {
      log.error('Failed to run teardown.sh', error)

      // Check if error is due to uncommitted changes
      if (error.stdout && error.stdout.includes('uncommitted changes')) {
        throw new Error('Agent has uncommitted changes. Use force teardown to proceed anyway.')
      }

      throw new Error(`Failed to teardown agent: ${error.message}`)
    }
  }

  async unassignAgent(projectPath: string, agentId: string): Promise<void> {
    // Update the .agent-info to mark as unassigned
    const worktreePath = this.projectConfigHelper.getWorktreePath(projectPath, agentId)

    // Update status to idle/cancelled
    this.updateAgentInfo(worktreePath, { status: 'cancelled', mode: 'idle' }, agentId, projectPath)

    // Update session to clear assignment
    const session = this.sessions.get(agentId)
    if (session) {
      session.assignmentId = null
      session.mode = 'idle'
    }
  }

  async saveUIState(projectPath: string, agentId: string, uiState: UIState): Promise<void> {
    const agents = await this.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)

    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    // Verify the agent info file exists before attempting update
    const agentInfoPath = join(agent.worktreePath, '.agent-info')
    const baseInfoPath = join(agent.worktreePath, '.minions-base-info')

    if (!existsSync(agentInfoPath) && !existsSync(baseInfoPath)) {
      log.warn(
        `Agent ${agentId} found in worktree list but .agent-info file missing at ${agent.worktreePath}. ` +
        'Skipping UI state save - agent may have been deleted.'
      )
      // Gracefully skip the file update, but still update in-memory session
      const session = this.sessions.get(agentId)
      if (session) {
        session.uiState = uiState
      }
      return
    }

    // Update the .agent-info file with UI state
    this.updateAgentInfo(agent.worktreePath, { uiState }, agentId, projectPath)

    // Also update the in-memory session
    const session = this.sessions.get(agentId)
    if (session) {
      session.uiState = uiState
    }
  }

  // --- Delegated to WorktreeService ---

  private async getDefaultBranch(projectPath: string, worktreePath: string): Promise<string> {
    return this.worktreeService.getDefaultBranch(projectPath, worktreePath)
  }

  // getRemote is available via this.worktreeService.getRemote()

  // --- Delegated to PRTrackingService ---

  async createPullRequest(projectPath: string, assignmentId: string, autoCommit: boolean = false): Promise<{ url: string }> {
    return this.prTrackingService.createPullRequest(projectPath, assignmentId, autoCommit)
  }

  async detectExistingPullRequest(
    projectPath: string,
    assignmentId: string,
    _options?: { force?: boolean }
  ): Promise<{
    found: boolean
    prUrl?: string
    prStatus?: string
    createdAt?: string
  } | null> {
    return this.prTrackingService.detectExistingPullRequest(projectPath, assignmentId, _options)
  }

  // --- Delegated to AgentMigrationService ---

  async migrateAssignments(projectPath: string): Promise<void> {
    return this.agentMigrationService.migrateAssignments(projectPath)
  }

  // --- Delegated to PRTrackingService ---

  async checkPullRequestStatus(
    projectPath: string,
    assignmentId: string,
    options?: { silent?: boolean }
  ): Promise<{ status: string; mergedAt?: string; createdAt?: string; error?: string }> {
    return this.prTrackingService.checkPullRequestStatus(projectPath, assignmentId, options)
  }

  // --- Base branch agent methods (stay in AgentService) ---

  async ensureBaseBranchAgent(projectPath: string): Promise<AgentInfo> {
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'
    const baseBranch = await this.getDefaultBranch(projectPath, projectPath)
    const baseAgentId = `${projectName}-base`

    const baseInfoPath = join(projectPath, '.minions-base-info')

    // Check if base agent already exists
    if (existsSync(baseInfoPath)) {
      try {
        const content = readFileSync(baseInfoPath, 'utf-8')
        const info = JSON.parse(content) as AgentInfo
        if (info.isBaseBranchAgent && info.agentId === baseAgentId) {
          log.debug(`Base agent already exists: ${baseAgentId}`)
          return info
        }
      } catch (error) {
        log.warn(`Corrupted base agent info, recreating: ${error}`)
      }
    }

    // Create new base agent info
    const agentInfo: AgentInfo = {
      id: `${baseAgentId}-${Date.now()}`,
      agentId: baseAgentId,
      branch: baseBranch,
      project: projectName,
      feature: `Base Branch (${baseBranch})`,
      status: 'active',
      tool: 'claude',
      mode: 'dev',
      prompt: `You are helping maintain the ${baseBranch} branch of ${projectName}. Keep the main branch healthy, review code, run tests, and help with any issues on the base branch. Use your best judgment to help maintain code quality and fix any issues that arise.`,
      model: 'opus',
      chrome: true,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      isBaseBranchAgent: true
    }

    writeFileSync(baseInfoPath, JSON.stringify(agentInfo, null, 2))
    log.info(`Created base branch agent: ${baseAgentId}`)

    return agentInfo
  }

  isBaseBranchAgentMissing(projectPath: string): boolean {
    const baseInfoPath = join(projectPath, '.minions-base-info')
    if (!existsSync(baseInfoPath)) {
      return true
    }

    try {
      const content = readFileSync(baseInfoPath, 'utf-8')
      const info = JSON.parse(content) as AgentInfo
      return !info.isBaseBranchAgent
    } catch {
      return true
    }
  }

  // --- Delegated to ProjectConfigHelper ---

  getAgentPath(projectPath: string, agentInfo: AgentInfo): string {
    return this.projectConfigHelper.getAgentPath(projectPath, agentInfo)
  }

  // Helper method to track if base agent was just created (for auto-start logic)
  private baseAgentJustCreated: Set<string> = new Set()

  wasBaseAgentJustCreated(agentId: string): boolean {
    const wasJustCreated = this.baseAgentJustCreated.has(agentId)
    this.baseAgentJustCreated.delete(agentId)
    return wasJustCreated
  }

  async ensureBaseBranchAgentWithStartup(projectPath: string): Promise<{ agentInfo: AgentInfo, shouldStartClaude: boolean }> {
    const baseInfoPath = join(projectPath, '.minions-base-info')
    const isNewAgent = !existsSync(baseInfoPath)

    const agentInfo = await this.ensureBaseBranchAgent(projectPath)

    if (isNewAgent) {
      this.baseAgentJustCreated.add(agentInfo.agentId)
    }

    return {
      agentInfo,
      shouldStartClaude: isNewAgent && agentInfo.prompt !== undefined
    }
  }

  // --- Delegated to AgentArchiveService ---

  async archiveAgent(projectPath: string, agentId: string): Promise<ArchivedAgent> {
    return this.agentArchiveService.archiveAgent(projectPath, agentId)
  }

  async listArchivedAgents(projectPath: string): Promise<ArchivedAgent[]> {
    return this.agentArchiveService.listArchivedAgents(projectPath)
  }

  async getArchivedAgent(projectPath: string, archiveId: string): Promise<ArchivedAgent | null> {
    return this.agentArchiveService.getArchivedAgent(projectPath, archiveId)
  }

  async restoreArchivedAgent(projectPath: string, archiveId: string): Promise<AgentInfo> {
    return this.agentArchiveService.restoreArchivedAgent(projectPath, archiveId)
  }
}
