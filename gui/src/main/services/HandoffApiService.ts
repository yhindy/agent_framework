import * as http from 'http'
import { createLogger } from './logger'
import type { AgentService } from './AgentService'
import type { TerminalService } from './TerminalService'
import type { ProjectService } from './ProjectService'
import type { HandoffRequest } from './types/ProjectConfig'
import type { BrowserWindow } from 'electron'

const log = createLogger('HandoffApiService')

// Port chosen to avoid conflicts with common development ports
const HANDOFF_API_PORT = 19234

/**
 * API request body for handoff endpoint
 */
export interface HandoffApiRequest {
  sourceAgentId: string
  plan: string
  branchMode: 'inherit' | 'fresh'
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
  private mainWindow: BrowserWindow | null = null

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
   * Set the main window for sending IPC events
   */
  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Start the HTTP server
   */
  start(): void {
    if (this.server) {
      log.warn('HandoffApiService already started')
      return
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        log.error(`Port ${HANDOFF_API_PORT} is already in use. Handoff API will not be available.`)
      } else {
        log.error('HandoffApiService server error:', error)
      }
    })

    // Bind only to localhost for security
    this.server.listen(HANDOFF_API_PORT, '127.0.0.1', () => {
      log.info(`HandoffApiService listening on http://127.0.0.1:${HANDOFF_API_PORT}`)
    })
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.server) {
      this.server.close((err) => {
        if (err) {
          log.error('Error stopping HandoffApiService:', err)
        } else {
          log.info('HandoffApiService stopped')
        }
      })
      this.server = null
    }
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
    this.sendJson(res, 200, { status: 'ok', port: HANDOFF_API_PORT })
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

      // Create the handoff request
      const handoffRequest: HandoffRequest = {
        sourceAgentId: request.sourceAgentId,
        prompt: request.plan,
        branchMode: request.branchMode,
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
        if (this.terminalService && result.newAgent.prompt) {
          setTimeout(async () => {
            try {
              await this.terminalService!.startAgent(
                projectPath!,
                result.newAgent!.agentId,
                result.newAgent!.tool,
                result.newAgent!.mode,
                result.newAgent!.prompt,
                result.newAgent!.model,
                result.newAgent!.yolo,
                result.newAgent!.chrome !== false
              )
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('agents:updated')
              }
            } catch (error) {
              log.error('Failed to auto-start handoff agent', error)
            }
          }, 2000) // Wait for worktree setup
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
   * Validate handoff request
   */
  private validateRequest(request: HandoffApiRequest): { valid: boolean; error?: string } {
    if (!request.sourceAgentId) {
      return { valid: false, error: 'Missing required field: sourceAgentId' }
    }

    if (!request.plan) {
      return { valid: false, error: 'Missing required field: plan' }
    }

    if (!request.branchMode) {
      return { valid: false, error: 'Missing required field: branchMode' }
    }

    if (request.branchMode !== 'inherit' && request.branchMode !== 'fresh') {
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
   * Get the port the server is listening on
   */
  getPort(): number {
    return HANDOFF_API_PORT
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}
