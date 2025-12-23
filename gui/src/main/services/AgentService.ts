import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

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
  tool?: string  // 'claude', 'aider', 'cursor', etc.
}

interface Assignment {
  id: string
  agentId: string
  branch: string
  feature: string
  status: string
  specFile: string
  tool: string
  model?: string
  mode: string
  prompt?: string
  prUrl?: string
  prStatus?: string
}

interface AssignmentsFile {
  assignments: Assignment[]
  availableAgentIds: string[]
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
      
      const projectName = projectPath.split('/').pop() || 'project'
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
        // Only include agent worktrees
        if (path.includes(`${projectName}-agent-`)) {
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

  getAssignments(projectPath: string): AssignmentsFile {
    const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
    
    if (!existsSync(assignmentsPath)) {
      return { assignments: [], availableAgentIds: [] }
    }

    try {
      const content = readFileSync(assignmentsPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      console.error('Error reading assignments:', error)
      return { assignments: [], availableAgentIds: [] }
    }
  }

  async createAssignment(projectPath: string, assignment: Partial<Assignment>): Promise<Assignment> {
    const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
    const data = this.getAssignments(projectPath)

    const newAssignment: Assignment = {
      id: assignment.id || `${assignment.agentId}-${Date.now()}`,
      agentId: assignment.agentId!,
      branch: assignment.branch!,
      feature: assignment.feature!,
      status: assignment.status || 'pending',
      specFile: assignment.specFile || `minions/assignments/${assignment.agentId}-${assignment.branch?.split('/').pop()}.md`,
      tool: assignment.tool || 'claude',
      model: assignment.model,
      mode: assignment.mode || 'idle',
      prompt: assignment.prompt
    }

    data.assignments.push(newAssignment)
    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))

    // Run setup.sh to create the agent worktree
    const setupScript = join(projectPath, 'minions', 'bin', 'setup.sh')
    try {
      const { stdout, stderr } = await execFileAsync(
        setupScript,
        [newAssignment.agentId, newAssignment.branch],
        { cwd: projectPath }
      )
      console.log('Setup script output:', stdout)
      if (stderr) console.error('Setup script errors:', stderr)
    } catch (error: any) {
      console.error('Failed to run setup.sh:', error)
      // Don't throw - assignment is still created, just worktree creation failed
      // User can run setup.sh manually
    }

    return newAssignment
  }

  async updateAssignment(projectPath: string, assignmentId: string, updates: Partial<Assignment>): Promise<void> {
    const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
    const data = this.getAssignments(projectPath)

    const index = data.assignments.findIndex(a => a.id === assignmentId)
    if (index === -1) {
      throw new Error('Assignment not found')
    }

    data.assignments[index] = { ...data.assignments[index], ...updates }
    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))
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

  async teardownAgent(projectPath: string, agentId: string, force: boolean = false): Promise<void> {
    const teardownScript = join(projectPath, 'minions', 'bin', 'teardown.sh')
    
    try {
      const args = [agentId]
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
    const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
    const data = this.getAssignments(projectPath)

    // Remove assignment for this agent
    data.assignments = data.assignments.filter(a => a.agentId !== agentId)

    // Add agent back to available pool if not already there
    if (!data.availableAgentIds.includes(agentId)) {
      data.availableAgentIds.push(agentId)
    }

    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))
  }

  private async getProjectConfig(projectPath: string): Promise<Record<string, string>> {
    const configPath = join(projectPath, 'minions', 'bin', 'config.sh')
    const config: Record<string, string> = {}
    
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8')
        const lines = content.split('\n')
        for (const line of lines) {
          const match = line.match(/^([A-Z_]+)="?([^"]*)"?/)
          if (match) {
            config[match[1]] = match[2]
          }
        }
      } catch (error) {
        console.error('[AgentService] Error reading config.sh:', error)
      }
    }
    
    return config
  }

  private async getDefaultBranch(projectPath: string, worktreePath: string): Promise<string> {
    // 1. Try to get from project config first
    const config = await this.getProjectConfig(projectPath)
    if (config.DEFAULT_BASE_BRANCH) {
      console.log(`[AgentService] Using default branch from config: ${config.DEFAULT_BASE_BRANCH}`)
      return config.DEFAULT_BASE_BRANCH
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
    const data = this.getAssignments(projectPath)
    const assignment = data.assignments.find(a => a.id === assignmentId)

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

      // Read the spec file for PR body
      let prBody = assignment.feature
      const specPath = join(projectPath, assignment.specFile)
      if (existsSync(specPath)) {
        prBody = readFileSync(specPath, 'utf-8')
      } else if (assignment.prompt) {
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

        // Update assignment with PR URL and status
        const assignmentIndex = data.assignments.findIndex(a => a.id === assignmentId)
        data.assignments[assignmentIndex].prUrl = prUrl
        data.assignments[assignmentIndex].prStatus = 'OPEN'
        data.assignments[assignmentIndex].status = 'pr_open'

        const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
        writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))

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
          const assignmentIndex = data.assignments.findIndex(a => a.id === assignmentId)
          data.assignments[assignmentIndex].prUrl = prUrl
          data.assignments[assignmentIndex].prStatus = 'OPEN'
          data.assignments[assignmentIndex].status = 'pr_open'

          const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
          writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))

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
    const data = this.getAssignments(projectPath)
    const assignment = data.assignments.find(a => a.id === assignmentId)

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
      const assignmentIndex = data.assignments.findIndex(a => a.id === assignmentId)
      data.assignments[assignmentIndex].prStatus = status

      if (status === 'MERGED') {
        data.assignments[assignmentIndex].status = 'merged'
      } else if (status === 'CLOSED') {
        data.assignments[assignmentIndex].status = 'closed'
      }

      const assignmentsPath = join(projectPath, 'minions', 'assignments.json')
      writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))

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

