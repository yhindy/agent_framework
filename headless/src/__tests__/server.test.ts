import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as http from 'http'
import { HeadlessServer, ServerDependencies } from '../server'
import type { AgentManager } from '../AgentManager'
import type { TerminalManager } from '../TerminalManager'
import type { ProjectManager } from '../ProjectManager'
import type { WorkflowManager } from '../WorkflowManager'
import type { StateManager } from '../StateManager'

function createMockDeps(): ServerDependencies {
  return {
    agentManager: {
      listAgents: vi.fn().mockResolvedValue([]),
      getAgent: vi.fn().mockResolvedValue(null),
      createAssignment: vi.fn().mockResolvedValue({
        agentId: 'test-agent-1',
        branch: 'feature/test',
        tool: 'claude',
        mode: 'dev',
        prompt: 'test prompt',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }),
      teardownAgent: vi.fn().mockResolvedValue(undefined),
      ensureBaseBranchAgent: vi.fn().mockResolvedValue({}),
      handoffAgent: vi.fn().mockResolvedValue({ success: true, newAgent: { agentId: 'new-agent', tool: 'claude', mode: 'dev' } }),
      spawnSuperMinion: vi.fn().mockResolvedValue({ success: true, agentId: 'super-1', workflowId: 'default' }),
      findProjectForAgent: vi.fn().mockResolvedValue('/test/project'),
      getWorktreePath: vi.fn().mockReturnValue('/test/worktree')
    } as unknown as AgentManager,
    terminalManager: {
      startAgent: vi.fn().mockResolvedValue(undefined),
      stopAgent: vi.fn(),
      isAgentRunning: vi.fn().mockReturnValue(false),
      setApiPort: vi.fn(),
      cleanup: vi.fn()
    } as unknown as TerminalManager,
    projectManager: {
      addProject: vi.fn().mockResolvedValue({ path: '/test/project', name: 'test', lastOpened: new Date().toISOString() }),
      getActiveProjects: vi.fn().mockReturnValue([]),
      getCurrentProject: vi.fn().mockReturnValue(null),
      removeProject: vi.fn(),
      switchProject: vi.fn()
    } as unknown as ProjectManager,
    workflowManager: {
      getAllWorkflows: vi.fn().mockReturnValue([
        { id: 'default', name: 'Standard Workflow', steps: [], isDefault: true },
        { id: 'debug-workflow', name: 'Debug Workflow', steps: [] }
      ]),
      getWorkflow: vi.fn().mockReturnValue({ id: 'default', name: 'Standard', steps: [] }),
      detectWorkflowFromPlan: vi.fn().mockReturnValue({ workflowId: 'default', confidence: 'high' })
    } as unknown as WorkflowManager,
    stateManager: {
      save: vi.fn(),
      getState: vi.fn().mockReturnValue({ projects: [], agents: [], startedAt: new Date().toISOString() }),
      updateAgent: vi.fn(),
      removeAgent: vi.fn(),
      getAgent: vi.fn()
    } as unknown as StateManager
  }
}

