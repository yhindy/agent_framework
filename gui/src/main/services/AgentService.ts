import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

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

  async initiateMerge(projectPath: string, assignmentId: string, tool?: string): Promise<Assignment> {
    const data = this.getAssignments(projectPath)
    const assignment = data.assignments.find(a => a.id === assignmentId)

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    if (assignment.status !== 'completed') {
      throw new Error('Only completed assignments can be merged')
    }

    // Find an available agent for the merge
    if (data.availableAgentIds.length === 0) {
      throw new Error('No available agents for merge. Please free up an agent first.')
    }

    const mergeAgentId = data.availableAgentIds[0]

    // Create merge assignment
    // For merge agents, convert 'cursor' to 'cursor-cli' since merge agents need to run in terminal
    let selectedTool = tool || 'claude'
    if (selectedTool === 'cursor') {
      selectedTool = 'cursor-cli'
      console.log('[AgentService] Converted cursor to cursor-cli for merge agent')
    }
    console.log('[AgentService] Creating merge assignment with tool:', selectedTool, 'received tool param:', tool)
    const mergeAssignment: Assignment = {
      id: `${mergeAgentId}-merge-${Date.now()}`,
      agentId: mergeAgentId,
      branch: assignment.branch, // Use the same branch as the original assignment
      feature: `MERGE: ${assignment.feature}`,
      status: 'in_progress',
      specFile: `docs/agents/assignments/${mergeAgentId}-merge-spec.md`,
      tool: selectedTool,
      mode: 'dev', // Merge agents run in dev mode
      prompt: this.buildMergePrompt(assignment),
      originalAssignmentId: assignmentId
    }

    // Add merge assignment
    data.assignments.push(mergeAssignment)

    // Update original assignment status to 'merging'
    const originalIndex = data.assignments.findIndex(a => a.id === assignmentId)
    data.assignments[originalIndex].status = 'merging'

    // Remove merge agent from available pool
    data.availableAgentIds = data.availableAgentIds.filter(id => id !== mergeAgentId)

    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))

    // Create merge spec file
    await this.createMergeSpec(projectPath, mergeAssignment, assignment)

    // Setup worktree for merge agent using the ORIGINAL assignment's branch
    // This is critical - we want to merge FROM that branch
    const setupScript = join(projectPath, 'scripts', 'agents', 'setup.sh')
    try {
      const { stdout, stderr } = await execAsync(
        `"${setupScript}" ${mergeAgentId} ${assignment.branch}`,
        { cwd: projectPath }
      )
      console.log('Merge agent worktree setup:', stdout)
      if (stderr) console.error('Setup warnings:', stderr)
    } catch (error: any) {
      console.error('Failed to setup merge agent worktree:', error)
      throw new Error('Failed to create merge agent workspace')
    }

    return mergeAssignment
  }

  private buildMergePrompt(originalAssignment: Assignment): string {
    return `You are a merge agent. Your task is to merge the completed feature branch into master.

BRANCH TO MERGE: ${originalAssignment.branch}
ORIGINAL FEATURE: ${originalAssignment.feature}

TASKS:
1. Review all changes made in this branch vs master
2. Run all tests to ensure they pass
3. Check for merge conflicts with master
   - If conflicts exist, analyze them and resolve intelligently
   - Document any manual conflict resolutions needed
4. Run any build/lint commands
5. Create a clean merge commit to master
6. Push to master

When complete, output: ===SIGNAL:DEV_COMPLETED===

If you encounter blockers (test failures, unresolvable conflicts), output: ===SIGNAL:BLOCKER===
`
  }

  private async createMergeSpec(
    projectPath: string,
    mergeAssignment: Assignment,
    originalAssignment: Assignment
  ): Promise<void> {
    const specDir = join(projectPath, 'docs', 'agents', 'assignments')
    if (!existsSync(specDir)) {
      mkdirSync(specDir, { recursive: true })
    }

    const specPath = join(projectPath, mergeAssignment.specFile)
    const specContent = `# Merge Specification

## Original Assignment
- **Agent**: ${originalAssignment.agentId}
- **Branch**: ${originalAssignment.branch}
- **Feature**: ${originalAssignment.feature}

## Merge Task
This is an automated merge agent assignment. Merge the feature branch into master.

## Steps
1. Review changes: \`git diff master...${originalAssignment.branch}\`
2. Check for conflicts: \`git merge-base master ${originalAssignment.branch}\`
3. Run tests
4. Merge to master: \`git merge --no-ff ${originalAssignment.branch}\`
5. Push to master
6. Signal completion with ===SIGNAL:DEV_COMPLETED===

## Success Criteria
- All tests pass
- No merge conflicts (or conflicts resolved intelligently)
- Clean merge commit created
- Changes pushed to master
`

    writeFileSync(specPath, specContent, 'utf-8')
  }

  async completeMerge(projectPath: string, mergeAssignmentId: string, success: boolean): Promise<void> {
    const data = this.getAssignments(projectPath)
    const mergeAssignment = data.assignments.find(a => a.id === mergeAssignmentId)

    if (!mergeAssignment) {
      throw new Error('Merge assignment not found')
    }

    // Find the original assignment (the one being merged)
    const originalAssignment = data.assignments.find(a =>
      a.status === 'merging' &&
      a.branch === mergeAssignment.branch &&
      a.id !== mergeAssignmentId
    )

    if (success) {
      // Archive the original assignment
      if (originalAssignment) {
        const originalIndex = data.assignments.findIndex(a => a.id === originalAssignment.id)
        data.assignments[originalIndex].status = 'archived'

        // Free up the original agent
        if (!data.availableAgentIds.includes(originalAssignment.agentId)) {
          data.availableAgentIds.push(originalAssignment.agentId)
        }
      }

      // Archive the merge assignment
      const mergeIndex = data.assignments.findIndex(a => a.id === mergeAssignmentId)
      data.assignments[mergeIndex].status = 'archived'

      // Free up the merge agent
      if (!data.availableAgentIds.includes(mergeAssignment.agentId)) {
        data.availableAgentIds.push(mergeAssignment.agentId)
      }

      // Teardown both worktrees
      await this.teardownAgent(projectPath, originalAssignment.agentId, false)
      await this.teardownAgent(projectPath, mergeAssignment.agentId, false)
    } else {
      // Merge failed - revert original assignment to review state
      if (originalAssignment) {
        const originalIndex = data.assignments.findIndex(a => a.id === originalAssignment.id)
        data.assignments[originalIndex].status = 'review'
      }

      // Mark merge assignment as blocked
      const mergeIndex = data.assignments.findIndex(a => a.id === mergeAssignmentId)
      data.assignments[mergeIndex].status = 'blocked'
    }

    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
    writeFileSync(assignmentsPath, JSON.stringify(data, null, 2))
  }
}

