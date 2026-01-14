import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs'
import { app } from 'electron'
import { homedir } from 'os'
import { ProjectConfig, Assignment, AgentInfo, SuperAgentInfo, ChildPlan, UIState, ArchivedAgent } from './types/ProjectConfig'
import { ClaudeSessionInfoService, TaskInvocation } from './ClaudeSessionInfoService'
import { WorkflowService } from './WorkflowService'
import type { ProjectWorkflowConfig } from './types/WorkflowTypes'
import { createLogger } from './logger'

const log = createLogger('AgentService')
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

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
  private workflowService?: WorkflowService
  private prDetectionCache: Map<string, {
    timestamp: number
    found: boolean
    prUrl?: string
    prStatus?: string
  }> = new Map()

  private readonly PR_DETECTION_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  constructor() {
    this.sessions = new Map()
  }

  setClaudeSessionInfoService(service: ClaudeSessionInfoService): void {
    this.claudeSessionInfoService = service
  }

  setWorkflowService(service: WorkflowService): void {
    this.workflowService = service
  }

  /**
   * Validate a teleported session to ensure it can be resumed.
   * Checks if JSONL file exists, is not corrupted, and is resumable.
   */
  async validateTeleportSession(agentInfo: AgentInfo): Promise<{
    isValid: boolean
    reason?: string
    canResume: boolean
  }> {
    // Check if this is a teleported session
    if (!agentInfo.cloudSessionId && !agentInfo.isTeleportedSession) {
      return {
        isValid: false,
        reason: 'Not a teleported session (missing cloudSessionId)',
        canResume: false
      }
    }

    // If cloudSessionId is missing but marked as teleported, it's invalid
    if (!agentInfo.cloudSessionId) {
      return {
        isValid: false,
        reason: 'Teleported session missing cloudSessionId',
        canResume: false
      }
    }

    // Check if JSONL file exists
    const jsonlPath = join(homedir(), '.claude', 'projects', agentInfo.cloudSessionId, 'session.jsonl')

    if (!existsSync(jsonlPath)) {
      return {
        isValid: false,
        reason: 'JSONL file not found at expected path',
        canResume: false
      }
    }

    // Check if file is stale (older than 7 days)
    try {
      const stats = statSync(jsonlPath)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
      if (stats.mtimeMs < sevenDaysAgo) {
        return {
          isValid: false,
          reason: 'JSONL file is stale (older than 7 days)',
          canResume: false
        }
      }
    } catch (error) {
      return {
        isValid: false,
        reason: 'Failed to read JSONL file stats',
        canResume: false
      }
    }

    // Check if JSONL file is valid (can parse first line)
    try {
      const content = readFileSync(jsonlPath, 'utf-8')

      if (!content.trim()) {
        return {
          isValid: false,
          reason: 'JSONL file is empty',
          canResume: false
        }
      }

      // Try to parse first line
      const firstLine = content.split('\n')[0]
      JSON.parse(firstLine)
    } catch (error) {
      return {
        isValid: false,
        reason: 'JSONL file is corrupted (invalid JSON)',
        canResume: false
      }
    }

    // Check if session state is resumable
    if (agentInfo.status === 'completed' || agentInfo.status === 'closed') {
      return {
        isValid: true,
        reason: 'Session is completed or closed',
        canResume: false
      }
    }

    // All checks passed
    return {
      isValid: true,
      canResume: true
    }
  }

  async checkDependencies(): Promise<{ ghInstalled: boolean; ghAuthenticated: boolean; error?: string }> {
    try {
      // Check if gh CLI is installed
      await execAsync('gh --version')
      
      // Check if authenticated
      try {
        await execAsync('gh auth status')
        return { ghInstalled: true, ghAuthenticated: true }
      } catch (authError) {
        return { 
          ghInstalled: true, 
          ghAuthenticated: false,
          error: 'GitHub CLI not authenticated. Run: gh auth login'
        }
      }
    } catch (error) {
      return { 
        ghInstalled: false, 
        ghAuthenticated: false,
        error: 'GitHub CLI not installed. Install with: brew install gh'
      }
    }
  }

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

  parseWorktrees(output: string, projectName: string): Array<{ path: string; branch: string }> {
    const worktrees: Array<{ path: string; branch: string }> = []
    const lines = output.split('\n')
    
    let currentWorktree: any = {}
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const path = line.substring('worktree '.length)
        // Include worktrees that start with project name
        // Supports legacy 'project-agent-N' and new 'project-N'
        // We filter by .agent-info existence later
        const dirName = path.split('/').pop()
        if (dirName && dirName.startsWith(`${projectName}-`)) {
          currentWorktree.path = path
        }
      } else if (line.startsWith('branch ')) {
        const branch = line.substring('branch '.length).replace('refs/heads/', '')
        currentWorktree.branch = branch
      } else if (line === '' && currentWorktree.path) {
        worktrees.push(currentWorktree)
        currentWorktree = {}
      }
    }
    
    if (currentWorktree.path) {
      worktrees.push(currentWorktree)
    }

    return worktrees
  }

  parseAgentInfo(filePath: string): Record<string, string> {
    const content = readFileSync(filePath, 'utf-8')
    const info: Record<string, string> = {}

    for (const line of content.split('\n')) {
      const [key, value] = line.split('=')
      if (key && value) {
        info[key.trim()] = value.trim()
      }
    }

    return info
  }

  // New helper functions for JSON .agent-info format
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

  updateAgentInfo(worktreePath: string, updates: Partial<AgentInfo>): void {
    const current = this.readAgentInfo(worktreePath)
    if (!current) {
      throw new Error(`Agent info not found at worktree path: ${worktreePath}`)
    }

    const updated = { ...current, ...updates, lastActivity: new Date().toISOString() }
    this.writeAgentInfo(worktreePath, updated)
  }

  /**
   * Mark an agent session as failed with a specific reason.
   * Sets failureReason and marks session as inactive.
   */
  async markAgentAsFailed(worktreePath: string, reason: string): Promise<void> {
    this.updateAgentInfo(worktreePath, {
      failureReason: reason,
      claudeSessionActive: false
    })
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
    })
  }

  async findProjectForAgent(activeProjectPaths: string[], agentId: string): Promise<string> {
    for (const projectPath of activeProjectPaths) {
      const agents = await this.listAgents(projectPath)
      if (agents.some(a => a.id === agentId)) {
        return projectPath
      }
    }
    throw new Error(`Agent ${agentId} not found in any active project`)
  }

  async findProjectForAssignment(activeProjectPaths: string[], assignmentId: string): Promise<string> {
    for (const projectPath of activeProjectPaths) {
      const { assignments } = await this.getAssignments(projectPath)
      if (assignments.some(a => a.id === assignmentId)) {
        return projectPath
      }
    }
    throw new Error(`Assignment ${assignmentId} not found in any active project`)
  }

  private getMinionsPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'minions')
      : join(app.getAppPath(), 'resources', 'minions')
  }

  getSuperMinionRulesPath(): string {
    const minionsPath = this.getMinionsPath()
    return join(minionsPath, 'rules', 'super-minion-rules.md')
  }

  private getProjectConfigPath(projectPath: string): string {
    // New format first: minions.json at project root
    const newConfigPath = join(projectPath, 'minions.json')
    if (existsSync(newConfigPath)) {
      return newConfigPath
    }

    // Legacy fallback: minions/config.json
    return join(projectPath, 'minions', 'config.json')
  }

  /**
   * Check if this project uses the new minions.json format.
   * @param projectPath - Path to the project root
   * @returns true if minions.json exists at project root
   */
  isNewFormatProject(projectPath: string): boolean {
    return existsSync(join(projectPath, 'minions.json'))
  }

  /**
   * Get the project name from config, falling back to directory name.
   * This must be used consistently for worktree path computation.
   */
  getProjectName(projectPath: string): string {
    const config = this.getProjectConfig(projectPath)
    return config.project?.name || projectPath.split('/').pop() || 'project'
  }

  private getProjectConfig(projectPath: string): ProjectConfig {
    const configPath = this.getProjectConfigPath(projectPath)
    if (!existsSync(configPath)) {
      return {
        project: { name: 'unknown', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }
    }
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (e) {
      log.error('Error parsing config.json', e)
      return {
        project: { name: 'unknown', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }
    }
  }

  private saveProjectConfig(projectPath: string, config: ProjectConfig): void {
    const configPath = this.getProjectConfigPath(projectPath)
    writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  async createAssignment(projectPath: string, assignment: Partial<Assignment>): Promise<AgentInfo> {
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project.name || projectPath.split('/').pop() || 'project'

    // Auto-generate agent ID if not provided
    let agentId = assignment.agentId
    if (!agentId) {
      const hash = Math.random().toString(36).substring(2, 9)
      agentId = `${projectName}-${hash}`
    }

    // Auto-generate branch name if not provided
    let branch = assignment.branch!
    if (!branch.startsWith('feature/')) {
      branch = `feature/${agentId}/${branch}`
    }

    // Calculate worktree path
    let worktreePath: string
    if (agentId.startsWith(`${projectName}-`)) {
      worktreePath = join(dirname(projectPath), agentId)
    } else {
      worktreePath = join(dirname(projectPath), `${projectName}-${agentId}`)
    }

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

  /**
   * Commit any uncommitted setup files in the worktree.
   * This is called after setup.sh runs to ensure the worktree is clean.
   * Files like minions/rules/*, .cursor/rules/*, and .agent-info are committed.
   */
  private async commitSetupFiles(worktreePath: string): Promise<void> {
    try {
      // Check if there are any uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: worktreePath })
      if (!statusOutput.trim()) {
        log.info('No uncommitted setup files to commit')
        return
      }

      log.info('Committing setup files in:', worktreePath)
      log.info('Changed files:', statusOutput.trim())

      // Add all changes (setup files, .agent-info, etc.)
      await execAsync('git add -A', { cwd: worktreePath })

      // Commit with a setup message
      try {
        await execFileAsync('git', ['commit', '-m', 'Worktree setup files'], { cwd: worktreePath })
        log.info('Setup files committed successfully')
      } catch (commitError: any) {
        // Handle git identity not configured
        if (commitError.message.includes('identity unknown') || commitError.stderr?.includes('identity unknown')) {
          log.info('Git identity unknown, setting default...')
          await execFileAsync('git', ['config', 'user.email', 'minion@local'], { cwd: worktreePath })
          await execFileAsync('git', ['config', 'user.name', 'Minion Setup'], { cwd: worktreePath })
          await execFileAsync('git', ['commit', '-m', 'Worktree setup files'], { cwd: worktreePath })
          log.info('Setup files committed with default identity')
        } else if (commitError.message.includes('nothing to commit')) {
          log.info('Nothing to commit after staging')
        } else {
          // Log but don't throw - setup file commit is best-effort
          log.warn('Failed to commit setup files:', commitError.message)
        }
      }
    } catch (error: any) {
      // Log but don't throw - setup file commit is best-effort
      log.warn('Error during setup file commit:', error.message)
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
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project.name || projectPath.split('/').pop() || 'project'

    let worktreePath: string
    if (assignment.agentId.startsWith(`${projectName}-`)) {
      worktreePath = join(dirname(projectPath), assignment.agentId)
    } else {
      worktreePath = join(dirname(projectPath), `${projectName}-${assignment.agentId}`)
    }

    // Update the .agent-info file
    this.updateAgentInfo(worktreePath, updates)
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
      this.updateAgentInfo(session.worktreePath, { mode: 'dev' })
    }

    // 6. Get task invocations from JSONL if we have a session and service
    let taskInvocations: TaskInvocation[] = []
    if (agentInfo.claudeSessionId && this.claudeSessionInfoService) {
      const sessionInfo = this.claudeSessionInfoService.parseSessionInfo(
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
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'
    
    let childWorktreePath: string
    if (childAgent.agentId.startsWith(`${projectName}-`)) {
      childWorktreePath = join(dirname(projectPath), childAgent.agentId)
    } else {
      childWorktreePath = join(dirname(projectPath), `${projectName}-${childAgent.agentId}`)
    }

    this.updateAgentInfo(childWorktreePath, {
      parentAgentId: superAgentId
    })

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
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'
    
    let worktreePath: string
    if (result.agentId.startsWith(`${projectName}-`)) {
      worktreePath = join(dirname(projectPath), result.agentId)
    } else {
      worktreePath = join(dirname(projectPath), `${projectName}-${result.agentId}`)
    }
    
    // Update .agent-info with super minion fields
    this.updateAgentInfo(worktreePath, {
      isSuperMinion: true,
      children: [],
      pendingPlans: []
    } as any)

    // Save the workflow configuration if provided
    if (assignment.workflow && this.workflowService) {
      try {
        const projectWorkflowConfig: ProjectWorkflowConfig = {
          activeWorkflowId: assignment.workflow.id,
          customWorkflows: [assignment.workflow]
        }
        this.workflowService.saveProjectWorkflow(projectPath, projectWorkflowConfig)
        log.debug(`Saved workflow ${assignment.workflow.id} for super minion ${result.agentId}`)
      } catch (error) {
        log.error('Failed to save workflow for super minion', error)
      }
    }

    // Return the updated info
    return {
      ...result,
      isSuperMinion: true,
      children: [],
      pendingPlans: []
    } as any
  }

  async openInCursor(projectPath: string, agentId: string): Promise<void> {
    const agents = await this.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)
    
    if (!agent) {
      throw new Error('Agent not found')
    }

    // Open in Cursor
    execFile('cursor', [agent.worktreePath], (error) => {
      if (error) {
        log.error('Error opening Cursor', error)
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

      // Remove from sessions
      this.sessions.delete(agentId)

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
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project.name || projectPath.split('/').pop() || 'project'

    let worktreePath: string
    if (agentId.startsWith(`${projectName}-`)) {
      worktreePath = join(dirname(projectPath), agentId)
    } else {
      worktreePath = join(dirname(projectPath), `${projectName}-${agentId}`)
    }

    // Update status to idle/cancelled
    this.updateAgentInfo(worktreePath, { status: 'cancelled', mode: 'idle' })

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
    this.updateAgentInfo(agent.worktreePath, { uiState })

    // Also update the in-memory session
    const session = this.sessions.get(agentId)
    if (session) {
      session.uiState = uiState
    }
  }
  private async getDefaultBranch(projectPath: string, worktreePath: string): Promise<string> {
    // 1. Try to get from project config first
    const config = this.getProjectConfig(projectPath)
    if (config.project?.defaultBaseBranch) {
      log.debug(`Using default branch from config: ${config.project.defaultBaseBranch}`)
      return config.project.defaultBaseBranch
    }

    try {
      // 2. Try to get default branch from gh CLI
      const { stdout } = await execAsync('gh repo view --json defaultBranchRef --jq .defaultBranchRef.name', { cwd: worktreePath })
      if (stdout.trim()) {
        return stdout.trim()
      }
    } catch (error) {
      log.info('Could not get default branch from gh, trying git...')
    }

    try {
      // 3. Fallback: check if 'main' or 'master' exists locally
      const { stdout: branches } = await execAsync('git branch -a', { cwd: worktreePath })
      if (branches.includes('remotes/origin/main') || branches.includes(' main\n')) {
        return 'main'
      }
    } catch (error) {
      // Ignore
    }
    
    return 'master'
  }

  private async getRemote(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git remote', { cwd: worktreePath })
      const remotes = stdout.trim().split('\n').filter(r => r.trim())
      if (remotes.includes('origin')) return 'origin'
      if (remotes.length > 0) return remotes[0]
    } catch (error) {
      // Ignore
    }
    return 'origin'
  }

  async createPullRequest(projectPath: string, assignmentId: string, autoCommit: boolean = false): Promise<{ url: string }> {
    const { assignments } = await this.getAssignments(projectPath)
    const assignment = assignments.find(a => a.id === assignmentId)

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    // Allow PR creation from in_progress, review, or completed states
    if (['pending', 'blocked', 'closed'].includes(assignment.status)) {
      throw new Error(`Cannot create PR for assignment in '${assignment.status}' status`)
    }

    // Calculate worktree path
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

    let worktreePath: string
    if (assignment.agentId.startsWith(`${projectName}-`)) {
      worktreePath = join(dirname(projectPath), assignment.agentId)
    } else {
      worktreePath = join(dirname(projectPath), `${projectName}-${assignment.agentId}`)
    }

    if (!existsSync(worktreePath)) {
      throw new Error('Agent worktree not found')
    }

    try {
      // Check for uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: worktreePath })
      if (statusOutput.trim()) {
        if (autoCommit) {
          // Auto-commit changes
          log.info('Auto-committing changes...')
          await execAsync('git add -A', { cwd: worktreePath })
          const commitMessage = `Complete: ${assignment.feature}`
          
          try {
            await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath })
            log.info('Changes committed')
          } catch (commitError: any) {
            // If identity is unknown, try to set a default one
            if (commitError.message.includes('identity unknown')) {
              log.info('Git identity unknown, setting default...')
              await execFileAsync('git', ['config', 'user.email', 'agent@minions.ai'], { cwd: worktreePath })
              await execFileAsync('git', ['config', 'user.name', 'Minion Agent'], { cwd: worktreePath })
              await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath })
              log.info('Changes committed with default identity')
            } else if (commitError.stderr && (commitError.stderr.includes('pre-commit') || commitError.stdout.includes('pre-commit') || commitError.message.includes('hook failed'))) {
              throw new Error(`Pre-commit hooks failed. Please fix the issues and try again.\n\n${commitError.stderr || commitError.stdout || commitError.message}`)
            } else if (commitError.message.includes('nothing to commit')) {
              log.info('Nothing to commit')
            } else {
              throw commitError
            }
          }
        } else {
          throw new Error('Branch has uncommitted changes. Please commit all changes before creating a PR.')
        }
      }

      // Get default branch and remote
      const baseBranch = await this.getDefaultBranch(projectPath, worktreePath)
      const remote = await this.getRemote(worktreePath)
      log.debug(`Using base branch: ${baseBranch}, remote: ${remote}`)

      // Check if there are commits on this branch
      try {
        const { stdout: commitCount } = await execFileAsync('git', ['rev-list', '--count', `${baseBranch}..${assignment.branch}`], { cwd: worktreePath })
        if (parseInt(commitCount.trim()) === 0) {
          throw new Error(`No commits on branch '${assignment.branch}' compared to '${baseBranch}'. Make sure changes are committed before creating a PR.`)
        }
      } catch (error: any) {
        if (error.message.includes('No commits')) {
          throw error
        }
        // If the command fails for other reasons, continue - branch might not have base branch locally
      }

      // Push the branch to remote
      log.debug(`Pushing branch to ${remote}...`)
      try {
        await execFileAsync('git', ['push', '-u', remote, assignment.branch], { cwd: worktreePath })
      } catch (pushError: any) {
        // If it's already up to date, that's fine
        if (pushError.stderr && (pushError.stderr.includes('Everything up-to-date') || pushError.stdout.includes('Everything up-to-date'))) {
          log.info('Branch is already up to date')
        } else if (pushError.stderr && (pushError.stderr.includes('pre-push') || pushError.stdout.includes('pre-push') || pushError.message.includes('hook failed'))) {
          throw new Error(`Pre-push hooks failed. Please fix the issues and try again.\n\n${pushError.stderr || pushError.stdout || pushError.message}`)
        } else {
          log.error('Push error details', pushError)
          throw new Error(`Failed to push branch to ${remote}: ${pushError.message}`)
        }
      }

      // Use prompt for PR body, fallback to feature description
      const prBody = assignment.prompt || assignment.feature

      // Create PR title from feature
      const prTitle = assignment.feature.length > 72 
        ? assignment.feature.substring(0, 69) + '...'
        : assignment.feature

      // Try to create PR
      log.info('Creating PR...')
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', baseBranch, '--head', assignment.branch],
          { cwd: worktreePath }
        )
        
        // Extract PR URL from output
        const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/)
        const prUrl = urlMatch ? urlMatch[0] : stdout.trim()

        // Update .agent-info with PR URL and status
        this.updateAgentInfo(worktreePath, {
          prUrl: prUrl,
          prStatus: 'OPEN',
          status: 'pr_open'
        })

        // Clear detection cache for this assignment
        this.prDetectionCache.delete(`${projectPath}:${assignmentId}`)

        log.info('PR created:', prUrl)
        return { url: prUrl }
      } catch (prError: any) {
        // Check if PR already exists
        if (prError.message.includes('already exists')) {
          log.info('PR already exists, fetching URL...')
          const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'list', '--head', assignment.branch, '--json', 'url', '--jq', '.[0].url'],
            { cwd: worktreePath }
          )
          const prUrl = stdout.trim()

          // Update .agent-info
          this.updateAgentInfo(worktreePath, {
            prUrl: prUrl,
            prStatus: 'OPEN',
            status: 'pr_open'
          })

          // Clear detection cache for this assignment
          this.prDetectionCache.delete(`${projectPath}:${assignmentId}`)

          return { url: prUrl }
        }
        throw prError
      }
    } catch (error: any) {
      log.error('Failed to create PR:', error)
      throw new Error(`Failed to create pull request: ${error.message}`)
    }
  }

  async detectExistingPullRequest(
    projectPath: string,
    assignmentId: string,
    options?: { force?: boolean }
  ): Promise<{
    found: boolean
    prUrl?: string
    prStatus?: string
    createdAt?: string
  } | null> {
    try {
      // 1. Load assignment
      const { assignments } = await this.getAssignments(projectPath)
      const assignment = assignments.find(a => a.id === assignmentId)

      if (!assignment) {
        log.info('detectExistingPullRequest: Assignment not found')
        return null
      }

      // 2. If prUrl already exists, do a fresh status check to get latest state
      if (assignment.prUrl) {
        log.info('detectExistingPullRequest: PR already tracked, refreshing status:', assignment.prUrl)
        try {
          const statusResult = await this.checkPullRequestStatus(projectPath, assignmentId, { silent: true })
          // checkPullRequestStatus returns { status: 'ERROR' } on failure instead of throwing
          if (statusResult.status === 'ERROR') {
            log.warn('detectExistingPullRequest: Failed to refresh status:', statusResult.error)
            // Fall back to stored status
            return {
              found: true,
              prUrl: assignment.prUrl,
              prStatus: assignment.prStatus
            }
          }
          return {
            found: true,
            prUrl: assignment.prUrl,
            prStatus: statusResult.status,
            createdAt: statusResult.createdAt
          }
        } catch (error: any) {
          log.warn('detectExistingPullRequest: Failed to refresh status:', error.message)
          // Fall back to stored status
          return {
            found: true,
            prUrl: assignment.prUrl,
            prStatus: assignment.prStatus
          }
        }
      }

      // 3. Check cache
      const cacheKey = `${projectPath}:${assignmentId}`
      const cached = this.prDetectionCache.get(cacheKey)
      if (cached && !options?.force) {
        const isStillFresh = cached.timestamp + this.PR_DETECTION_CACHE_TTL_MS > Date.now()
        if (isStillFresh) {
          log.info('detectExistingPullRequest: Returning cached result')
          return {
            found: cached.found,
            prUrl: cached.prUrl,
            prStatus: cached.prStatus
          }
        }
      }

      // 4. Get worktree path
      const config = this.getProjectConfig(projectPath)
      const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

      let worktreePath: string
      if (assignment.agentId.startsWith(`${projectName}-`)) {
        worktreePath = join(dirname(projectPath), assignment.agentId)
      } else {
        worktreePath = join(dirname(projectPath), `${projectName}-${assignment.agentId}`)
      }

      // 5. Get remote
      const remote = await this.getRemote(worktreePath)
      if (!remote) {
        log.info('detectExistingPullRequest: No remote configured')
        return null
      }

      // 6. Get the actual current branch from git (more reliable than stored value)
      let currentBranch: string
      try {
        const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: worktreePath })
        currentBranch = branchOutput.trim()
        if (!currentBranch) {
          log.info('detectExistingPullRequest: Could not determine current branch')
          return null
        }
      } catch (error: any) {
        log.warn('detectExistingPullRequest: Error getting current branch:', error.message)
        return null
      }

      // 7. Check if branch exists on remote
      try {
        const { stdout: remoteRefs } = await execAsync(`git ls-remote --heads ${remote} ${currentBranch}`, { cwd: worktreePath })
        if (!remoteRefs.trim()) {
          log.info('detectExistingPullRequest: Branch not on remote:', currentBranch)
          // Branch not on remote, cache negative result
          this.prDetectionCache.set(cacheKey, { timestamp: Date.now(), found: false })
          return { found: false }
        }
      } catch (error: any) {
        log.warn('detectExistingPullRequest: Error checking remote refs:', error.message)
        return null
      }

      // 8. Run gh pr list to find existing PR
      let prData: { url: string; state: string; createdAt: string } | null = null
      try {
        const { stdout } = await execAsync(
          `gh pr list --head "${currentBranch}" --json number,url,state,createdAt --jq ".[0]"`,
          { cwd: projectPath }
        )

        // 9. Parse result
        if (stdout.trim() && stdout.trim() !== 'null') {
          prData = JSON.parse(stdout.trim())
        }
      } catch (error: any) {
        log.warn('detectExistingPullRequest: GitHub CLI error:', error.message)
        return null
      }

      if (!prData) {
        // No PR found
        log.info('detectExistingPullRequest: No existing PR found')
        this.prDetectionCache.set(cacheKey, { timestamp: Date.now(), found: false })
        return { found: false }
      }

      // 9. PR found, update .agent-info
      log.info('detectExistingPullRequest: Found existing PR:', prData.url)
      const agentInfoPath = join(worktreePath, '.agent-info')
      if (existsSync(agentInfoPath)) {
        const updates: Partial<AgentInfo> = {
          prUrl: prData.url,
          prStatus: prData.state // OPEN, MERGED, CLOSED
        }

        if (prData.state === 'OPEN') {
          updates.status = 'pr_open'
        } else if (prData.state === 'MERGED') {
          updates.status = 'merged'
        } else if (prData.state === 'CLOSED') {
          updates.status = 'closed'
        }

        this.updateAgentInfo(worktreePath, updates)
      }

      // 10. Cache positive result
      this.prDetectionCache.set(cacheKey, {
        timestamp: Date.now(),
        found: true,
        prUrl: prData.url,
        prStatus: prData.state
      })

      return {
        found: true,
        prUrl: prData.url,
        prStatus: prData.state,
        createdAt: prData.createdAt
      }
    } catch (error: any) {
      log.error('detectExistingPullRequest: Unexpected error:', error.message)
      // Don't cache errors
      return null
    }
  }

  async migrateAssignments(projectPath: string): Promise<void> {
    log.info('Starting assignment migration for:', projectPath)

    try {
      const config = this.getProjectConfig(projectPath)
      const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

      // Get all worktrees
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectPath })
      const worktrees = this.parseWorktrees(stdout, projectName)

      let migratedCount = 0

      for (const worktree of worktrees) {
        const agentInfoPath = join(worktree.path, '.agent-info')

        if (existsSync(agentInfoPath)) {
          const content = readFileSync(agentInfoPath, 'utf-8')

          // Check if it's already JSON format
          try {
            JSON.parse(content)
            continue // Already migrated
          } catch {
            // Old format - needs migration
            log.info('Migrating .agent-info for:', worktree.path)

            const oldInfo = this.parseAgentInfo(agentInfoPath)
            const agentId = oldInfo.AGENT_ID

            // Find matching assignment in config.json
            const assignment = config.assignments?.find(a => a.agentId === agentId)

            // Create new AgentInfo
            const newInfo: AgentInfo = {
              id: assignment?.id || `${agentId}-${Date.now()}`,
              agentId: agentId,
              branch: oldInfo.BRANCH || '',
              project: oldInfo.PROJECT || projectName,
              feature: assignment?.feature || '',
              status: (assignment?.status as any) || 'active',
              tool: assignment?.tool || 'claude',
              model: assignment?.model,
              mode: (assignment?.mode as any) || 'auto',
              prompt: (assignment as any)?.prompt,
              specFile: (assignment as any)?.specFile,
              prUrl: assignment?.prUrl,
              prStatus: assignment?.prStatus,
              createdAt: new Date().toISOString(),
              lastActivity: assignment?.lastActivity || new Date().toISOString(),
              hasUnread: assignment?.hasUnread
            }

            // Write new format
            this.writeAgentInfo(worktree.path, newInfo)
            migratedCount++
          }
        }
      }

      // Clear assignments from config.json after migration
      if (migratedCount > 0 && config.assignments && config.assignments.length > 0) {
        log.info(`Migrated ${migratedCount} agents, clearing config.json assignments`)
        config.assignments = []
        this.saveProjectConfig(projectPath, config)
      }

      log.info(`Migration complete: ${migratedCount} agents migrated`)
    } catch (error) {
      log.error('Migration failed:', error)
    }
  }

  async checkPullRequestStatus(
    projectPath: string,
    assignmentId: string,
    options?: { silent?: boolean }
  ): Promise<{ status: string; mergedAt?: string; createdAt?: string; error?: string }> {
    const { assignments } = await this.getAssignments(projectPath)
    const assignment = assignments.find(a => a.id === assignmentId)

    if (!assignment || !assignment.prUrl) {
      const error = 'Assignment or PR URL not found'
      if (!options?.silent) {
        log.error('', error)
      }
      return { status: 'ERROR', error }
    }

    // Calculate worktree path
    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

    let worktreePath: string
    if (assignment.agentId.startsWith(`${projectName}-`)) {
      worktreePath = join(dirname(projectPath), assignment.agentId)
    } else {
      worktreePath = join(dirname(projectPath), `${projectName}-${assignment.agentId}`)
    }

    try {
      // Extract PR number from URL
      const prNumberMatch = assignment.prUrl.match(/\/pull\/(\d+)/)
      if (!prNumberMatch) {
        const error = 'Could not extract PR number from URL'
        if (!options?.silent) {
          log.error('', error)
        }
        return { status: 'ERROR', error }
      }
      const prNumber = prNumberMatch[1]

      // Check PR status using gh CLI
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', prNumber, '--json', 'state,mergedAt,createdAt'],
        { cwd: projectPath }
      )

      const prData = JSON.parse(stdout)
      const status = prData.state // OPEN, MERGED, CLOSED

      // Update .agent-info with PR status
      const updates: Partial<AgentInfo> = { prStatus: status }

      if (status === 'MERGED') {
        updates.status = 'merged'
      } else if (status === 'CLOSED') {
        updates.status = 'closed'
      }

      this.updateAgentInfo(worktreePath, updates)

      return {
        status,
        mergedAt: prData.mergedAt,
        createdAt: prData.createdAt
      }
    } catch (error: any) {
      if (!options?.silent) {
        log.error('Failed to check PR status:', error)
      }
      return { status: 'ERROR', error: error.message }
    }
  }

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

  getAgentPath(projectPath: string, agentInfo: AgentInfo): string {
    if (agentInfo.isBaseBranchAgent) {
      return projectPath
    }

    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

    if (agentInfo.agentId.startsWith(`${projectName}-`)) {
      return join(dirname(projectPath), agentInfo.agentId)
    } else {
      return join(dirname(projectPath), `${projectName}-${agentInfo.agentId}`)
    }
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

  // Archive helper methods
  private getArchiveDirectory(projectPath: string): string {
    return join(projectPath, 'minions', 'archive')
  }

  private ensureArchiveDirectory(projectPath: string): string {
    const archiveDir = this.getArchiveDirectory(projectPath)
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true })
    }
    return archiveDir
  }

  async archiveAgent(projectPath: string, agentId: string): Promise<ArchivedAgent> {
    // 1. Find agent's worktree path
    const agents = await this.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)

    if (!agent) {
      throw new Error(`Agent ${agentId} not found for archiving`)
    }

    // 2. Read agent info
    const agentInfo = this.readAgentInfo(agent.worktreePath)
    if (!agentInfo) {
      throw new Error(`Could not read agent info for ${agentId}`)
    }

    // 3. Create archive record
    const timestamp = Date.now()
    const archiveId = `${agentId}-${timestamp}`

    const archived: ArchivedAgent = {
      archiveId,
      archivedAt: new Date().toISOString(),
      archiveVersion: 1,

      agentId: agentInfo.agentId,
      assignmentId: agentInfo.id,

      branch: agentInfo.branch,
      feature: agentInfo.feature,
      prompt: agentInfo.prompt,

      tool: agentInfo.tool,
      model: agentInfo.model,
      mode: agentInfo.mode,

      createdAt: agentInfo.createdAt,
      completedAt: new Date().toISOString(),

      finalStatus: agentInfo.status,

      prUrl: agentInfo.prUrl,
      prStatus: agentInfo.prStatus,

      totalCostUsd: agentInfo.totalCostUsd,
      tokenUsage: agentInfo.tokenUsage,

      parentAgentId: agentInfo.parentAgentId,
      isSuperMinion: (agentInfo as any).isSuperMinion
    }

    // 4. Ensure archive directory exists and write archive file
    const archiveDir = this.ensureArchiveDirectory(projectPath)
    const archivePath = join(archiveDir, `${archiveId}.json`)
    writeFileSync(archivePath, JSON.stringify(archived, null, 2))

    log.info(`Archived agent ${agentId} to ${archivePath}`)

    return archived
  }

  async listArchivedAgents(projectPath: string): Promise<ArchivedAgent[]> {
    const archiveDir = this.getArchiveDirectory(projectPath)

    if (!existsSync(archiveDir)) {
      return []
    }

    try {
      const files = readdirSync(archiveDir).filter(f => f.endsWith('.json'))
      const archives: ArchivedAgent[] = []

      for (const file of files) {
        try {
          const content = readFileSync(join(archiveDir, file), 'utf-8')
          archives.push(JSON.parse(content))
        } catch (error) {
          log.warn(`Failed to read archive file ${file}:`, error)
        }
      }

      // Sort by archivedAt descending (most recent first)
      return archives.sort((a, b) =>
        new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
      )
    } catch (error) {
      log.warn('Failed to list archived agents:', error)
      return []
    }
  }

  async getArchivedAgent(projectPath: string, archiveId: string): Promise<ArchivedAgent | null> {
    const archivePath = join(this.getArchiveDirectory(projectPath), `${archiveId}.json`)

    if (!existsSync(archivePath)) {
      return null
    }

    try {
      const content = readFileSync(archivePath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      log.error(`Failed to read archive ${archiveId}:`, error)
      return null
    }
  }

  /**
   * Restore an archived agent by creating a new agent with the same configuration
   * @param projectPath - Path to the project
   * @param archiveId - ID of the archived agent to restore
   * @returns Newly created agent
   */
  async restoreArchivedAgent(projectPath: string, archiveId: string): Promise<AgentInfo> {
    // Load archived agent metadata
    const archived = await this.getArchivedAgent(projectPath, archiveId)
    if (!archived) {
      throw new Error(`Archive not found: ${archiveId}`)
    }

    // Generate new branch name with -restored suffix to avoid conflicts
    const timestamp = Date.now()
    const originalBranch = archived.branch.replace(/^feature\//, '')
    const newBranch = `${originalBranch}-restored-${timestamp}`

    // Create new assignment with archived agent's configuration
    const assignment = await this.createAssignment(projectPath, {
      feature: archived.feature,
      branch: newBranch,
      prompt: archived.prompt || `Restored from archive: ${archived.feature}`,
      tool: archived.tool,
      model: archived.model,
      mode: archived.mode as 'auto' | 'manual' | 'interactive' | 'planning' | 'dev' | 'idle'
    })

    log.info(`Restored agent from archive ${archiveId} as ${assignment.agentId}`)

    return assignment
  }

}