function makeRequest(port: number, method: string, path: string, body?: object): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    }

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          resolve({ status: res.statusCode!, body })
        } catch {
          resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString('utf-8') })
        }
      })
    })

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('HeadlessServer', () => {
  let server: HeadlessServer
  let deps: ServerDependencies
  let port: number

  beforeEach(async () => {
    deps = createMockDeps()
    server = new HeadlessServer(deps, 0) // Use port 0 for random available port
    port = await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const { status, body } = await makeRequest(port, 'GET', '/api/health')

      expect(status).toBe(200)
      expect(body.status).toBe('ok')
      expect(body.port).toBe(port)
      expect(body.version).toBe('0.1.0')
    })
  })

  describe('GET /api/projects', () => {
    it('should return empty project list', async () => {
      const { status, body } = await makeRequest(port, 'GET', '/api/projects')

      expect(status).toBe(200)
      expect(body.projects).toEqual([])
    })
  })

  describe('POST /api/projects', () => {
    it('should add a project', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/projects', { path: '/test/project' })

      expect(status).toBe(201)
      expect(body.project.path).toBe('/test/project')
      expect(deps.projectManager.addProject).toHaveBeenCalledWith('/test/project')
    })

    it('should reject missing path', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/projects', {})

      expect(status).toBe(400)
      expect(body.error).toContain('path')
    })
  })

  describe('GET /api/agents', () => {
    it('should return empty agent list', async () => {
      const { status, body } = await makeRequest(port, 'GET', '/api/agents')

      expect(status).toBe(200)
      expect(body.agents).toEqual([])
    })

    it('should list agents for specific project', async () => {
      (deps.agentManager.listAgents as any).mockResolvedValue([
        { agentId: 'test-1', status: 'running', branch: 'feature/test' }
      ])

      const { status, body } = await makeRequest(port, 'GET', '/api/agents?project=/test/project')

      expect(status).toBe(200)
      expect(body.agents).toHaveLength(1)
    })
  })

  describe('POST /api/agents', () => {
    it('should create an agent', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/agents', {
        project: '/test/project',
        prompt: 'Add login feature'
      })

      expect(status).toBe(201)
      expect(body.agent.agentId).toBe('test-agent-1')
      expect(deps.agentManager.createAssignment).toHaveBeenCalled()
    })

    it('should reject missing project', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/agents', { prompt: 'test' })

      expect(status).toBe(400)
      expect(body.error).toContain('project')
    })

    it('should reject missing prompt', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/agents', { project: '/test' })

      expect(status).toBe(400)
      expect(body.error).toContain('prompt')
    })
  })

  describe('GET /api/agents/:id', () => {
    it('should return 404 for non-existent agent', async () => {
      const { status, body } = await makeRequest(port, 'GET', '/api/agents/nonexistent')

      expect(status).toBe(404)
      expect(body.error).toContain('not found')
    })
  })

  describe('POST /api/agents/:id/stop', () => {
    it('should stop an agent', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/agents/test-1/stop')

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(deps.terminalManager.stopAgent).toHaveBeenCalledWith('test-1')
    })
  })

  describe('DELETE /api/agents/:id', () => {
    it('should return 404 for non-existent agent', async () => {
      const { status, body } = await makeRequest(port, 'DELETE', '/api/agents/nonexistent')

      expect(status).toBe(404)
    })
  })

  describe('POST /api/handoff', () => {
    it('should reject missing sourceAgentId', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/handoff', { plan: 'test' })

      expect(status).toBe(400)
      expect(body.error).toContain('sourceAgentId')
    })

    it('should reject missing plan', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/handoff', { sourceAgentId: 'agent-1' })

      expect(status).toBe(400)
      expect(body.error).toContain('plan')
    })

    it('should process handoff successfully', async () => {
      (deps.projectManager.getActiveProjects as any).mockReturnValue([{ path: '/test/project' }])

      const { status, body } = await makeRequest(port, 'POST', '/api/handoff', {
        sourceAgentId: 'agent-1',
        plan: 'Implement caching layer'
      })

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.newAgentId).toBe('new-agent')
    })
  })

  describe('POST /api/spawn-super', () => {
    it('should reject missing sourceAgentId', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/spawn-super', {
        spawns: [{ plan: 'test' }]
      })

      expect(status).toBe(400)
      expect(body.error).toContain('sourceAgentId')
    })

    it('should reject empty spawns', async () => {
      const { status, body } = await makeRequest(port, 'POST', '/api/spawn-super', {
        sourceAgentId: 'agent-1',
        spawns: []
      })

      expect(status).toBe(400)
      expect(body.error).toContain('non-empty')
    })

    it('should process spawns successfully', async () => {
      (deps.projectManager.getActiveProjects as any).mockReturnValue([{ path: '/test/project' }])

      const { status, body } = await makeRequest(port, 'POST', '/api/spawn-super', {
        sourceAgentId: 'agent-1',
        spawns: [{ plan: 'Task 1' }, { plan: 'Task 2' }]
      })

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.totalRequested).toBe(2)
      expect(body.totalSucceeded).toBe(2)
    })
  })

  describe('GET /api/workflows', () => {
    it('should return workflows', async () => {
      const { status, body } = await makeRequest(port, 'GET', '/api/workflows')

      expect(status).toBe(200)
      expect(body.workflows).toHaveLength(2)
      expect(body.workflows[0].id).toBe('default')
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const { status, body } = await makeRequest(port, 'GET', '/api/unknown')

      expect(status).toBe(404)
      expect(body.error).toBe('Not found')
    })
  })

  describe('server lifecycle', () => {
    it('should report running status', () => {
      expect(server.isRunning()).toBe(true)
      expect(server.getPort()).toBe(port)
    })

    it('should stop cleanly', async () => {
      await server.stop()
      expect(server.isRunning()).toBe(false)
    })
  })
})
