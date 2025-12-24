import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { app } from 'electron'
import { ProjectConfig, Assignment, AgentInfo } from './types/ProjectConfig'

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
}

export class AgentService {
  private sessions: Map<string, AgentSession>

  constructor() {
    this.sessions = new Map()
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

  async listAgents(projectPath: string): Promise<AgentSession[]> {
    const agents: AgentSession[] = []

    try {
      // Get worktrees from git
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectPath })

      const config = this.getProjectConfig(projectPath)
      const projectName = config.project?.name || projectPath.split('/').pop() || 'project'
      const worktrees = this.parseWorktrees(stdout, projectName)

      for (const worktree of worktrees) {
        // Read agent info from .agent-info file (supports both old and new formats)
        const agentInfo = this.readAgentInfo(worktree.path)

        if (agentInfo) {
          // Get or create session
          let session = this.sessions.get(agentInfo.agentId)
          if (!session) {
            session = {
              id: agentInfo.agentId,
              assignmentId: agentInfo.id,
              worktreePath: worktree.path,
              terminalPid: null,
              hasUnread: agentInfo.hasUnread || false,
              lastActivity: agentInfo.lastActivity,
              mode: agentInfo.mode,
              tool: agentInfo.tool,
              isSuperMinion: (agentInfo as any).isSuperMinion,
              parentAgentId: agentInfo.parentAgentId
            }
            this.sessions.set(agentInfo.agentId, session)
          } else {
            // Update session with latest data from .agent-info
            session.assignmentId = agentInfo.id
            session.mode = agentInfo.mode
            session.tool = agentInfo.tool
            session.hasUnread = agentInfo.hasUnread || session.hasUnread
            session.lastActivity = agentInfo.lastActivity
            session.isSuperMinion = (agentInfo as any).isSuperMinion
            session.parentAgentId = agentInfo.parentAgentId
          }

          agents.push(session)
        }
      }
    } catch (error) {
      console.error('Error listing agents:', error)
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
  readAgentInfo(worktreePath: string): AgentInfo | null {
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
      console.error('Error reading .agent-info:', error)
      return null
    }
  }

  writeAgentInfo(worktreePath: string, info: AgentInfo): void {
    const agentInfoPath = join(worktreePath, '.agent-info')
    writeFileSync(agentInfoPath, JSON.stringify(info, null, 2))
  }

