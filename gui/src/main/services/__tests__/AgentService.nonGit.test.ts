import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentService } from '../AgentService'
import { AgentInfo } from '../types/ProjectConfig'
import { join } from 'path'
import * as fs from 'fs'

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/app')
  }
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}))

describe('AgentService Non-Git Support', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  describe('isGitRepo', () => {
    it('should return true when .git directory exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        return path === join('/projects/my-app', '.git')
      })

      expect(agentService.isGitRepo('/projects/my-app')).toBe(true)
    })

    it('should return false when .git directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(agentService.isGitRepo('/projects/plain-folder')).toBe(false)
    })
  })

  describe('listAgents (non-git)', () => {
    it('should scan .minions/agents/*.json for non-git projects', async () => {
      const mockAgentInfo: AgentInfo = {
        id: 'my-app-abc1234-1700000000',
        agentId: 'my-app-abc1234',
        project: 'my-app',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'auto',
        workingDirectory: '/projects/my-app',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join('/projects/my-app', '.git')) return false
        if (path === join('/projects/my-app', '.minions', 'agents')) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue(['my-app-abc1234.json'] as any)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAgentInfo))

      const agents = await agentService.listAgents('/projects/my-app')

      expect(agents).toHaveLength(1)
      expect(agents[0].id).toBe('my-app-abc1234')
      expect(agents[0].worktreePath).toBe('/projects/my-app')
    })

    it('should return empty array when .minions/agents does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const agents = await agentService.listAgents('/projects/empty-folder')

      expect(agents).toHaveLength(0)
    })

    it('should skip agents with missing agentId', async () => {
      const corruptedInfo = {
        id: 'bad-id',
        agentId: '',
        project: 'my-app',
        feature: 'Broken',
        status: 'active',
        tool: 'claude',
        mode: 'auto',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join('/projects/my-app', '.git')) return false
        if (path === join('/projects/my-app', '.minions', 'agents')) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue(['bad.json'] as any)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(corruptedInfo))

      const agents = await agentService.listAgents('/projects/my-app')

      expect(agents).toHaveLength(0)
    })
  })

  describe('createAssignment (non-git)', () => {
    it('should create agent without worktree or branch', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join('/projects/my-app', '.git')) return false
        return false
      })

      const result = await agentService.createAssignment('/projects/my-app', {
        feature: 'Add logging',
        tool: 'claude',
        mode: 'auto',
        prompt: 'Add structured logging to the app'
      })

      // Verify the result
      expect(result.agentId).toMatch(/^my-app-[a-z0-9]+$/)
      expect(result.project).toBe('my-app')
      expect(result.feature).toBe('Add logging')
      expect(result.tool).toBe('claude')
      expect(result.workingDirectory).toBe('/projects/my-app')
      expect(result.branch).toBeUndefined()

      // Verify directory creation
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        join('/projects/my-app', '.minions', 'agents'),
        { recursive: true }
      )

      // Verify file was written
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.minions/agents/'),
        expect.any(String)
      )
    })

    it('should generate a random agentId when none provided', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await agentService.createAssignment('/projects/my-app', {
        feature: 'Test',
      })

      expect(result.agentId).toMatch(/^my-app-[a-z0-9]{7}$/)
    })
  })

  describe('teardownAgent (non-git)', () => {
    it('should remove agent JSON file and clean up sessions', async () => {
      const mockAgentInfo: AgentInfo = {
        id: 'my-app-abc1234-1700000000',
        agentId: 'my-app-abc1234',
        project: 'my-app',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'auto',
        workingDirectory: '/projects/my-app',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join('/projects/my-app', '.git')) return false
        if (path === join('/projects/my-app', '.minions', 'agents')) return true
        if (path === join('/projects/my-app', '.minions', 'agents', 'my-app-abc1234.json')) return true
        if (path === join('/projects/my-app', '.minions', 'archive')) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue(['my-app-abc1234.json'] as any)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAgentInfo))

      await agentService.teardownAgent('/projects/my-app', 'my-app-abc1234')

      // Verify the agent file was removed
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        join('/projects/my-app', '.minions', 'agents', 'my-app-abc1234.json')
      )
    })
  })

  describe('getAssignments (non-git)', () => {
    it('should return agents from .minions/agents/ directory', async () => {
      const mockAgentInfo: AgentInfo = {
        id: 'my-app-abc1234-1700000000',
        agentId: 'my-app-abc1234',
        project: 'my-app',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'auto',
        workingDirectory: '/projects/my-app',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join('/projects/my-app', '.git')) return false
        if (path === join('/projects/my-app', '.minions', 'agents')) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue(['my-app-abc1234.json'] as any)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAgentInfo))

      const { assignments } = await agentService.getAssignments('/projects/my-app')

      expect(assignments).toHaveLength(1)
      expect(assignments[0].agentId).toBe('my-app-abc1234')
    })
  })

  describe('git-only operations gating', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.endsWith('.git')) return false
        return false
      })
    })

    it('handoffAgent should return error for non-git projects', async () => {
      const result = await agentService.handoffAgent('/projects/plain', {
        sourceAgentId: 'agent-1',
        prompt: 'Continue the work',
        branchMode: 'inherit'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not supported for non-git')
    })

    it('spawnSuperMinion should return error for non-git projects', async () => {
      const result = await agentService.spawnSuperMinion(
        '/projects/plain',
        'Some plan',
        'default',
        'agent-1',
        'batch-1'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not supported for non-git')
    })

    it('createPullRequest should throw for non-git projects', async () => {
      await expect(
        agentService.createPullRequest('/projects/plain', 'assignment-1')
      ).rejects.toThrow('not supported for non-git')
    })

    it('checkPullRequestStatus should return ERROR for non-git projects', async () => {
      const result = await agentService.checkPullRequestStatus('/projects/plain', 'assignment-1')

      expect(result.status).toBe('ERROR')
      expect(result.error).toContain('not supported for non-git')
    })

    it('detectExistingPullRequest should return null for non-git projects', async () => {
      const result = await agentService.detectExistingPullRequest('/projects/plain', 'assignment-1')

      expect(result).toBeNull()
    })

    it('ensureBaseBranchAgent should return empty agent for non-git projects', async () => {
      const result = await agentService.ensureBaseBranchAgent('/projects/plain')

      expect(result.agentId).toBe('')
      expect(result.id).toBe('')
    })
  })

  describe('getAgentPath (non-git)', () => {
    it('should return workingDirectory when set', () => {
      const agentInfo: AgentInfo = {
        id: 'my-app-abc1234',
        agentId: 'my-app-abc1234',
        project: 'my-app',
        feature: 'Test',
        status: 'active',
        tool: 'claude',
        mode: 'auto',
        workingDirectory: '/projects/my-app',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }

      // Mock existsSync for config path check
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const path = agentService.getAgentPath('/projects/my-app', agentInfo)

      expect(path).toBe('/projects/my-app')
    })
  })
})
