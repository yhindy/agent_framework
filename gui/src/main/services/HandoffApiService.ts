import * as http from 'http'
import { join, dirname } from 'path'
import { mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { createLogger } from './logger'
import type { AgentService } from './AgentService'
import type { TerminalService } from './TerminalService'
import type { ProjectService } from './ProjectService'
import type { WorkflowService } from './WorkflowService'
import type { HandoffRequest, SpawnResult, SpawnSuperResponse } from './types/ProjectConfig'
import type { BrowserWindow } from 'electron'

const log = createLogger('HandoffApiService')

// Port chosen to avoid conflicts with common development ports
const DEFAULT_HANDOFF_API_PORT = 19234

// Maximum number of spawns allowed per request
const MAX_SPAWNS_PER_REQUEST = 10

/**
 * API request body for handoff endpoint.
 * Note: branchMode is optional - if not provided, it will be auto-detected from the plan text.
 */
export interface HandoffApiRequest {
  sourceAgentId: string
  plan: string
  branchMode?: 'inherit' | 'fresh'  // Optional: auto-detected from plan if not provided
  shortName?: string
}

/**
 * API response for handoff endpoint
 */
export interface HandoffApiResponse {
  success: boolean
  newAgentId?: string
  error?: string
}

/**
 * Single spawn request within a batch
 */
export interface SpawnRequest {
  plan: string                  // Work description/plan for the super minion
  workflowId?: string           // Optional: specific workflow (auto-detected if omitted)
  shortName?: string            // Optional: custom branch suffix
}

/**
 * API request body for spawn-super endpoint
 */
export interface SpawnSuperApiRequest {
  sourceAgentId: string         // ID of the agent initiating spawns
  spawns: SpawnRequest[]        // Array of spawn requests (parallel execution)
}

/**
 * HandoffApiService provides a local HTTP API for agents to trigger handoffs.
 *
 * This allows Claude Code commands to create handoff agents without relying on
 * signal detection in stdout, providing a more robust and decoupled mechanism.
 *
 * The server binds only to localhost (127.0.0.1) for security.
 */
export class HandoffApiService {
  private server: http.Server | null = null
  private agentService: AgentService | null = null
  private terminalService: TerminalService | null = null
  private projectService: ProjectService | null = null
  private workflowService: WorkflowService | null = null
  private mainWindow: BrowserWindow | null = null
  private port: number = DEFAULT_HANDOFF_API_PORT
  private activePort: number | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount: number = 0
  private portFilePaths: string[] = []
  private static readonly MAX_RETRIES = 3
  private static readonly RETRY_DELAY_MS = 2000

  /**
   * Set the port to use (for testing)
   */
  setPort(port: number): void {
    this.port = port
  }

  /**
   * Set the AgentService dependency
   */
  setAgentService(service: AgentService): void {
    this.agentService = service
  }

  /**
   * Set the TerminalService dependency
   */
  setTerminalService(service: TerminalService): void {
    this.terminalService = service
  }

  /**
   * Set the ProjectService dependency
   */
  setProjectService(service: ProjectService): void {
    this.projectService = service
  }

  /**
   * Set the WorkflowService dependency (for workflow detection)
   */
  setWorkflowService(service: WorkflowService): void {
    this.workflowService = service
  }

  /**
   * Set the main window for sending IPC events
   */
  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Start the HTTP server. Tries the default port first, retries on conflict,
   * then falls back to an OS-assigned port for multi-instance support.
   */
  start(portOverride?: number): void {
    if (this.server) {
      log.warn('HandoffApiService already started')
      return
    }

    const bindPort = portOverride ?? this.port

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        this.server = null
        if (this.retryCount < HandoffApiService.MAX_RETRIES) {
          this.retryCount++
          log.warn(`Port ${bindPort} in use, retrying in ${HandoffApiService.RETRY_DELAY_MS}ms (attempt ${this.retryCount}/${HandoffApiService.MAX_RETRIES})`)
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            this.start()
          }, HandoffApiService.RETRY_DELAY_MS)
        } else {
          // Fall back to OS-assigned port for multi-instance support
          log.warn(`Port ${this.port} unavailable after ${HandoffApiService.MAX_RETRIES} retries, using OS-assigned port`)
          this.retryCount = 0
          this.start(0)
        }
      } else {
        log.error('HandoffApiService server error:', error)
        this.server = null
      }
    })

    // Bind only to localhost for security
    this.server.listen(bindPort, '127.0.0.1', () => {
      const addr = this.server!.address()
      this.activePort = typeof addr === 'object' && addr ? addr.port : bindPort
      this.retryCount = 0
      log.info(`HandoffApiService listening on http://127.0.0.1:${this.activePort}`)
      this.writePortFiles()
    })
  }

  /**
   * Stop the HTTP server
   */
  stop(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.retryCount = 0
    this.cleanupPortFiles()
    this.activePort = null
    return new Promise((resolve) => {
      if (this.server) {
        const server = this.server
        this.server = null
        server.close((err) => {
          if (err) {
            log.error('Error stopping HandoffApiService:', err)
          } else {
            log.info('HandoffApiService stopped')
          }
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Set CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Route requests
    if (req.method === 'POST' && req.url === '/api/handoff') {
      this.handleHandoff(req, res)
    } else if (req.method === 'POST' && req.url === '/api/spawn-super') {
      this.handleSpawnSuper(req, res)
    } else if (req.method === 'GET' && req.url === '/api/health') {
      this.handleHealth(req, res)
    } else {
      this.sendJson(res, 404, { error: 'Not found' })
    }
  }

  /**
   * Handle health check endpoint
   */
  private handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
    this.sendJson(res, 200, { status: 'ok', port: this.getPort() })
  }

  /**
   * Handle handoff endpoint
   */
  private async handleHandoff(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Parse request body
      const body = await this.readBody(req)
      let request: HandoffApiRequest

      try {
        request = JSON.parse(body)
      } catch {
        this.sendJson(res, 400, { success: false, error: 'Invalid JSON body' })
        return
      }

      // Validate request
      const validation = this.validateRequest(request)
      if (!validation.valid) {
        this.sendJson(res, 400, { success: false, error: validation.error })
        return
      }

      // Check required services
      if (!this.agentService || !this.projectService) {
        this.sendJson(res, 503, { success: false, error: 'Service not ready' })
        return
      }

      // Find project for the source agent
      const activeProjectPaths = this.projectService.getActiveProjects().map(p => p.path)
      let projectPath: string | null = null

      try {
        projectPath = await this.agentService.findProjectForAgent(activeProjectPaths, request.sourceAgentId)
      } catch (error) {
        this.sendJson(res, 404, {
          success: false,
          error: `Source agent '${request.sourceAgentId}' not found in any active project`
        })
        return
      }

      // Auto-detect branchMode from plan text if not explicitly provided
      const branchMode = request.branchMode ?? this.detectBranchMode(request.plan)
      log.info(`Handoff branchMode: ${branchMode} (explicit: ${request.branchMode !== undefined})`)

      // Create the handoff request
      const handoffRequest: HandoffRequest = {
        sourceAgentId: request.sourceAgentId,
        prompt: request.plan,
        branchMode: branchMode,
        shortName: request.shortName
      }

      // Execute the handoff
      log.info(`Processing handoff request from agent ${request.sourceAgentId}`)
      const result = await this.agentService.handoffAgent(projectPath, handoffRequest)

      if (result.success && result.newAgent) {
        // Trigger UI updates
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('agents:updated')
          this.mainWindow.webContents.send('assignments:updated')
        }

        // Auto-start the new agent
        if (result.newAgent.prompt) {
          this.scheduleAgentAutoStart(
            projectPath!,
            result.newAgent.agentId,
            result.newAgent.tool,
            result.newAgent.mode,
            result.newAgent.prompt,
            result.newAgent.model,
            result.newAgent.yolo,
            result.newAgent.chrome !== false
          )
        }

        const response: HandoffApiResponse = {
          success: true,
          newAgentId: result.newAgent.agentId
        }
        this.sendJson(res, 200, response)
      } else {
        const response: HandoffApiResponse = {
          success: false,
          error: result.error || 'Unknown error creating handoff agent'
        }
        this.sendJson(res, 500, response)
      }
    } catch (error) {
      log.error('Handoff API error:', error)
      const response: HandoffApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
      this.sendJson(res, 500, response)
    }
  }

  /**
   * Handle spawn-super endpoint for batch super minion creation
   */
  private async handleSpawnSuper(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = Date.now()
    let batchId = ''

    try {
      // Parse request body
      const body = await this.readBody(req)
      let request: SpawnSuperApiRequest

      try {
        request = JSON.parse(body)
      } catch {
        this.sendJson(res, 400, { success: false, error: 'Invalid JSON body' })
        return
      }

      // Generate batch ID for tracking
      batchId = `batch-${Date.now()}`

      // Validate request
      const validation = this.validateSpawnSuperRequest(request)
      if (!validation.valid) {
        this.sendJson(res, 400, {
          success: false,
          partialSuccess: false,
          results: [],
          batchId,
          totalRequested: request.spawns?.length || 0,
          totalSucceeded: 0,
          totalFailed: request.spawns?.length || 0,
          error: validation.error
        })
        return
      }

      // Check required services
      if (!this.agentService || !this.projectService || !this.workflowService) {
        this.sendJson(res, 503, {
          success: false,
          partialSuccess: false,
          results: [],
          batchId,
          totalRequested: request.spawns.length,
          totalSucceeded: 0,
          totalFailed: request.spawns.length,
          error: 'Service not ready'
        })
        return
      }

      // Find project for the source agent
      const activeProjectPaths = this.projectService.getActiveProjects().map(p => p.path)
      let projectPath: string | null = null

      try {
        projectPath = await this.agentService.findProjectForAgent(activeProjectPaths, request.sourceAgentId)
      } catch (error) {
        this.sendJson(res, 404, {
          success: false,
          partialSuccess: false,
          results: [],
          batchId,
          totalRequested: request.spawns.length,
          totalSucceeded: 0,
          totalFailed: request.spawns.length,
          error: `Source agent '${request.sourceAgentId}' not found in any active project`
        })
        return
      }

      log.info('Spawn batch initiated', {
        batchId,
        sourceAgentId: request.sourceAgentId,
        spawnCount: request.spawns.length,
        workflowIds: request.spawns.map(s => s.workflowId || 'auto-detect')
      })

      // Process spawns in parallel using Promise.allSettled
      const spawnPromises = request.spawns.map(async (spawn, index) => {
        // Auto-detect workflow if not specified
        const detectedWorkflow = spawn.workflowId
          ? { workflowId: spawn.workflowId, confidence: 'high' as const }
          : this.workflowService!.detectWorkflowFromPlan(spawn.plan)

        const workflowId = detectedWorkflow.workflowId

        // Verify workflow exists
        const workflow = this.workflowService!.getWorkflow(workflowId)
        if (!workflow) {
          return {
            success: false,
            error: `Workflow '${workflowId}' not found`
          } as SpawnResult
        }

        log.debug('Spawning super minion', {
          batchId,
          index,
          workflowId,
          shortName: spawn.shortName
        })

        // Spawn the super minion
        return this.agentService!.spawnSuperMinion(
          projectPath!,
          spawn.plan,
          workflowId,
          request.sourceAgentId,
          batchId,
          spawn.shortName
        )
      })

      // Wait for all spawns to complete (success or failure)
      const settledResults = await Promise.allSettled(spawnPromises)

      // Process results
      const results: SpawnResult[] = settledResults.map((settled) => {
        if (settled.status === 'fulfilled') {
          return settled.value
        } else {
          return {
            success: false,
            error: settled.reason?.message || 'Unknown error'
          }
        }
      })

      const totalSucceeded = results.filter(r => r.success).length
      const totalFailed = results.filter(r => !r.success).length
      const allSucceeded = totalFailed === 0
      const partialSuccess = totalSucceeded > 0 && totalFailed > 0

      const durationMs = Date.now() - startTime
      log.info('Spawn batch completed', {
        batchId,
        totalSucceeded,
        totalFailed,
        durationMs
      })

      // Trigger UI updates
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('agents:updated')
        this.mainWindow.webContents.send('assignments:updated')
        this.mainWindow.webContents.send('agents:superSpawned', { batchId, results })
      }

      // Auto-start successfully spawned agents, inheriting yolo/chrome from spawned agent info
      results.forEach((result, i) => {
        if (result.success && result.agentId) {
          const spawnedWorktree = join(dirname(projectPath!), result.agentId)
          const spawnedInfo = this.agentService!.readAgentInfo(spawnedWorktree)
          this.scheduleAgentAutoStart(
            projectPath!,
            result.agentId,
            'claude',
            'planning',
            request.spawns[i].plan,
            undefined, // model
            spawnedInfo?.yolo ?? false,
            spawnedInfo?.chrome ?? true
          )
        }
      })

      const response: SpawnSuperResponse = {
        success: allSucceeded,
        partialSuccess,
        results,
        batchId,
        totalRequested: request.spawns.length,
        totalSucceeded,
        totalFailed
      }

      this.sendJson(res, allSucceeded ? 200 : (partialSuccess ? 207 : 500), response)
    } catch (error) {
      log.error('Spawn-super API error:', error)
      this.sendJson(res, 500, {
        success: false,
        partialSuccess: false,
        results: [],
        batchId,
        totalRequested: 0,
        totalSucceeded: 0,
        totalFailed: 0,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Validate spawn-super request
   */
  private validateSpawnSuperRequest(request: SpawnSuperApiRequest): { valid: boolean; error?: string } {
    if (!request.sourceAgentId) {
      return { valid: false, error: 'Missing required field: sourceAgentId' }
    }

    if (!request.spawns || !Array.isArray(request.spawns)) {
      return { valid: false, error: 'spawns must be an array' }
    }

    if (request.spawns.length === 0) {
      return { valid: false, error: 'spawns array must not be empty' }
    }

    if (request.spawns.length > MAX_SPAWNS_PER_REQUEST) {
      return { valid: false, error: `Maximum ${MAX_SPAWNS_PER_REQUEST} spawns per request` }
    }

    // Validate each spawn
    for (let i = 0; i < request.spawns.length; i++) {
      const spawn = request.spawns[i]
      if (!spawn.plan || typeof spawn.plan !== 'string') {
        return { valid: false, error: `Spawn ${i}: Each spawn must have a plan` }
      }
      if (spawn.workflowId && typeof spawn.workflowId !== 'string') {
        return { valid: false, error: `Spawn ${i}: workflowId must be a string` }
      }
    }

    return { valid: true }
  }

  /**
   * Validate handoff request.
   * Note: branchMode is optional and will be auto-detected if not provided.
   */
  private validateRequest(request: HandoffApiRequest): { valid: boolean; error?: string } {
    if (!request.sourceAgentId) {
      return { valid: false, error: 'Missing required field: sourceAgentId' }
    }

    if (!request.plan) {
      return { valid: false, error: 'Missing required field: plan' }
    }

    const validBranchModes = ['inherit', 'fresh'] as const
    const branchModeProvided = request.branchMode !== undefined
    const branchModeInvalid = branchModeProvided && !validBranchModes.includes(request.branchMode!)

    if (branchModeInvalid) {
      return { valid: false, error: 'branchMode must be "inherit" or "fresh"' }
    }

    return { valid: true }
  }

  /**
   * Read request body
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  /**
   * Send JSON response
   */
  private sendJson(res: http.ServerResponse, statusCode: number, data: object): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  /**
   * Auto-detect branch mode from prompt/plan language.
   * Returns 'fresh' if prompt contains clean start indicators, 'inherit' otherwise.
   */
  detectBranchMode(prompt: string): 'inherit' | 'fresh' {
    const cleanStartPatterns = [
      /clean\s+start/i,
      /fresh\s+start/i,
      /start\s+fresh/i,
      /from\s+scratch/i,
      /new\s+baseline/i,
      /clean\s+slate/i,
      /fresh\s+branch/i,
      /branch\s+from\s+main/i,
      /branch\s+from\s+master/i,
      /start\s+over/i,
    ]

    const matchedPattern = cleanStartPatterns.find(pattern => pattern.test(prompt))
    if (matchedPattern) {
      log.info(`Detected 'fresh' branch mode from prompt pattern: ${matchedPattern}`)
      return 'fresh'
    }

    return 'inherit'
  }

  /**
   * Get the port the server is actually listening on (may differ from default if fallback was used)
   */
  getPort(): number {
    return this.activePort ?? this.port
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  /**
   * Write the active port to .minions/api-port in each active project directory.
   * Agents read this file to discover which port to connect to.
   */
  private writePortFiles(): void {
    if (!this.activePort || !this.projectService) return

    const projects = this.projectService.getActiveProjects()
    this.portFilePaths = []

    for (const project of projects) {
      try {
        const minionsDir = join(project.path, '.minions')
        mkdirSync(minionsDir, { recursive: true })
        const portFilePath = join(minionsDir, 'api-port')
        writeFileSync(portFilePath, String(this.activePort))
        this.portFilePaths.push(portFilePath)
      } catch (err) {
        log.warn(`Failed to write port file for project ${project.path}:`, err)
      }
    }

    if (this.portFilePaths.length > 0) {
      log.info(`Wrote api-port file to ${this.portFilePaths.length} project(s)`)
    }
  }

  /**
   * Remove port files written by writePortFiles
   */
  private cleanupPortFiles(): void {
    for (const filePath of this.portFilePaths) {
      try {
        unlinkSync(filePath)
      } catch {
        // File may already be gone
      }
    }
    this.portFilePaths = []
  }

  /**
   * Schedule auto-start of an agent after worktree setup.
   * Encapsulates the common pattern of waiting then starting the agent.
   */
  private scheduleAgentAutoStart(
    projectPath: string,
    agentId: string,
    tool: string,
    mode: string,
    prompt?: string,
    model?: string,
    yolo?: boolean,
    chrome?: boolean
  ): void {
    if (!this.terminalService) return

    setTimeout(async () => {
      try {
        await this.terminalService!.startAgent(
          projectPath,
          agentId,
          tool,
          mode,
          prompt,
          model,
          yolo ?? false,
          chrome ?? true
        )
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('agents:updated')
        }
      } catch (error) {
        log.error(`Failed to auto-start agent ${agentId}`, error)
      }
    }, 2000)
  }
}
