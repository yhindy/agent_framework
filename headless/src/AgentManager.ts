import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname, resolve } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { Mutex } from 'async-mutex'
import { createLogger } from './logger'
import type { HeadlessAgentState, HandoffSource, SpawnSource, SpawnResult } from './types'

const log = createLogger('AgentManager')
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const RESERVED_SUFFIXES = ['base', 'main', 'master', 'origin', 'head']

// Internal agent info format (stored in worktree .agent-info or .minions/agents/)
interface AgentInfo {
  id: string; agentId: string; branch: string; project: string; feature: string
  status: string; tool: string; model?: string; mode: string
  yolo?: boolean; chrome?: boolean; prompt?: string
  createdAt: string; lastActivity: string
  isBaseBranchAgent?: boolean; parentAgentId?: string
  handoffSource?: HandoffSource; spawnSource?: SpawnSource
  totalCostUsd?: number
  tokenUsage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
}

export class AgentManager {
  private sessions = new Map<string, { worktreePath: string; projectPath: string }>()
  private worktreeMutex = new Mutex()
  private minionsPath: string

  constructor(minionsPath: string) {
    this.minionsPath = minionsPath
  }

  // --- Config ---

  private getConfigPath(projectPath: string): string {
    const newPath = join(projectPath, 'minions.json')
    return existsSync(newPath) ? newPath : join(projectPath, 'minions', 'config.json')
  }

  private getConfig(projectPath: string): { project: { name: string; defaultBaseBranch: string } } {
    const configPath = this.getConfigPath(projectPath)
    if (!existsSync(configPath)) return { project: { name: 'unknown', defaultBaseBranch: '' } }
    try { return JSON.parse(readFileSync(configPath, 'utf-8')) } catch { return { project: { name: 'unknown', defaultBaseBranch: '' } } }
  }

  private getProjectName(projectPath: string): string {
    return this.getConfig(projectPath).project?.name || projectPath.split('/').pop() || 'project'
  }

  private isNewFormat(projectPath: string): boolean {
    return existsSync(join(projectPath, 'minions.json'))
  }

  // --- Agent info read/write ---

  private readAgentInfo(worktreePath: string, agentId?: string, projectPath?: string): AgentInfo | null {
    if (agentId && projectPath) {
      const newPath = join(projectPath, '.minions', 'agents', `${agentId}.json`)
      if (existsSync(newPath)) {
        try { return JSON.parse(readFileSync(newPath, 'utf-8')) } catch { /* fall through */ }
      }
    }

    const legacyPath = join(worktreePath, '.agent-info')
    if (!existsSync(legacyPath)) return null
    try {
      const content = readFileSync(legacyPath, 'utf-8')
      try { return JSON.parse(content) } catch {
        // Parse old key=value format
        const info: Record<string, string> = {}
        for (const line of content.split('\n')) {
          const [key, value] = line.split('=')
          if (key && value) info[key.trim()] = value.trim()
        }
        return {
          id: info.AGENT_ID || '', agentId: info.AGENT_ID || '', branch: info.BRANCH || '',
          project: info.PROJECT || '', feature: '', status: 'active', tool: 'claude', mode: 'auto',
          createdAt: new Date().toISOString(), lastActivity: new Date().toISOString()
        }
      }
    } catch { return null }
  }

