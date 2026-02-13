import * as http from 'http'
import { createLogger } from './logger'
import type { AgentManager } from './AgentManager'
import type { TerminalManager } from './TerminalManager'
import type { ProjectManager } from './ProjectManager'
import type { WorkflowManager } from './WorkflowManager'
import type { StateManager } from './StateManager'
import type { SpawnResult, HeadlessAgentState } from './types'

const log = createLogger('HeadlessServer')
const MAX_SPAWNS = 10

export interface ServerDependencies {
  agentManager: AgentManager
  terminalManager: TerminalManager
  projectManager: ProjectManager
  workflowManager: WorkflowManager
  stateManager: StateManager
}

export class HeadlessServer {
  private server: http.Server | null = null
  private deps: ServerDependencies
  private port: number
  private activePort: number | null = null

  constructor(deps: ServerDependencies, port?: number) {
    this.deps = deps
    this.port = port ?? 19234
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.server) { resolve(this.activePort!); return }
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') this.server!.listen(0, '127.0.0.1')
        else reject(err)
      })
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address()
        this.activePort = typeof addr === 'object' && addr ? addr.port : this.port
        this.deps.terminalManager.setApiPort(this.activePort)
        log.info(`Headless API server listening on http://127.0.0.1:${this.activePort}`)
        resolve(this.activePort)
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return }
      const s = this.server
      this.server = null; this.activePort = null
      s.close(() => { log.info('Server stopped'); resolve() })
    })
  }

  getPort(): number { return this.activePort ?? this.port }
  isRunning(): boolean { return this.server !== null && this.server.listening }

  // --- Routing ---

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = req.url || '/'
    const method = req.method || 'GET'

    try {
      if (method === 'GET' && url === '/api/health') return this.json(res, 200, { status: 'ok', port: this.getPort(), uptime: process.uptime(), version: '0.1.0' })
      if (method === 'GET' && url === '/api/projects') return this.json(res, 200, { projects: this.deps.projectManager.getActiveProjects() })
      if (method === 'POST' && url === '/api/projects') return await this.handleAddProject(req, res)
      if (method === 'GET' && url.startsWith('/api/agents') && !url.includes('/api/agents/')) return await this.handleListAgents(req, res)
      if (method === 'POST' && url === '/api/agents') return await this.handleCreateAgent(req, res)

      const agentMatch = url.match(/^\/api\/agents\/([^/]+)$/)
      if (agentMatch) {
        const id = decodeURIComponent(agentMatch[1])
        if (method === 'GET') return await this.handleGetAgent(id, res)
        if (method === 'DELETE') return await this.handleDeleteAgent(id, res)
      }

      const stopMatch = url.match(/^\/api\/agents\/([^/]+)\/stop$/)
      if (stopMatch && method === 'POST') { this.deps.terminalManager.stopAgent(decodeURIComponent(stopMatch[1])); return this.json(res, 200, { success: true, message: `Agent ${decodeURIComponent(stopMatch[1])} stopped` }) }

      if (method === 'POST' && url === '/api/handoff') return await this.handleHandoff(req, res)
      if (method === 'POST' && url === '/api/spawn-super') return await this.handleSpawnSuper(req, res)
      if (method === 'GET' && url === '/api/workflows') return this.json(res, 200, { workflows: this.deps.workflowManager.getAllWorkflows() })

      this.json(res, 404, { error: 'Not found' })
    } catch (e: any) {
      log.error('Unhandled error:', e)
      this.json(res, 500, { error: e.message || 'Internal server error' })
    }
  }

  // --- Handlers ---

  private async handleAddProject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    if (!body?.path) return this.json(res, 400, { error: 'Missing required field: path' })
    try {
      const project = await this.deps.projectManager.addProject(body.path)
      try { await this.deps.agentManager.ensureBaseBranchAgent(body.path) } catch { /* ok */ }
      this.json(res, 201, { project })
    } catch (e: any) { this.json(res, 400, { error: e.message }) }
  }

  private async handleListAgents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const projectPath = new URL(req.url || '/', 'http://localhost').searchParams.get('project')
    if (!projectPath) {
      const all: HeadlessAgentState[] = []
      for (const p of this.deps.projectManager.getActiveProjects()) {
        try { all.push(...await this.deps.agentManager.listAgents(p.path)) } catch { /* skip */ }
      }
      return this.json(res, 200, { agents: all })
    }
    try { this.json(res, 200, { agents: await this.deps.agentManager.listAgents(projectPath) }) }
    catch (e: any) { this.json(res, 400, { error: e.message }) }
  }

  private async handleCreateAgent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    if (!body) return this.json(res, 400, { error: 'Invalid JSON body' })
    if (!body.project) return this.json(res, 400, { error: 'Missing required field: project' })
    if (!body.prompt) return this.json(res, 400, { error: 'Missing required field: prompt' })

    const tool = body.tool || 'claude'
    const branch = body.branch || body.shortName || body.prompt.split(/\s+/).slice(0, 3).join('-')

    try {
      const info = await this.deps.agentManager.createAssignment(body.project, {
        branch, feature: body.prompt.substring(0, 100), prompt: body.prompt,
        tool, model: body.model, yolo: body.yolo, mode: 'dev'
      })
      const agent = { id: info.agentId, agentId: info.agentId, projectPath: body.project, status: 'running' as const,
        branch: info.branch, tool: info.tool, model: info.model, prompt: info.prompt, createdAt: info.createdAt, lastActivity: info.lastActivity }

      try { await this.deps.terminalManager.startAgent(body.project, info.agentId, tool, 'dev', body.prompt, body.model, body.yolo) }
      catch (e: any) {
        log.error(`Created agent but failed to start: ${e.message}`)
        return this.json(res, 201, { agent: { ...agent, status: 'failed' as const }, warning: `Agent created but failed to start: ${e.message}` })
      }
      this.json(res, 201, { agent })
    } catch (e: any) { this.json(res, 500, { error: e.message }) }
  }

  private async handleGetAgent(agentId: string, res: http.ServerResponse): Promise<void> {
    for (const p of this.deps.projectManager.getActiveProjects()) {
      const agent = await this.deps.agentManager.getAgent(p.path, agentId)
      if (agent) {
        const isRunning = this.deps.terminalManager.isAgentRunning(agentId)
        return this.json(res, 200, { agent: { ...agent, status: isRunning ? 'running' : agent.status } })
      }
    }
    this.json(res, 404, { error: `Agent ${agentId} not found` })
  }

  private async handleDeleteAgent(agentId: string, res: http.ServerResponse): Promise<void> {
    for (const p of this.deps.projectManager.getActiveProjects()) {
      const agent = await this.deps.agentManager.getAgent(p.path, agentId)
      if (agent) {
        try {
          this.deps.terminalManager.stopAgent(agentId)
          await this.deps.agentManager.teardownAgent(p.path, agentId, true)
          this.deps.stateManager.removeAgent(agentId)
          return this.json(res, 200, { success: true, message: `Agent ${agentId} torn down` })
        } catch (e: any) { return this.json(res, 500, { error: e.message }) }
      }
    }
    this.json(res, 404, { error: `Agent ${agentId} not found` })
  }

  private async handleHandoff(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    if (!body) return this.json(res, 400, { success: false, error: 'Invalid JSON body' })
    if (!body.sourceAgentId) return this.json(res, 400, { success: false, error: 'Missing required field: sourceAgentId' })
    if (!body.plan) return this.json(res, 400, { success: false, error: 'Missing required field: plan' })

    let projectPath: string
    try { projectPath = await this.deps.agentManager.findProjectForAgent(this.deps.projectManager.getActiveProjects().map(p => p.path), body.sourceAgentId) }
    catch { return this.json(res, 404, { success: false, error: `Source agent '${body.sourceAgentId}' not found in any active project` }) }

    const branchMode = body.branchMode ?? this.detectBranchMode(body.plan)
    const result = await this.deps.agentManager.handoffAgent(projectPath, { sourceAgentId: body.sourceAgentId, prompt: body.plan, branchMode, shortName: body.shortName })

    if (result.success && result.newAgent) {
      setTimeout(async () => {
        try { await this.deps.terminalManager.startAgent(projectPath, result.newAgent!.agentId, result.newAgent!.tool, result.newAgent!.mode, result.newAgent!.prompt, result.newAgent!.model, result.newAgent!.yolo, result.newAgent!.chrome !== false) }
        catch (e: any) { log.error(`Failed to auto-start handoff agent: ${e.message}`) }
      }, 2000)
      this.json(res, 200, { success: true, newAgentId: result.newAgent.agentId })
    } else {
      this.json(res, 500, { success: false, error: result.error })
    }
  }

  private async handleSpawnSuper(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req)
    if (!body) return this.json(res, 400, { success: false, error: 'Invalid JSON body' })
    if (!body.sourceAgentId) return this.json(res, 400, { success: false, error: 'Missing required field: sourceAgentId' })
    if (!body.spawns?.length) return this.json(res, 400, { success: false, error: 'spawns must be a non-empty array' })
    if (body.spawns.length > MAX_SPAWNS) return this.json(res, 400, { success: false, error: `Maximum ${MAX_SPAWNS} spawns per request` })

    let projectPath: string
    try { projectPath = await this.deps.agentManager.findProjectForAgent(this.deps.projectManager.getActiveProjects().map(p => p.path), body.sourceAgentId) }
    catch {
      return this.json(res, 404, {
        success: false, partialSuccess: false, results: [], batchId: `batch-${Date.now()}`,
        totalRequested: body.spawns.length, totalSucceeded: 0, totalFailed: body.spawns.length,
        error: `Source agent '${body.sourceAgentId}' not found`
      })
    }

    const batchId = `batch-${Date.now()}`
    const settled = await Promise.allSettled(body.spawns.map(async (spawn: any) => {
      if (!spawn.plan) return { success: false, error: 'Missing plan' } as SpawnResult
      const detected = spawn.workflowId ? { workflowId: spawn.workflowId } : this.deps.workflowManager.detectWorkflowFromPlan(spawn.plan)
      const workflow = this.deps.workflowManager.getWorkflow(detected.workflowId)
      if (!workflow) return { success: false, error: `Workflow '${detected.workflowId}' not found` } as SpawnResult
      return this.deps.agentManager.spawnSuperMinion(projectPath, spawn.plan, detected.workflowId, body.sourceAgentId, batchId, spawn.shortName)
    }))

    const results: SpawnResult[] = settled.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message || 'Unknown error' })
    const ok = results.filter(r => r.success).length
    const fail = results.filter(r => !r.success).length

    for (const r of results) {
      if (r.success && r.agentId) {
        setTimeout(async () => {
          try { await this.deps.terminalManager.startAgent(projectPath, r.agentId!, 'claude', 'planning', undefined, undefined, false, true) }
          catch (e: any) { log.error(`Failed to auto-start spawned agent: ${e.message}`) }
        }, 2000)
      }
    }

    this.json(res, fail === 0 ? 200 : ok > 0 ? 207 : 500, {
      success: fail === 0, partialSuccess: ok > 0 && fail > 0,
      results, batchId, totalRequested: body.spawns.length, totalSucceeded: ok, totalFailed: fail
    })
  }

  // --- Helpers ---

  private detectBranchMode(prompt: string): 'inherit' | 'fresh' {
    const patterns = [/clean\s+start/i, /fresh\s+start/i, /start\s+fresh/i, /from\s+scratch/i,
      /new\s+baseline/i, /clean\s+slate/i, /fresh\s+branch/i, /branch\s+from\s+main/i, /branch\s+from\s+master/i, /start\s+over/i]
    return patterns.some(p => p.test(prompt)) ? 'fresh' : 'inherit'
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => { try { resolve(Buffer.concat(chunks).toString('utf-8') ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : null) } catch { resolve(null) } })
      req.on('error', () => resolve(null))
    })
  }

  private json(res: http.ServerResponse, status: number, data: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
}
