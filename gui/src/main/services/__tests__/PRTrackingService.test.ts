import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PRTrackingService, PRAgentOps } from '../PRTrackingService'
import { ProjectConfigHelper } from '../ProjectConfigHelper'
import { WorktreeService } from '../WorktreeService'
import { AgentInfo } from '../types/ProjectConfig'

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
  writeFileSync: vi.fn(),
  existsSync: vi.fn()
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn()
}))

// Mock util for promisify
vi.mock('util', () => ({
  promisify: (fn: any) => {
    return (...args: any[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (error: Error | null, ...results: any[]) => {
          if (error) reject(error)
          else if (results.length <= 1) resolve(results[0])
          else resolve({ stdout: results[0], stderr: results[1] })
        })
      })
    }
  }
}))

import { exec, execFile } from 'child_process'
import { existsSync } from 'fs'

const mockExec = vi.mocked(exec)
const mockExecFile = vi.mocked(execFile)
const mockExistsSync = vi.mocked(existsSync)

describe('PRTrackingService', () => {
  let service: PRTrackingService
  let mockProjectConfig: ProjectConfigHelper
  let mockWorktreeService: WorktreeService
  let mockAgentOps: PRAgentOps

  const makeAgent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
    id: 'test-id',
    agentId: 'agent-1',
    branch: 'feature/test',
    project: 'myrepo',
    feature: 'Test feature',
    status: 'in_progress',
    tool: 'claude',
    mode: 'auto',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mockProjectConfig = {
      getProjectConfig: vi.fn().mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }),
      getProjectName: vi.fn().mockReturnValue('myrepo'),
      getWorktreePath: vi.fn().mockImplementation((_projectPath: string, agentId: string) => {
        const projectName = 'myrepo'
        if (agentId.startsWith(`${projectName}-`)) {
          return `/projects/${agentId}`
        }
        return `/projects/${projectName}-${agentId}`
      })
    } as unknown as ProjectConfigHelper

    mockWorktreeService = {
      getDefaultBranch: vi.fn().mockResolvedValue('main'),
      getRemote: vi.fn().mockResolvedValue('origin')
    } as unknown as WorktreeService

    mockAgentOps = {
      getAssignments: vi.fn().mockResolvedValue({ assignments: [] }),
      readAgentInfo: vi.fn(),
      writeAgentInfo: vi.fn(),
      updateAgentInfo: vi.fn()
    }

    service = new PRTrackingService(mockProjectConfig, mockWorktreeService, mockAgentOps)
  })

  describe('checkDependencies', () => {
    // Helper: checkDependencies calls execAsync without options,
    // so exec is called as exec(cmd, callback) - _opts IS the callback
    function mockExecForCheckDeps(handler: (cmd: string, cb: Function) => void) {
      mockExec.mockImplementation(((cmd: string, optsOrCb: any, cb?: any) => {
        const callback = typeof optsOrCb === 'function' ? optsOrCb : cb
        handler(cmd, callback)
        return {} as any
      }) as any)
    }

    it('should return installed and authenticated when both succeed', async () => {
      mockExecForCheckDeps((_cmd, cb) => {
        cb(null, 'gh version 2.0\n', '')
      })

      const result = await service.checkDependencies()
      expect(result).toEqual({ ghInstalled: true, ghAuthenticated: true })
    })

    it('should return not installed when gh is not found', async () => {
      mockExecForCheckDeps((_cmd, cb) => {
        cb(new Error('command not found: gh'), '', '')
      })

      const result = await service.checkDependencies()
      expect(result.ghInstalled).toBe(false)
      expect(result.ghAuthenticated).toBe(false)
      expect(result.error).toContain('not installed')
    })

    it('should return installed but not authenticated', async () => {
      let callCount = 0
      mockExecForCheckDeps((_cmd, cb) => {
        callCount++
        if (callCount === 1) {
          cb(null, 'gh version 2.0\n', '')
        } else {
          cb(new Error('not logged in'), '', '')
        }
      })

      const result = await service.checkDependencies()
      expect(result.ghInstalled).toBe(true)
      expect(result.ghAuthenticated).toBe(false)
      expect(result.error).toContain('not authenticated')
    })
  })

  describe('createPullRequest', () => {
    it('should throw when assignment not found', async () => {
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [] })
      await expect(service.createPullRequest('/projects/myrepo', 'nonexistent'))
        .rejects.toThrow('Assignment not found')
    })

    it('should throw when assignment is in pending status', async () => {
      const agent = makeAgent({ id: 'test-id', status: 'pending' })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      await expect(service.createPullRequest('/projects/myrepo', 'test-id'))
        .rejects.toThrow("Cannot create PR for assignment in 'pending' status")
    })

    it('should throw when worktree not found', async () => {
      const agent = makeAgent({ id: 'test-id', status: 'in_progress' })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      mockExistsSync.mockReturnValue(false)

      await expect(service.createPullRequest('/projects/myrepo', 'test-id'))
        .rejects.toThrow('Agent worktree not found')
    })

    it('should throw when there are uncommitted changes and autoCommit is false', async () => {
      const agent = makeAgent({ id: 'test-id', status: 'in_progress' })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      mockExistsSync.mockReturnValue(true)

      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, 'M dirty-file.txt\n', '')
        return {} as any
      }) as any)

      await expect(service.createPullRequest('/projects/myrepo', 'test-id', false))
        .rejects.toThrow('uncommitted changes')
    })
  })

  describe('detectExistingPullRequest', () => {
    it('should return null when assignment not found', async () => {
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [] })
      const result = await service.detectExistingPullRequest('/projects/myrepo', 'nonexistent')
      expect(result).toBeNull()
    })

    it('should return found with existing prUrl', async () => {
      const agent = makeAgent({
        id: 'test-id',
        prUrl: 'https://github.com/org/repo/pull/123',
        prStatus: 'OPEN'
      })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })

      // Mock checkPullRequestStatus - needs execFile for gh pr view
      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(null, JSON.stringify({ state: 'OPEN', createdAt: '2025-01-01T00:00:00Z' }), '')
        return {} as any
      }) as any)

      const result = await service.detectExistingPullRequest('/projects/myrepo', 'test-id')
      expect(result?.found).toBe(true)
      expect(result?.prUrl).toBe('https://github.com/org/repo/pull/123')
    })

    it('should return not found when no PR exists for branch', async () => {
      const agent = makeAgent({ id: 'test-id' })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      mockExistsSync.mockReturnValue(true)

      mockExec.mockImplementation(((cmd: string, _opts: any, cb?: any) => {
        if (typeof cmd === 'string' && cmd.includes('branch --show-current')) {
          cb(null, 'feature/test\n', '')
        } else if (typeof cmd === 'string' && cmd.includes('ls-remote')) {
          cb(null, 'abc123\trefs/heads/feature/test\n', '')
        } else if (typeof cmd === 'string' && cmd.includes('gh pr list')) {
          cb(null, '', '')
        } else if (typeof cmd === 'string' && cmd.includes('git remote')) {
          cb(null, 'origin\n', '')
        } else {
          cb(null, '', '')
        }
        return {} as any
      }) as any)

      const result = await service.detectExistingPullRequest('/projects/myrepo', 'test-id')
      expect(result?.found).toBe(false)
    })
  })

  describe('checkPullRequestStatus', () => {
    it('should return ERROR when assignment not found', async () => {
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [] })
      const result = await service.checkPullRequestStatus('/projects/myrepo', 'nonexistent')
      expect(result.status).toBe('ERROR')
    })

    it('should return ERROR when assignment has no prUrl', async () => {
      const agent = makeAgent({ id: 'test-id' })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      const result = await service.checkPullRequestStatus('/projects/myrepo', 'test-id')
      expect(result.status).toBe('ERROR')
    })

    it('should return OPEN status', async () => {
      const agent = makeAgent({
        id: 'test-id',
        prUrl: 'https://github.com/org/repo/pull/42'
      })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      mockExistsSync.mockReturnValue(true)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(null, JSON.stringify({ state: 'OPEN', createdAt: '2025-01-01T00:00:00Z' }), '')
        return {} as any
      }) as any)

      const result = await service.checkPullRequestStatus('/projects/myrepo', 'test-id')
      expect(result.status).toBe('OPEN')
    })

    it('should return MERGED status and update agent info', async () => {
      const agent = makeAgent({
        id: 'test-id',
        prUrl: 'https://github.com/org/repo/pull/42'
      })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      mockExistsSync.mockReturnValue(true)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(null, JSON.stringify({ state: 'MERGED', mergedAt: '2025-01-02T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' }), '')
        return {} as any
      }) as any)

      const result = await service.checkPullRequestStatus('/projects/myrepo', 'test-id')
      expect(result.status).toBe('MERGED')
      expect(result.mergedAt).toBe('2025-01-02T00:00:00Z')
      expect(mockAgentOps.updateAgentInfo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ prStatus: 'MERGED', status: 'merged' }),
        'agent-1',
        '/projects/myrepo'
      )
    })

    it('should return CLOSED status', async () => {
      const agent = makeAgent({
        id: 'test-id',
        prUrl: 'https://github.com/org/repo/pull/42'
      })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })
      mockExistsSync.mockReturnValue(true)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(null, JSON.stringify({ state: 'CLOSED', createdAt: '2025-01-01T00:00:00Z' }), '')
        return {} as any
      }) as any)

      const result = await service.checkPullRequestStatus('/projects/myrepo', 'test-id')
      expect(result.status).toBe('CLOSED')
    })

    it('should return ERROR when gh command fails', async () => {
      const agent = makeAgent({
        id: 'test-id',
        prUrl: 'https://github.com/org/repo/pull/42'
      })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(new Error('gh api error'), '', '')
        return {} as any
      }) as any)

      const result = await service.checkPullRequestStatus('/projects/myrepo', 'test-id')
      expect(result.status).toBe('ERROR')
      expect(result.error).toContain('gh api error')
    })

    it('should return ERROR when PR URL has no PR number', async () => {
      const agent = makeAgent({
        id: 'test-id',
        prUrl: 'https://github.com/org/repo'
      })
      vi.mocked(mockAgentOps.getAssignments).mockResolvedValue({ assignments: [agent] })

      const result = await service.checkPullRequestStatus('/projects/myrepo', 'test-id')
      expect(result.status).toBe('ERROR')
      expect(result.error).toContain('Could not extract PR number')
    })
  })
})