  private writeAgentInfo(worktreePath: string, info: AgentInfo, projectPath?: string): void {
    if (info.isBaseBranchAgent) {
      this.writeBaseAgentInfo(projectPath || worktreePath, info)
      return
    }
    const effectivePath = projectPath || worktreePath
    if (this.isNewFormat(effectivePath)) {
      const dir = join(effectivePath, '.minions', 'agents')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${info.agentId}.json`), JSON.stringify(info, null, 2))
    } else {
      writeFileSync(join(worktreePath, '.agent-info'), JSON.stringify(info, null, 2))
    }
  }

  // --- Base agent ---

  private readBaseAgentInfo(projectPath: string): AgentInfo | null {
    for (const path of [join(projectPath, '.minions', 'base-agent.json'), join(projectPath, '.minions-base-info')]) {
      if (existsSync(path)) {
        try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { /* continue */ }
      }
    }
    return null
  }

  private writeBaseAgentInfo(projectPath: string, info: AgentInfo): void {
    if (this.isNewFormat(projectPath)) {
      const dir = join(projectPath, '.minions')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'base-agent.json'), JSON.stringify(info, null, 2))
    } else {
      writeFileSync(join(projectPath, '.minions-base-info'), JSON.stringify(info, null, 2))
    }
  }

  async ensureBaseBranchAgent(projectPath: string): Promise<AgentInfo> {
    const existing = this.readBaseAgentInfo(projectPath)
    if (existing) return existing
    const projectName = this.getProjectName(projectPath)
    const baseBranch = await this.getDefaultBranch(projectPath)
    const now = new Date().toISOString()
    const info: AgentInfo = {
      id: `${projectName}-base`, agentId: `${projectName}-base`, branch: baseBranch,
      project: projectName, feature: 'Base branch agent', status: 'active',
      tool: 'claude', mode: 'interactive', isBaseBranchAgent: true,
      createdAt: now, lastActivity: now
    }
    this.writeBaseAgentInfo(projectPath, info)
    return info
  }

  // --- Git helpers ---

  private async getDefaultBranch(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        'git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s@^refs/remotes/origin/@@"',
        { cwd: projectPath }
      )
      const branch = stdout.trim()
      if (branch === 'main' || branch === 'master') return branch
    } catch { /* ignore */ }
    try {
      const { stdout } = await execAsync('git branch --list main master 2>/dev/null', { cwd: projectPath })
      if (stdout.includes('main')) return 'main'
      if (stdout.includes('master')) return 'master'
    } catch { /* ignore */ }
    return 'main'
  }

  private async gitCommit(worktreePath: string, message: string): Promise<void> {
    const { stdout } = await execAsync('git status --porcelain', { cwd: worktreePath })
    if (!stdout.trim()) return
    await execAsync('git add -A', { cwd: worktreePath })
    try {
      await execFileAsync('git', ['commit', '-m', message], { cwd: worktreePath })
    } catch (e: any) {
      if (e.message?.includes('identity unknown') || e.stderr?.includes('identity unknown')) {
        await execFileAsync('git', ['config', 'user.email', 'minion@local'], { cwd: worktreePath })
        await execFileAsync('git', ['config', 'user.name', 'Minion Setup'], { cwd: worktreePath })
        await execFileAsync('git', ['commit', '-m', message], { cwd: worktreePath })
      } else if (!e.message?.includes('nothing to commit')) {
        log.warn('Commit failed:', e.message)
      }
    }
  }

  private sanitizeBranch(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  }

  // --- Agent lifecycle ---

  async listAgents(projectPath: string): Promise<HeadlessAgentState[]> {
    const agents: HeadlessAgentState[] = []
    try {
      const base = this.readBaseAgentInfo(projectPath)
      if (base?.isBaseBranchAgent) agents.push(this.toState(base, projectPath))

      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectPath })
      const projectName = this.getProjectName(projectPath)
      for (const wt of this.parseWorktrees(stdout, projectName)) {
        const info = this.readAgentInfo(wt.path)
        if (info?.agentId) agents.push(this.toState(info, projectPath))
      }
    } catch (e) { log.error('Error listing agents', e) }
    return agents
  }

  parseWorktrees(output: string, projectName: string): Array<{ path: string; branch: string }> {
    const result: Array<{ path: string; branch: string }> = []
    let current: any = {}
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        const path = line.substring(9)
        if (path.split('/').pop()?.startsWith(`${projectName}-`)) current.path = path
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).replace('refs/heads/', '')
      } else if (line === '' && current.path) {
        result.push(current)
        current = {}
      }
    }
    if (current.path) result.push(current)
    return result
  }

  private toState(info: AgentInfo, projectPath: string): HeadlessAgentState {
    const statusMap: Record<string, HeadlessAgentState['status']> = {
      completed: 'completed', merged: 'completed', cancelled: 'stopped', pending: 'creating'
    }
    return {
      id: info.agentId, agentId: info.agentId, projectPath,
      status: statusMap[info.status] || 'running',
      branch: info.branch, tool: info.tool, model: info.model, prompt: info.prompt,
      createdAt: info.createdAt, lastActivity: info.lastActivity,
      totalCostUsd: info.totalCostUsd, tokenUsage: info.tokenUsage,
      parentAgentId: info.parentAgentId, handoffSource: info.handoffSource, spawnSource: info.spawnSource
    }
  }

  async getAgent(projectPath: string, agentId: string): Promise<HeadlessAgentState | null> {
    const agents = await this.listAgents(projectPath)
    return agents.find(a => a.agentId === agentId) || null
  }

  async findProjectForAgent(activeProjectPaths: string[], agentId: string): Promise<string> {
    for (const path of activeProjectPaths) {
      const agents = await this.listAgents(path)
      if (agents.some(a => a.agentId === agentId)) return path
    }
    throw new Error(`Agent ${agentId} not found in any active project`)
  }

  async createAssignment(projectPath: string, opts: {
    branch?: string; feature?: string; prompt?: string; tool?: string; model?: string; yolo?: boolean; mode?: string
  }): Promise<AgentInfo> {
    const projectName = this.getProjectName(projectPath)
    let branch = opts.branch || `feature/${opts.feature || 'agent'}`

    const branchSuffix = (branch.startsWith('feature/') ? branch.replace(/^feature\//, '').split('/').pop() || branch : branch)
      .replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    if (RESERVED_SUFFIXES.includes(branchSuffix.toLowerCase())) {
      throw new Error(`Branch name "${branchSuffix}" is reserved.`)
    }

    const agentId = `${projectName}-${branchSuffix}`
    if (!branch.startsWith('feature/')) branch = `feature/${branch}`

    const worktreePath = agentId.startsWith(`${projectName}-`)
      ? join(dirname(projectPath), agentId)
      : join(dirname(projectPath), `${projectName}-${agentId}`)

    const now = new Date().toISOString()
    const info: AgentInfo = {
      id: `${agentId}-${Date.now()}`, agentId, branch, project: projectName,
      feature: opts.feature || '', status: 'active', tool: opts.tool || 'claude',
      model: opts.model, mode: opts.mode || 'auto', yolo: opts.yolo, chrome: true,
      prompt: opts.prompt, createdAt: now, lastActivity: now
    }

    const configPath = this.getConfigPath(projectPath)
    const setupScript = join(this.minionsPath, 'bin', 'setup.sh')
    const { stdout, stderr } = await execFileAsync(setupScript, [agentId, branch, '--config', configPath], { cwd: projectPath })
    log.debug('Setup:', stdout)
    if (stderr) log.warn('Setup errors:', stderr)

    this.writeAgentInfo(worktreePath, info)
    try { await this.gitCommit(worktreePath, 'Worktree setup files') } catch (e: any) { log.warn('Setup commit:', e.message) }

    this.sessions.set(agentId, { worktreePath, projectPath })
    return info
  }

  // --- Handoff ---

  async handoffAgent(projectPath: string, request: {
    sourceAgentId: string; prompt: string; branchMode: 'inherit' | 'fresh'
    tool?: string; model?: string; shortName?: string; yolo?: boolean; chrome?: boolean
  }): Promise<{ success: boolean; newAgent?: AgentInfo; error?: string }> {
    if (!request.sourceAgentId || !request.prompt || !request.branchMode) {
      return { success: false, error: 'Missing required fields' }
    }
    try {
      const agents = await this.listAgents(projectPath)
      const source = agents.find(a => a.agentId === request.sourceAgentId)
      if (!source) return { success: false, error: `Source agent ${request.sourceAgentId} not found` }

      const projectName = this.getProjectName(projectPath)
      const sourceWorktree = join(dirname(projectPath), request.sourceAgentId.startsWith(`${projectName}-`) ? request.sourceAgentId : `${projectName}-${request.sourceAgentId}`)
      const sourceInfo = this.readAgentInfo(sourceWorktree)
      if (!sourceInfo) return { success: false, error: 'Failed to read source agent info' }

      // Commit source changes
      try { await this.gitCommit(sourceWorktree, '[wip] Checkpoint before handoff') } catch (e: any) {
        return { success: false, error: `Failed to commit: ${e.message}` }
      }

      const hash = Math.random().toString(36).substring(2, 9)
      const agentId = `${projectName}-${hash}`
      const suffix = request.shortName ? this.sanitizeBranch(request.shortName) : this.sanitizeBranch(request.prompt.split(/\s+/).slice(0, 3).join('-')) || 'handoff'
      const branch = `feature/${agentId}/${suffix}`
      const baseBranch = request.branchMode === 'inherit' ? sourceInfo.branch : await this.getDefaultBranch(projectPath)
      const worktreePath = join(dirname(projectPath), agentId)

      const modeDesc = request.branchMode === 'inherit'
        ? `You are continuing work from branch \`${sourceInfo.branch}\`.`
        : `You are starting fresh from ${baseBranch}, related to prior work on \`${sourceInfo.branch}\`.`
      const context = `## Handoff Context\n\n${modeDesc}\nParent agent was working on: ${sourceInfo.feature || sourceInfo.prompt?.substring(0, 150) || 'parent agent work'}\n\n---\n\n`

      const now = new Date().toISOString()
      const newInfo: AgentInfo = {
        id: `${agentId}-${Date.now()}`, agentId, branch, project: projectName,
        feature: request.prompt.substring(0, 100), status: 'active',
        tool: request.tool || sourceInfo.tool, model: request.model || sourceInfo.model,
        mode: 'dev', yolo: request.yolo ?? sourceInfo.yolo, chrome: (request.chrome ?? sourceInfo.chrome) !== false,
        prompt: context + request.prompt, parentAgentId: request.sourceAgentId,
        handoffSource: { agentId: request.sourceAgentId, branchMode: request.branchMode, originalBranch: sourceInfo.branch, handoffTimestamp: now },
        createdAt: now, lastActivity: now
      }

      const configPath = this.getConfigPath(projectPath)
      const setupScript = join(this.minionsPath, 'bin', 'setup.sh')
      const setupArgs = request.branchMode === 'inherit'
        ? [agentId, branch, baseBranch, '--config', configPath]
        : [agentId, branch, '--config', configPath]

      await execFileAsync(setupScript, setupArgs, { cwd: projectPath })
      this.writeAgentInfo(worktreePath, newInfo)
      try { await this.gitCommit(worktreePath, 'Worktree setup files') } catch { /* ok */ }
      this.sessions.set(agentId, { worktreePath, projectPath })
      return { success: true, newAgent: newInfo }
    } catch (e: any) {
      return { success: false, error: `Handoff failed: ${e.message}` }
    }
  }

