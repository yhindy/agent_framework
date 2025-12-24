import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { app } from 'electron'
import { ProjectConfig, Assignment } from './types/ProjectConfig'

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
        // Check if .agent-info exists
        const agentInfoPath = join(worktree.path, '.agent-info')
        
        if (existsSync(agentInfoPath)) {
          const info = this.parseAgentInfo(agentInfoPath)
          
          // Get or create session
          let session = this.sessions.get(info.AGENT_ID)
          if (!session) {
            session = {
              id: info.AGENT_ID,
              assignmentId: null,
              worktreePath: worktree.path,
              terminalPid: null,
              hasUnread: false,
              lastActivity: new Date().toISOString(),
              mode: 'idle'
            }
            this.sessions.set(info.AGENT_ID, session)
          }
          
          // Find matching assignment
          const assignments = this.getAssignments(projectPath)
          const assignment = assignments.assignments.find(a => a.agentId === info.AGENT_ID)
          if (assignment) {
            session.assignmentId = assignment.id
            session.mode = assignment.mode || 'idle'
            session.tool = assignment.tool
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

  async createAssignment(projectPath: string, assignment: Partial<Assignment>): Promise<Assignment> {
    const config = this.getProjectConfig(projectPath)

    // Auto-generate agent ID if not provided
    let agentId = assignment.agentId
    if (!agentId) {
      const projectName = config.project.name || projectPath.split('/').pop() || 'project'
      const hash = Math.random().toString(36).substring(2, 6)
      agentId = `${projectName}-${hash}`
    }

    // Auto-generate branch name if not provided
    let branch = assignment.branch!
    if (!branch.startsWith('feature/')) {
      branch = `feature/${agentId}/${branch}`
    }

    const newAssignment: Assignment = {
      id: assignment.id || `${agentId}-${Date.now()}`,
      agentId: agentId,
      branch: branch,
      feature: assignment.feature!,
      status: assignment.status as any || 'active',
      tool: assignment.tool || 'claude',
      model: assignment.model,
      mode: assignment.mode as any || 'auto',
      prompt: assignment.prompt,
      prUrl: undefined,
      prStatus: undefined
    }

    config.assignments.push(newAssignment)
    this.saveProjectConfig(projectPath, config)

    // Run setup.sh to create the agent worktree
    const setupScript = join(this.getMinionsPath(), 'bin', 'setup.sh')
    const configPath = this.getProjectConfigPath(projectPath)
    
    try {
      const { stdout, stderr } = await execFileAsync(
        setupScript,
        [newAssignment.agentId, newAssignment.branch, '--config', configPath],
        { cwd: projectPath }
      )
      console.log('Setup script output:', stdout)
      if (stderr) console.error('Setup script errors:', stderr)
    } catch (error: any) {
      console.error('Failed to run setup.sh:', error)
    }

    return newAssignment
  }

  async updateAssignment(projectPath: string, assignmentId: string, updates: Partial<Assignment>): Promise<void> {
    const config = this.getProjectConfig(projectPath)

    const index = config.assignments.findIndex(a => a.id === assignmentId)
    if (index === -1) {
      throw new Error('Assignment not found')
    }

    config.assignments[index] = { ...config.assignments[index], ...updates }
    this.saveProjectConfig(projectPath, config)
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

  getAssignments(projectPath: string): { assignments: Assignment[] } {
    const config = this.getProjectConfig(projectPath)
    return { assignments: config.assignments }
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
      
      // Remove assignment
      await this.removeAssignment(projectPath, agentId)
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
    // Just remove the assignment, keep the worktree
    await this.removeAssignment(projectPath, agentId)
    
    // Update session to clear assignment
    const session = this.sessions.get(agentId)
    if (session) {
      session.assignmentId = null
      session.mode = 'idle'
    }
  }

  private async removeAssignment(projectPath: string, agentId: string): Promise<void> {
    const config = this.getProjectConfig(projectPath)
    config.assignments = config.assignments.filter(a => a.agentId !== agentId)
    this.saveProjectConfig(projectPath, config)
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
    const config = this.getProjectConfig(projectPath)
    const assignment = config.assignments.find(a => a.id === assignmentId)

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    // Allow PR creation from in_progress, review, or completed states
    if (['pending', 'blocked', 'closed'].includes(assignment.status)) {
      throw new Error(`Cannot create PR for assignment in '${assignment.status}' status`)
    }

    // Find the worktree for this agent
    const agents = await this.listAgents(projectPath)
    const agent = agents.find(a => a.id === assignment.agentId)
    
    if (!agent) {
      throw new Error('Agent worktree not found')
    }

    const worktreePath = agent.worktreePath

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

      // Use prompt for PR body, fallback to feature description
      const prBody = assignment.prompt || assignment.feature

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

        // Update assignment with PR URL and status
        const assignmentIndex = config.assignments.findIndex(a => a.id === assignmentId)
        config.assignments[assignmentIndex].prUrl = prUrl
        config.assignments[assignmentIndex].prStatus = 'OPEN'
        config.assignments[assignmentIndex].status = 'pr_open'

        this.saveProjectConfig(projectPath, config)

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

          // Update assignment
          const assignmentIndex = config.assignments.findIndex(a => a.id === assignmentId)
          config.assignments[assignmentIndex].prUrl = prUrl
          config.assignments[assignmentIndex].prStatus = 'OPEN'
          config.assignments[assignmentIndex].status = 'pr_open'

          this.saveProjectConfig(projectPath, config)

          return { url: prUrl }
        }
        throw prError
      }
    } catch (error: any) {
      console.error('[AgentService] Failed to create PR:', error)
      throw new Error(`Failed to create pull request: ${error.message}`)
    }
  }

  async checkPullRequestStatus(projectPath: string, assignmentId: string): Promise<{ status: string; mergedAt?: string }> {
    const config = this.getProjectConfig(projectPath)
    const assignment = config.assignments.find(a => a.id === assignmentId)

    if (!assignment || !assignment.prUrl) {
      throw new Error('Assignment or PR URL not found')
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

      // Update assignment status
      const assignmentIndex = config.assignments.findIndex(a => a.id === assignmentId)
      config.assignments[assignmentIndex].prStatus = status

      if (status === 'MERGED') {
        config.assignments[assignmentIndex].status = 'merged'
      } else if (status === 'CLOSED') {
        config.assignments[assignmentIndex].status = 'closed'
      }

      this.saveProjectConfig(projectPath, config)

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

