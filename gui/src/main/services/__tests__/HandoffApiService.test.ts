import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HandoffApiService, HandoffApiRequest } from '../HandoffApiService'
import type { AgentService } from '../AgentService'
import type { TerminalService } from '../TerminalService'
import type { ProjectService } from '../ProjectService'
import type { HandoffResult, AgentInfo } from '../types/ProjectConfig'
import * as http from 'http'

// Mock the logger
vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('HandoffApiService', () => {
  let service: HandoffApiService
  let mockAgentService: Partial<AgentService>
  let mockTerminalService: Partial<TerminalService>
  let mockProjectService: Partial<ProjectService>
  let mockMainWindow: any

  const mockAgentInfo: AgentInfo = {
    id: 'test-123-1234567890',
    agentId: 'test-123',
    branch: 'feature/test-123/test',
    project: 'test-project',
    feature: 'Test feature',
    status: 'active',
    tool: 'claude',
    model: 'opus',
    mode: 'dev',
    prompt: 'Test prompt',
    createdAt: '2024-01-01T10:00:00.000Z',
    lastActivity: '2024-01-01T12:00:00.000Z'
  }

  beforeEach(() => {
    service = new HandoffApiService()

    // Setup mock services
    mockAgentService = {
      findProjectForAgent: vi.fn().mockResolvedValue('/test/project'),
      handoffAgent: vi.fn().mockResolvedValue({
        success: true,
        newAgent: {
          ...mockAgentInfo,
          agentId: 'new-agent-456',
          handoffSource: {
            agentId: 'test-123',
            branchMode: 'inherit',
            originalBranch: 'feature/test-123/test',
            handoffTimestamp: new Date().toISOString()
          }
        }
      } as HandoffResult)
    }

    mockTerminalService = {
      startAgent: vi.fn().mockResolvedValue(undefined)
    }

    mockProjectService = {
      getActiveProjects: vi.fn().mockReturnValue([
        { path: '/test/project', name: 'test-project' }
      ])
    }

    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn()
      }
    }

    service.setAgentService(mockAgentService as AgentService)
    service.setTerminalService(mockTerminalService as TerminalService)
    service.setProjectService(mockProjectService as ProjectService)
    service.setWindow(mockMainWindow)
  })

  afterEach(() => {
    service.stop()
    vi.clearAllMocks()
  })

  describe('validateRequest', () => {
    it('should return valid for complete request', () => {
      const request: HandoffApiRequest = {
        sourceAgentId: 'test-agent-123',
        plan: 'Implement the feature',
        branchMode: 'inherit'
      }

      const result = (service as any).validateRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should return invalid for missing sourceAgentId', () => {
      const request = {
        plan: 'Implement the feature',
        branchMode: 'inherit'
      } as HandoffApiRequest

      const result = (service as any).validateRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('sourceAgentId')
    })

    it('should return invalid for missing plan', () => {
      const request = {
        sourceAgentId: 'test-agent-123',
        branchMode: 'inherit'
      } as HandoffApiRequest

      const result = (service as any).validateRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('plan')
    })

    it('should accept missing branchMode (will be auto-detected)', () => {
      const request = {
        sourceAgentId: 'test-agent-123',
        plan: 'Implement the feature'
      } as HandoffApiRequest

      const result = (service as any).validateRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should return invalid for invalid branchMode', () => {
      const request = {
        sourceAgentId: 'test-agent-123',
        plan: 'Implement the feature',
        branchMode: 'invalid' as any
      }

      const result = (service as any).validateRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('inherit')
    })

    it('should accept valid request with optional shortName', () => {
      const request: HandoffApiRequest = {
        sourceAgentId: 'test-agent-123',
        plan: 'Implement the feature',
        branchMode: 'fresh',
        shortName: 'custom-branch'
      }

      const result = (service as any).validateRequest(request)
      expect(result.valid).toBe(true)
    })
  })

  describe('detectBranchMode', () => {
    it('should return inherit for normal prompts', () => {
      const result = service.detectBranchMode('Continue implementing the feature')
      expect(result).toBe('inherit')
    })

    it('should detect clean start', () => {
      const result = service.detectBranchMode('Start with a clean start to fix the architecture')
      expect(result).toBe('fresh')
    })

    it('should detect fresh start', () => {
      const result = service.detectBranchMode('Fresh start on this implementation')
      expect(result).toBe('fresh')
    })

    it('should detect from scratch', () => {
      const result = service.detectBranchMode('Rebuild the module from scratch')
      expect(result).toBe('fresh')
    })

    it('should detect new baseline', () => {
      const result = service.detectBranchMode('Create a new baseline for the feature')
      expect(result).toBe('fresh')
    })

    it('should detect clean slate', () => {
      const result = service.detectBranchMode('Start with a clean slate')
      expect(result).toBe('fresh')
    })

    it('should detect fresh branch', () => {
      const result = service.detectBranchMode('Create a fresh branch for this work')
      expect(result).toBe('fresh')
    })

    it('should detect branch from main', () => {
      const result = service.detectBranchMode('Branch from main to implement this')
      expect(result).toBe('fresh')
    })

    it('should detect branch from master', () => {
      const result = service.detectBranchMode('Branch from master for this fix')
      expect(result).toBe('fresh')
    })

    it('should detect start over', () => {
      const result = service.detectBranchMode('We need to start over on this feature')
      expect(result).toBe('fresh')
    })

    it('should be case insensitive', () => {
      const result = service.detectBranchMode('CLEAN START on the refactoring')
      expect(result).toBe('fresh')
    })
  })

  describe('server lifecycle', () => {
    it('should start and stop the server', () => {
      expect(service.isRunning()).toBe(false)

      service.start()

      // Give the server time to start
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(service.isRunning()).toBe(true)
          expect(service.getPort()).toBe(19234)

          service.stop()

          setTimeout(() => {
            expect(service.isRunning()).toBe(false)
            resolve()
          }, 100)
        }, 100)
      })
    })

    it('should not start if already started', () => {
      service.start()

      // Try to start again - should not create duplicate server
      service.start()

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(service.isRunning()).toBe(true)
          service.stop()
          resolve()
        }, 100)
      })
    })
  })

  describe('HTTP endpoints', () => {
    beforeEach(() => {
      return new Promise<void>((resolve) => {
        service.start()
        setTimeout(resolve, 100)
      })
    })

    afterEach(() => {
      service.stop()
    })

    const makeRequest = (
      method: string,
      path: string,
      body?: object
    ): Promise<{ statusCode: number; body: any }> => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 19234,
          path,
          method,
          headers: {
            'Content-Type': 'application/json'
          }
        }

        const req = http.request(options, (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              resolve({
                statusCode: res.statusCode || 500,
                body: data ? JSON.parse(data) : null
              })
            } catch {
              resolve({
                statusCode: res.statusCode || 500,
                body: data
              })
            }
          })
        })

        req.on('error', reject)

        if (body) {
          req.write(JSON.stringify(body))
        }

        req.end()
      })
    }

    it('should respond to health check', async () => {
      const response = await makeRequest('GET', '/api/health')

      expect(response.statusCode).toBe(200)
      expect(response.body.status).toBe('ok')
      expect(response.body.port).toBe(19234)
    })

    it('should return 404 for unknown routes', async () => {
      const response = await makeRequest('GET', '/api/unknown')

      expect(response.statusCode).toBe(404)
      expect(response.body.error).toBe('Not found')
    })

    it('should handle valid handoff request', async () => {
      const request: HandoffApiRequest = {
        sourceAgentId: 'test-123',
        plan: 'Implement the authentication feature',
        branchMode: 'inherit'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.newAgentId).toBe('new-agent-456')

      // Verify AgentService was called correctly
      expect(mockAgentService.findProjectForAgent).toHaveBeenCalledWith(
        ['/test/project'],
        'test-123'
      )
      expect(mockAgentService.handoffAgent).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          sourceAgentId: 'test-123',
          prompt: 'Implement the authentication feature',
          branchMode: 'inherit'
        })
      )
    })

    it('should handle handoff request with shortName', async () => {
      const request: HandoffApiRequest = {
        sourceAgentId: 'test-123',
        plan: 'Implement the feature',
        branchMode: 'fresh',
        shortName: 'my-custom-branch'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(200)
      expect(mockAgentService.handoffAgent).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          shortName: 'my-custom-branch'
        })
      )
    })

    it('should return 400 for missing sourceAgentId', async () => {
      const request = {
        plan: 'Implement the feature',
        branchMode: 'inherit'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('sourceAgentId')
    })

    it('should return 400 for missing plan', async () => {
      const request = {
        sourceAgentId: 'test-123',
        branchMode: 'inherit'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('plan')
    })

    it('should auto-detect branchMode when not provided', async () => {
      // Request without branchMode - should auto-detect as 'inherit'
      const request = {
        sourceAgentId: 'test-123',
        plan: 'Continue implementing the feature'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(200)
      expect(mockAgentService.handoffAgent).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          branchMode: 'inherit'  // Auto-detected as inherit since no clean start phrases
        })
      )
    })

    it('should auto-detect fresh branchMode from clean start phrase', async () => {
      // Request without branchMode but with clean start phrase
      const request = {
        sourceAgentId: 'test-123',
        plan: 'Start with a clean start to reimplement the feature'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(200)
      expect(mockAgentService.handoffAgent).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          branchMode: 'fresh'  // Auto-detected as fresh due to 'clean start' phrase
        })
      )
    })

    it('should return 400 for invalid branchMode', async () => {
      const request = {
        sourceAgentId: 'test-123',
        plan: 'Implement the feature',
        branchMode: 'invalid'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('branchMode')
    })

    it('should return 400 for invalid JSON body', async () => {
      const response = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 19234,
          path: '/api/handoff',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }

        const req = http.request(options, (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 500,
              body: JSON.parse(data)
            })
          })
        })

        req.on('error', reject)
        req.write('not valid json')
        req.end()
      })

      expect(response.statusCode).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('Invalid JSON')
    })

    it('should return 404 when source agent not found', async () => {
      mockAgentService.findProjectForAgent = vi.fn().mockRejectedValue(
        new Error('Agent not found')
      )

      const request: HandoffApiRequest = {
        sourceAgentId: 'nonexistent-agent',
        plan: 'Implement the feature',
        branchMode: 'inherit'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(404)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('not found')
    })

    it('should return 500 when handoff fails', async () => {
      mockAgentService.handoffAgent = vi.fn().mockResolvedValue({
        success: false,
        error: 'Setup script failed'
      })

      const request: HandoffApiRequest = {
        sourceAgentId: 'test-123',
        plan: 'Implement the feature',
        branchMode: 'inherit'
      }

      const response = await makeRequest('POST', '/api/handoff', request)

      expect(response.statusCode).toBe(500)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('Setup script failed')
    })

    it('should send UI updates on successful handoff', async () => {
      const request: HandoffApiRequest = {
        sourceAgentId: 'test-123',
        plan: 'Implement the feature',
        branchMode: 'inherit'
      }

      await makeRequest('POST', '/api/handoff', request)

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('agents:updated')
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('assignments:updated')
    })

    it('should handle CORS preflight requests', async () => {
      const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 19234,
          path: '/api/handoff',
          method: 'OPTIONS'
        }

        const req = http.request(options, (res) => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers
          })
        })

        req.on('error', reject)
        req.end()
      })

      expect(response.statusCode).toBe(204)
    })
  })

  describe('service not ready', () => {
    beforeEach(() => {
      // Create service without dependencies
      service = new HandoffApiService()

      return new Promise<void>((resolve) => {
        service.start()
        setTimeout(resolve, 100)
      })
    })

    it('should return 503 when services not set', async () => {
      const request: HandoffApiRequest = {
        sourceAgentId: 'test-123',
        plan: 'Implement the feature',
        branchMode: 'inherit'
      }

      const response = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 19234,
          path: '/api/handoff',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }

        const req = http.request(options, (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 500,
              body: JSON.parse(data)
            })
          })
        })

        req.on('error', reject)
        req.write(JSON.stringify(request))
        req.end()
      })

      expect(response.statusCode).toBe(503)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('not ready')
    })
  })

  describe('auto-start new agent', () => {
    beforeEach(() => {
      return new Promise<void>((resolve) => {
        service.start()
        setTimeout(resolve, 100)
      })
    })

    it('should auto-start new agent with prompt', async () => {
      // Use a mock implementation that has a prompt
      const newAgentWithPrompt = {
        ...mockAgentInfo,
        agentId: 'new-agent-456',
        prompt: 'Continue the work',
        tool: 'claude',
        mode: 'dev',
        model: 'opus',
        yolo: false,
        chrome: true,
        handoffSource: {
          agentId: 'test-123',
          branchMode: 'inherit' as const,
          originalBranch: 'feature/test-123/test',
          handoffTimestamp: new Date().toISOString()
        }
      }

      mockAgentService.handoffAgent = vi.fn().mockResolvedValue({
        success: true,
        newAgent: newAgentWithPrompt
      })

      const request: HandoffApiRequest = {
        sourceAgentId: 'test-123',
        plan: 'Continue the work',
        branchMode: 'inherit'
      }

      await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: 19234,
          path: '/api/handoff',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }

        const req = http.request(options, (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 500,
              body: JSON.parse(data)
            })
          })
        })

        req.on('error', reject)
        req.write(JSON.stringify(request))
        req.end()
      })

      // Wait for the setTimeout in the auto-start
      await new Promise((resolve) => setTimeout(resolve, 2500))

      expect(mockTerminalService.startAgent).toHaveBeenCalledWith(
        '/test/project',
        'new-agent-456',
        'claude',
        'dev',
        'Continue the work',
        'opus',
        false,
        true
      )
    })
  })
})
