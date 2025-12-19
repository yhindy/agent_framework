import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const execAsync = promisify(exec)

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  mode?: string
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
    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
    
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
    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
    const data = this.getAssignments(projectPath)

    const newAssignment: Assignment = {
      id: assignment.id || `${assignment.agentId}-${Date.now()}`,
      agentId: assignment.agentId!,
      branch: assignment.branch!,
      feature: assignment.feature!,
      status: assignment.status || 'pending',
      specFile: assignment.specFile || `docs/agents/assignments/${assignment.agentId}-${assignment.branch?.split('/').pop()}.md`,
      tool: assignment.tool || 'claude',
      model: assignment.model,
      mode: assignment.mode || 'idle',
      prompt: assignment.prompt
    }

    data.assignments.push(newAssignment)
    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))

    // Run setup.sh to create the agent worktree
    const setupScript = join(projectPath, 'scripts', 'agents', 'setup.sh')
    try {
      const { stdout, stderr } = await execAsync(
        `"${setupScript}" ${newAssignment.agentId} ${newAssignment.branch}`,
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
    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
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
    exec(`cursor "${agent.worktreePath}"`, (error) => {
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
    const teardownScript = join(projectPath, 'scripts', 'agents', 'teardown.sh')
    
    try {
      const forceFlag = force ? '--force' : ''
      const { stdout, stderr } = await execAsync(
        `"${teardownScript}" ${agentId} ${forceFlag}`,
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
    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
    const data = this.getAssignments(projectPath)

    // Remove assignment for this agent
    data.assignments = data.assignments.filter(a => a.agentId !== agentId)
    
    // Add agent back to available pool if not already there
    if (!data.availableAgentIds.includes(agentId)) {
      data.availableAgentIds.push(agentId)
    }
    
    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))
  }
}

