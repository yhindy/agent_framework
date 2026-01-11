import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { exec } from 'child_process'
import { readFileSync, existsSync, writeFileSync } from 'fs'

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
  writeFileSync: vi.fn()
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn()
}))

const mockExec = vi.mocked(exec)
const mockReadFileSync = vi.mocked(readFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockWriteFileSync = vi.mocked(writeFileSync)

// Test fixtures
const mockProjectPath = '/test/project'
const mockAssignmentId = 'test-assignment-123'
const mockBranch = 'feature/test-branch'
const mockAgentId = 'agent-1'
const mockWorktreePath = '/test/project-agent-1'

const createMockAgentInfo = (overrides: Record<string, unknown> = {}) => ({
  id: mockAssignmentId,
  agentId: mockAgentId,
  branch: mockBranch,
  project: 'project',
  feature: 'test-feature',
  status: 'in_progress',
  tool: 'claude',
  mode: 'auto',
  createdAt: '2026-01-10T10:00:00Z',
  lastActivity: '2026-01-10T10:00:00Z',
  ...overrides
})

const createMockProjectConfig = (overrides: Record<string, unknown> = {}) => ({
  project: {
    name: 'project',
    ...overrides
  }
})

// Helper to mock exec calls
const setupExecMock = (handlers: Record<string, { stdout?: string; stderr?: string; error?: Error }>) => {
  mockExec.mockImplementation((cmd: string, opts: unknown, callback?: unknown) => {
    const cb = (typeof opts === 'function' ? opts : callback) as (
      error: Error | null,
      result: { stdout: string; stderr: string }
    ) => void

    // Find matching handler
    for (const [pattern, result] of Object.entries(handlers)) {
      if (cmd.includes(pattern)) {
        if (result.error) {
          cb(result.error, { stdout: '', stderr: '' })
        } else {
          cb(null, { stdout: result.stdout || '', stderr: result.stderr || '' })
        }
        return {} as ReturnType<typeof exec>
      }
    }

    // Default: return empty
    cb(null, { stdout: '', stderr: '' })
    return {} as ReturnType<typeof exec>
  })
}

// Helper to setup file system mocks for a standard agent scenario
const setupStandardFileMocks = (agentInfoOverrides: Record<string, unknown> = {}) => {
  const agentInfo = createMockAgentInfo(agentInfoOverrides)
  const projectConfig = createMockProjectConfig()

  mockExistsSync.mockImplementation((path: unknown) => {
    const pathStr = String(path)
    if (pathStr.includes('.agent-info')) return true
    if (pathStr.includes('config.json')) return true
    return false
  })

  mockReadFileSync.mockImplementation((path: unknown) => {
    const pathStr = String(path)
    if (pathStr.includes('.agent-info')) {
      return JSON.stringify(agentInfo)
    }
    if (pathStr.includes('config.json')) {
      return JSON.stringify(projectConfig)
    }
    return ''
  })

  return { agentInfo, projectConfig }
}

describe('AgentService - detectExistingPullRequest', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('PR detection - Success Cases', () => {
    it('should detect existing PR when branch is on remote', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({
        found: true,
        prUrl: prData.url,
        prStatus: 'OPEN',
        createdAt: prData.createdAt
      })

      // Verify .agent-info was updated
      expect(mockWriteFileSync).toHaveBeenCalled()
      const writeCall = mockWriteFileSync.mock.calls.find(
        (call) => String(call[0]).includes('.agent-info')
      )
      expect(writeCall).toBeDefined()
      const writtenData = JSON.parse(writeCall![1] as string)
      expect(writtenData.prUrl).toBe(prData.url)
      expect(writtenData.prStatus).toBe('OPEN')
    })

    it('should detect merged PR and update status', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/2',
        state: 'MERGED',
        createdAt: '2026-01-10T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({
        found: true,
        prUrl: prData.url,
        prStatus: 'MERGED',
        createdAt: prData.createdAt
      })

      // Verify status was updated to 'merged'
      const writeCall = mockWriteFileSync.mock.calls.find(
        (call) => String(call[0]).includes('.agent-info')
      )
      expect(writeCall).toBeDefined()
      const writtenData = JSON.parse(writeCall![1] as string)
      expect(writtenData.status).toBe('merged')
    })

    it('should detect closed PR and update status', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/3',
        state: 'CLOSED',
        createdAt: '2026-01-09T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({
        found: true,
        prUrl: prData.url,
        prStatus: 'CLOSED',
        createdAt: prData.createdAt
      })

      // Verify status was updated to 'closed'
      const writeCall = mockWriteFileSync.mock.calls.find(
        (call) => String(call[0]).includes('.agent-info')
      )
      expect(writeCall).toBeDefined()
      const writtenData = JSON.parse(writeCall![1] as string)
      expect(writtenData.status).toBe('closed')
    })
  })

  describe('no PR found', () => {
    it('should return found:false when no PR exists', async () => {
      setupStandardFileMocks()

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: '' } // Empty result means no PR
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({ found: false })
    })

    it('should return found:false when gh pr list returns null', async () => {
      setupStandardFileMocks()

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: 'null' } // gh returns "null" when no match
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({ found: false })
    })

    it('should return found:false when branch not on remote', async () => {
      setupStandardFileMocks()

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: '' } // Branch not on remote
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({ found: false })

      // Verify gh pr list was NOT called since branch isn't on remote
      const ghCalls = mockExec.mock.calls.filter((call) => String(call[0]).includes('gh pr list'))
      expect(ghCalls.length).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should return null on GitHub CLI errors', async () => {
      setupStandardFileMocks()

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { error: new Error('GitHub CLI authentication failed') }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        '[AgentService] detectExistingPullRequest: GitHub CLI error:',
        expect.any(String)
      )

      consoleSpy.mockRestore()
    })

    it('should return null when git ls-remote fails', async () => {
      setupStandardFileMocks()

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { error: new Error('Connection refused') }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should return null when assignment not found', async () => {
      // Setup mocks but return empty worktree list (no assignment)
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: unknown) => {
        const pathStr = String(path)
        if (pathStr.includes('config.json')) {
          return JSON.stringify(createMockProjectConfig())
        }
        return ''
      })

      setupExecMock({
        'git worktree list': { stdout: '' } // No worktrees
      })

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await agentService.detectExistingPullRequest(
        mockProjectPath,
        'non-existent-id'
      )

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        '[AgentService] detectExistingPullRequest: Assignment not found'
      )

      consoleSpy.mockRestore()
    })

    it('should skip detection if prUrl already exists', async () => {
      const existingPrUrl = 'https://github.com/test/repo/pull/99'
      setupStandardFileMocks({
        prUrl: existingPrUrl,
        prStatus: 'OPEN'
      })

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        }
      })

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result).toEqual({
        found: true,
        prUrl: existingPrUrl,
        prStatus: 'OPEN'
      })

      // Verify gh commands were NOT called
      const ghCalls = mockExec.mock.calls.filter((call) => String(call[0]).includes('gh '))
      expect(ghCalls.length).toBe(0)

      // Verify git ls-remote was NOT called
      const lsRemoteCalls = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('git ls-remote')
      )
      expect(lsRemoteCalls.length).toBe(0)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AgentService] detectExistingPullRequest: PR already tracked:',
        existingPrUrl
      )

      consoleSpy.mockRestore()
    })
  })

  describe('caching', () => {
    it('should cache positive results', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      // First call
      const result1 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result1?.found).toBe(true)

      // Count gh pr list calls after first call
      const ghCallsAfterFirst = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      // Second call - should use cache
      const result2 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result2?.found).toBe(true)

      // gh pr list should NOT have been called again
      const ghCallsAfterSecond = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      expect(ghCallsAfterSecond).toBe(ghCallsAfterFirst)
    })

    it('should cache negative results', async () => {
      setupStandardFileMocks()

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: '' } // No PR found
      })

      // First call
      const result1 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result1?.found).toBe(false)

      const ghCallsAfterFirst = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      // Second call - should use cache
      const result2 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result2?.found).toBe(false)

      const ghCallsAfterSecond = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      expect(ghCallsAfterSecond).toBe(ghCallsAfterFirst)
    })

    it('should bypass cache when force=true', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      // First call without force
      await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      const ghCallsAfterFirst = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      // Second call with force=true
      await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId, {
        force: true
      })

      const ghCallsAfterSecond = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      // gh pr list should have been called again with force
      expect(ghCallsAfterSecond).toBe(ghCallsAfterFirst + 1)
    })

    it('should not cache errors', async () => {
      setupStandardFileMocks()

      // First call will fail
      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { error: new Error('API rate limit exceeded') }
      })

      vi.spyOn(console, 'warn').mockImplementation(() => {})

      // First call - should fail
      const result1 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result1).toBeNull()

      const ghCallsAfterFirst = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      // Second call - should try again (errors not cached)
      const result2 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result2).toBeNull()

      const ghCallsAfterSecond = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('gh pr list')
      ).length

      // gh pr list should have been called again
      expect(ghCallsAfterSecond).toBe(ghCallsAfterFirst + 1)
    })

    it('should cache branch-not-on-remote results', async () => {
      setupStandardFileMocks()

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: '' } // Branch not on remote
      })

      // First call
      const result1 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result1?.found).toBe(false)

      const lsRemoteCallsAfterFirst = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('git ls-remote')
      ).length

      // Second call - should use cache
      const result2 = await agentService.detectExistingPullRequest(
        mockProjectPath,
        mockAssignmentId
      )
      expect(result2?.found).toBe(false)

      const lsRemoteCallsAfterSecond = mockExec.mock.calls.filter((call) =>
        String(call[0]).includes('git ls-remote')
      ).length

      // git ls-remote should NOT have been called again due to cache
      expect(lsRemoteCallsAfterSecond).toBe(lsRemoteCallsAfterFirst)
    })
  })

  describe('worktree path computation', () => {
    it('should handle agent IDs that already include project name prefix', async () => {
      const agentIdWithPrefix = 'project-agent-1'
      setupStandardFileMocks({ agentId: agentIdWithPrefix })

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      // The worktree path should be /test/project-agent-1 (not /test/project-project-agent-1)
      const expectedWorktreePath = '/test/project-agent-1'

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${expectedWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result?.found).toBe(true)

      // Verify git ls-remote was called with correct worktree path
      const lsRemoteCall = mockExec.mock.calls.find((call) =>
        String(call[0]).includes('git ls-remote')
      )
      expect(lsRemoteCall).toBeDefined()
      const lsRemoteOpts = lsRemoteCall![1] as { cwd?: string }
      expect(lsRemoteOpts.cwd).toBe(expectedWorktreePath)
    })

    it('should handle agent IDs without project name prefix', async () => {
      setupStandardFileMocks({ agentId: 'agent-1' })

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      // The worktree path should be /test/project-agent-1 (project name added as prefix)
      const expectedWorktreePath = '/test/project-agent-1'

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${expectedWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      expect(result?.found).toBe(true)
    })
  })

  describe('status updates', () => {
    it('should update status to pr_open for OPEN PRs', async () => {
      setupStandardFileMocks({ status: 'in_progress' })

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      const writeCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes('.agent-info')
      )
      expect(writeCall).toBeDefined()
      const writtenData = JSON.parse(writeCall![1] as string)
      expect(writtenData.status).toBe('pr_open')
    })

    it('should not update .agent-info if file does not exist', async () => {
      // Setup agent info through worktree parsing but make .agent-info not exist for write check
      const agentInfo = createMockAgentInfo()

      let agentInfoExistsForRead = true

      mockExistsSync.mockImplementation((path: unknown) => {
        const pathStr = String(path)
        if (pathStr.includes('config.json')) return true
        if (pathStr.includes('.agent-info')) {
          // First check (for reading) returns true, subsequent checks (for writing) return false
          if (agentInfoExistsForRead) {
            agentInfoExistsForRead = false
            return true
          }
          return false
        }
        return false
      })

      mockReadFileSync.mockImplementation((path: unknown) => {
        const pathStr = String(path)
        if (pathStr.includes('.agent-info')) {
          return JSON.stringify(agentInfo)
        }
        if (pathStr.includes('config.json')) {
          return JSON.stringify(createMockProjectConfig())
        }
        return ''
      })

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'origin\n' },
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      const result = await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      // Result should still be successful
      expect(result?.found).toBe(true)

      // .agent-info should not have been written (since file doesn't exist for update)
      const agentInfoWrites = mockWriteFileSync.mock.calls.filter((call) =>
        String(call[0]).includes('.agent-info')
      )
      expect(agentInfoWrites.length).toBe(0)
    })
  })

  describe('remote detection', () => {
    it('should prefer origin remote when multiple remotes exist', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'upstream\norigin\nfork\n' }, // Multiple remotes
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      // Verify git ls-remote was called with 'origin' remote
      const lsRemoteCall = mockExec.mock.calls.find((call) =>
        String(call[0]).includes('git ls-remote')
      )
      expect(lsRemoteCall).toBeDefined()
      expect(String(lsRemoteCall![0])).toContain('origin')
    })

    it('should use first available remote when origin does not exist', async () => {
      setupStandardFileMocks()

      const prData = {
        url: 'https://github.com/test/repo/pull/1',
        state: 'OPEN',
        createdAt: '2026-01-11T10:00:00Z'
      }

      setupExecMock({
        'git worktree list': {
          stdout: `worktree ${mockWorktreePath}\nHEAD abc123\nbranch refs/heads/${mockBranch}\n`
        },
        'git remote': { stdout: 'upstream\nfork\n' }, // No origin
        'git ls-remote': { stdout: `abc123 refs/heads/${mockBranch}\n` },
        'gh pr list': { stdout: JSON.stringify(prData) }
      })

      await agentService.detectExistingPullRequest(mockProjectPath, mockAssignmentId)

      // Verify git ls-remote was called with first remote (upstream)
      const lsRemoteCall = mockExec.mock.calls.find((call) =>
        String(call[0]).includes('git ls-remote')
      )
      expect(lsRemoteCall).toBeDefined()
      expect(String(lsRemoteCall![0])).toContain('upstream')
    })
  })
})