  updateAgentInfo(worktreePath: string, updates: Partial<AgentInfo>): void {
    const current = this.readAgentInfo(worktreePath)
    if (!current) {
      throw new Error('Agent info not found')
    }

    const updated = { ...current, ...updates, lastActivity: new Date().toISOString() }
    this.writeAgentInfo(worktreePath, updated)
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
      const { assignments } = this.getAssignments(projectPath)
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

  private getProjectConfigPath(projectPath: string): string {
    return join(projectPath, 'minions', 'config.json')
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
      console.error('Error parsing config.json', e)
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
      status: (assignment.status as any) || 'in_progress',
      tool: assignment.tool || 'claude',
      model: assignment.model,
      mode: (assignment.mode as any) || 'auto',
      prompt: (assignment as any).prompt,
      specFile: (assignment as any).specFile,
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
      console.log('Setup script output:', stdout)
      if (stderr) console.error('Setup script errors:', stderr)

      // Write agent info to .agent-info file in the worktree
      this.writeAgentInfo(worktreePath, agentInfo)
    } catch (error: any) {
      console.error('Failed to run setup.sh:', error)
      throw error
    }

    return agentInfo
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
      minionBudget: assignment.minionBudget || 5,
      children: [],
      pendingPlans: []
    } as any)
    
    // Return the updated info
    return {
      ...result,
      isSuperMinion: true,
      minionBudget: assignment.minionBudget || 5,
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
        console.error('Error opening Cursor:', error)
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
      console.error('Error getting assignments:', error)
    }

    return { assignments }
  }

  async teardownAgent(projectPath: string, agentId: string, force: boolean = false): Promise<void> {
    const teardownScript = join(this.getMinionsPath(), 'bin', 'teardown.sh')
    const configPath = this.getProjectConfigPath(projectPath)

    try {
      const args = [agentId, '--config', configPath]
      if (force) args.push('--force')
      const { stdout, stderr } = await execFileAsync(
        teardownScript,
        args,
        { cwd: projectPath }
      )
      console.log('Teardown script output:', stdout)
      if (stderr) console.error('Teardown script errors:', stderr)

      // Remove from sessions
      this.sessions.delete(agentId)

      // No need to update config.json - the .agent-info file is removed with the worktree atomically
    } catch (error: any) {
      console.error('Failed to run teardown.sh:', error)

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
  private async getDefaultBranch(projectPath: string, worktreePath: string): Promise<string> {
    // 1. Try to get from project config first
    const config = this.getProjectConfig(projectPath)
    if (config.project?.defaultBaseBranch) {
      console.log(`[AgentService] Using default branch from config: ${config.project.defaultBaseBranch}`)
      return config.project.defaultBaseBranch
    }

    try {
      // 2. Try to get default branch from gh CLI
      const { stdout } = await execAsync('gh repo view --json defaultBranchRef --jq .defaultBranchRef.name', { cwd: worktreePath })
      if (stdout.trim()) {
        return stdout.trim()
      }
    } catch (error) {
      console.log('[AgentService] Could not get default branch from gh, trying git...')
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
          console.log('[AgentService] Auto-committing changes...')
          await execAsync('git add -A', { cwd: worktreePath })
          const commitMessage = `Complete: ${assignment.feature}`
          
          try {
            await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath })
            console.log('[AgentService] Changes committed')
          } catch (commitError: any) {
            // If identity is unknown, try to set a default one
            if (commitError.message.includes('identity unknown')) {
              console.log('[AgentService] Git identity unknown, setting default...')
              await execFileAsync('git', ['config', 'user.email', 'agent@minions.ai'], { cwd: worktreePath })
              await execFileAsync('git', ['config', 'user.name', 'Minion Agent'], { cwd: worktreePath })
              await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath })
              console.log('[AgentService] Changes committed with default identity')
            } else if (commitError.stderr && (commitError.stderr.includes('pre-commit') || commitError.stdout.includes('pre-commit') || commitError.message.includes('hook failed'))) {
              throw new Error(`Pre-commit hooks failed. Please fix the issues and try again.\n\n${commitError.stderr || commitError.stdout || commitError.message}`)
            } else if (commitError.message.includes('nothing to commit')) {
              console.log('[AgentService] Nothing to commit')
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
      console.log(`[AgentService] Using base branch: ${baseBranch}, remote: ${remote}`)

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
      console.log(`[AgentService] Pushing branch to ${remote}...`)
      try {
        await execFileAsync('git', ['push', '-u', remote, assignment.branch], { cwd: worktreePath })
      } catch (pushError: any) {
        // If it's already up to date, that's fine
        if (pushError.stderr && (pushError.stderr.includes('Everything up-to-date') || pushError.stdout.includes('Everything up-to-date'))) {
          console.log('[AgentService] Branch is already up to date')
        } else if (pushError.stderr && (pushError.stderr.includes('pre-push') || pushError.stdout.includes('pre-push') || pushError.message.includes('hook failed'))) {
          throw new Error(`Pre-push hooks failed. Please fix the issues and try again.\n\n${pushError.stderr || pushError.stdout || pushError.message}`)
        } else {
          console.error('Push error details:', pushError)
          throw new Error(`Failed to push branch to ${remote}: ${pushError.message}`)
        }
      }

      // Read the spec file for PR body
      let prBody = assignment.feature
      if (assignment.specFile) {
        const specPath = join(projectPath, assignment.specFile)
        if (existsSync(specPath)) {
          prBody = readFileSync(specPath, 'utf-8')
        }
      }
      if (assignment.prompt) {
        prBody = assignment.prompt
      }

      // Create PR title from feature
      const prTitle = assignment.feature.length > 72 
        ? assignment.feature.substring(0, 69) + '...'
        : assignment.feature

      // Try to create PR
      console.log('[AgentService] Creating PR...')
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

        console.log('[AgentService] PR created:', prUrl)
        return { url: prUrl }
      } catch (prError: any) {
        // Check if PR already exists
        if (prError.message.includes('already exists')) {
          console.log('[AgentService] PR already exists, fetching URL...')
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

          return { url: prUrl }
        }
        throw prError
      }
    } catch (error: any) {
      console.error('[AgentService] Failed to create PR:', error)
      throw new Error(`Failed to create pull request: ${error.message}`)
    }
  }

  async migrateAssignments(projectPath: string): Promise<void> {
    console.log('[AgentService] Starting assignment migration for:', projectPath)

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
            console.log('[AgentService] Migrating .agent-info for:', worktree.path)

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
        console.log(`[AgentService] Migrated ${migratedCount} agents, clearing config.json assignments`)
        config.assignments = []
        this.saveProjectConfig(projectPath, config)
      }

      console.log(`[AgentService] Migration complete: ${migratedCount} agents migrated`)
    } catch (error) {
      console.error('[AgentService] Migration failed:', error)
    }
  }

  async checkPullRequestStatus(projectPath: string, assignmentId: string): Promise<{ status: string; mergedAt?: string }> {
    const { assignments } = await this.getAssignments(projectPath)
    const assignment = assignments.find(a => a.id === assignmentId)

    if (!assignment || !assignment.prUrl) {
      throw new Error('Assignment or PR URL not found')
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
        throw new Error('Could not extract PR number from URL')
      }
      const prNumber = prNumberMatch[1]

      // Check PR status using gh CLI
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', prNumber, '--json', 'state,mergedAt'],
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
        mergedAt: prData.mergedAt
      }
    } catch (error: any) {
      console.error('[AgentService] Failed to check PR status:', error)
      throw new Error(`Failed to check PR status: ${error.message}`)
    }
  }
}