  // --- Super minion spawn ---

  async spawnSuperMinion(
    projectPath: string, plan: string, workflowId: string,
    sourceAgentId: string, batchId: string, shortName?: string
  ): Promise<SpawnResult> {
    try {
      const projectName = this.getProjectName(projectPath)
      const baseBranch = await this.getDefaultBranch(projectPath)
      const sourceWorktree = join(dirname(projectPath), sourceAgentId)
      const sourceInfo = this.readAgentInfo(sourceWorktree)

      const hash = Math.random().toString(36).substring(2, 9)
      const agentId = `${projectName}-${hash}`
      const branch = `feature/${agentId}/${shortName ? this.sanitizeBranch(shortName) : `super-${hash}`}`
      const worktreePath = join(dirname(projectPath), agentId)
      const now = new Date().toISOString()

      const info: AgentInfo = {
        id: `${agentId}-${Date.now()}`, agentId, branch, project: projectName,
        feature: plan.substring(0, 100), status: 'active', tool: 'claude', mode: 'planning',
        yolo: sourceInfo?.yolo ?? false, chrome: true, prompt: plan,
        spawnSource: { parentAgentId: sourceAgentId, spawnTimestamp: now, workflowId, batchId },
        createdAt: now, lastActivity: now
      }

      const release = await this.worktreeMutex.acquire()
      try {
        const configPath = this.getConfigPath(projectPath)
        const setupScript = join(this.minionsPath, 'bin', 'setup.sh')
        await execFileAsync(setupScript, [agentId, branch, baseBranch, '--config', configPath], { cwd: projectPath })
        this.writeAgentInfo(worktreePath, info)
        try { await this.gitCommit(worktreePath, 'Worktree setup files') } catch { /* ok */ }
      } finally { release() }

      this.sessions.set(agentId, { worktreePath, projectPath })
      return { success: true, agentId, workflowId }
    } catch (e: any) {
      return { success: false, error: `Failed to spawn: ${e.message}` }
    }
  }

  // --- Teardown ---

  async teardownAgent(projectPath: string, agentId: string, force = false): Promise<void> {
    const configPath = this.getConfigPath(projectPath)
    const teardownScript = join(this.minionsPath, 'bin', 'teardown.sh')
    const args = [agentId, '--config', configPath]
    if (force) args.push('--force')
    try {
      await execFileAsync(teardownScript, args, { cwd: projectPath })
      this.sessions.delete(agentId)
    } catch (e: any) {
      if (e.stdout?.includes('uncommitted changes')) {
        throw new Error('Agent has uncommitted changes. Use force teardown to proceed.')
      }
      throw new Error(`Failed to teardown agent: ${e.message}`)
    }
  }

  getWorktreePath(projectPath: string, agentId: string): string {
    if (agentId.endsWith('-base')) return resolve(projectPath)
    const projectName = this.getProjectName(projectPath)
    const name = agentId.startsWith(`${projectName}-`) ? agentId : `${projectName}-${agentId}`
    return resolve(join(projectPath, '..', name))
  }
}
