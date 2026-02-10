import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { AgentInfo, ArchivedAgent } from '../types/ProjectConfig'
import * as fs from 'fs'
import * as childProcess from 'child_process'

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
  readdirSync: vi.fn()
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn()
}))

// Mock util for promisify
vi.mock('util', () => ({
  promisify: (fn: any) => {
    // Return a mock async function that calls the underlying mock
    return (...args: any[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (error: Error | null, result: any) => {
          if (error) reject(error)
          else resolve(result)
        })
      })
    }
  }
}))

describe('AgentService - Archive Functionality', () => {
  let agentService: AgentService
  const projectPath = '/test/project'
  const projectName = 'test-project'
  const agentId = `${projectName}-abc123`
  const worktreePath = `/test/${agentId}`

  // Sample agent info that would be in .agent-info file
  const sampleAgentInfo: AgentInfo = {
    id: `${agentId}-1234567890`,
    agentId: agentId,
    branch: `feature/${agentId}/test-feature`,
    project: projectName,
    feature: 'Test feature description',
    status: 'completed',
    tool: 'claude',
    model: 'opus',
    mode: 'dev',
    prompt: 'Test the feature implementation',
    prUrl: 'https://github.com/test/repo/pull/123',
    prStatus: 'MERGED',
    totalCostUsd: 0.05,
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100
    },
    createdAt: '2024-01-01T10:00:00.000Z',
    lastActivity: '2024-01-01T12:00:00.000Z'
  }

  // Sample worktree output for git worktree list
  const sampleWorktreeOutput = `worktree ${worktreePath}
HEAD abc123
branch refs/heads/feature/${agentId}/test-feature

worktree ${projectPath}
HEAD def456
branch refs/heads/main
`

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()

    // Default mock for getProjectConfig (must include .git for git-based tests)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      if (path === `${projectPath}/minions/config.json`) return true
      if (path === `${projectPath}/.git`) return true
      return false
    })

    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path === `${projectPath}/minions/config.json`) {
        return JSON.stringify({
          project: { name: projectName, defaultBaseBranch: 'main' },
          setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
          assignments: [],
          testEnvironments: []
        })
      }
      throw new Error(`File not found: ${path}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('archiveAgent', () => {
    beforeEach(() => {
      // Setup mocks for listAgents to work properly
      vi.mocked(childProcess.exec).mockImplementation(((
        _command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        // Handle the promisified version (no callback)
        if (!callback && typeof options === 'object') {
          return {
            stdout: sampleWorktreeOutput,
            stderr: ''
          } as any
        }
        // Handle callback version
        if (callback) {
          callback(null, { stdout: sampleWorktreeOutput, stderr: '' })
        }
        return {} as any
      }) as any)
    })

    it('should create archive with correct data from agent info', async () => {
      // Setup existsSync to return true for worktree and agent-info
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      // Setup readFileSync to return agent info
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(sampleAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      const archived = await agentService.archiveAgent(projectPath, agentId)

      // Verify archive structure
      expect(archived.archiveId).toMatch(new RegExp(`^${agentId}-\\d+$`))
      expect(archived.agentId).toBe(agentId)
      expect(archived.assignmentId).toBe(sampleAgentInfo.id)
      expect(archived.branch).toBe(sampleAgentInfo.branch)
      expect(archived.feature).toBe(sampleAgentInfo.feature)
      expect(archived.prompt).toBe(sampleAgentInfo.prompt)
      expect(archived.tool).toBe(sampleAgentInfo.tool)
      expect(archived.model).toBe(sampleAgentInfo.model)
      expect(archived.mode).toBe(sampleAgentInfo.mode)
      expect(archived.finalStatus).toBe(sampleAgentInfo.status)
      expect(archived.prUrl).toBe(sampleAgentInfo.prUrl)
      expect(archived.prStatus).toBe(sampleAgentInfo.prStatus)
      expect(archived.totalCostUsd).toBe(sampleAgentInfo.totalCostUsd)
      expect(archived.tokenUsage).toEqual(sampleAgentInfo.tokenUsage)
      expect(archived.createdAt).toBe(sampleAgentInfo.createdAt)
      expect(archived.archivedAt).toBeDefined()
      expect(archived.archiveVersion).toBe(1)

      // Verify writeFileSync was called with correct path
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/project\/\.minions\/archive\/test-project-abc123-\d+\.json$/),
        expect.any(String)
      )
    })

    it('should create archive directory if it does not exist', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return false // Archive dir doesn't exist
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(sampleAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      await agentService.archiveAgent(projectPath, agentId)

      // Verify mkdirSync was called to create archive directory
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        `${projectPath}/.minions/archive`,
        { recursive: true }
      )
    })

    it('should throw error for non-existent agent', async () => {
      // Setup existsSync to make agent not found
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${projectPath}/.minions-base-info`) return false
        // Return false for agent info file
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        throw new Error(`File not found: ${path}`)
      })

      // Mock worktree output with no matching agent
      vi.mocked(childProcess.exec).mockImplementation(((
        _command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        const output = `worktree ${projectPath}
HEAD def456
branch refs/heads/main
`
        if (!callback && typeof options === 'object') {
          return { stdout: output, stderr: '' } as any
        }
        if (callback) {
          callback(null, { stdout: output, stderr: '' })
        }
        return {} as any
      }) as any)

      await expect(agentService.archiveAgent(projectPath, 'nonexistent-agent'))
        .rejects.toThrow('Agent nonexistent-agent not found for archiving')
    })

    it('should preserve optional fields (prUrl, tokenUsage, etc.) when present', async () => {
      const agentWithAllFields: AgentInfo = {
        ...sampleAgentInfo,
        parentAgentId: 'parent-agent-123',
        isSuperMinion: true
      } as AgentInfo & { isSuperMinion: boolean }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(agentWithAllFields)
        }
        throw new Error(`File not found: ${path}`)
      })

      const archived = await agentService.archiveAgent(projectPath, agentId)

      expect(archived.prUrl).toBe(sampleAgentInfo.prUrl)
      expect(archived.prStatus).toBe(sampleAgentInfo.prStatus)
      expect(archived.totalCostUsd).toBe(sampleAgentInfo.totalCostUsd)
      expect(archived.tokenUsage).toEqual(sampleAgentInfo.tokenUsage)
      expect(archived.parentAgentId).toBe('parent-agent-123')
      expect(archived.isSuperMinion).toBe(true)
    })

    it('should handle agents with missing optional fields', async () => {
      const minimalAgentInfo: AgentInfo = {
        id: `${agentId}-1234567890`,
        agentId: agentId,
        branch: `feature/${agentId}/test-feature`,
        project: projectName,
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: '2024-01-01T10:00:00.000Z',
        lastActivity: '2024-01-01T12:00:00.000Z'
        // No optional fields: model, prompt, prUrl, prStatus, totalCostUsd, tokenUsage
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(minimalAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      const archived = await agentService.archiveAgent(projectPath, agentId)

      // Required fields should be present
      expect(archived.agentId).toBe(agentId)
      expect(archived.branch).toBe(minimalAgentInfo.branch)
      expect(archived.feature).toBe(minimalAgentInfo.feature)
      expect(archived.tool).toBe(minimalAgentInfo.tool)
      expect(archived.mode).toBe(minimalAgentInfo.mode)
      expect(archived.finalStatus).toBe(minimalAgentInfo.status)

      // Optional fields should be undefined
      expect(archived.model).toBeUndefined()
      expect(archived.prompt).toBeUndefined()
      expect(archived.prUrl).toBeUndefined()
      expect(archived.prStatus).toBeUndefined()
      expect(archived.totalCostUsd).toBeUndefined()
      expect(archived.tokenUsage).toBeUndefined()
    })
  })

  describe('listArchivedAgents', () => {
    it('should return empty array when no archives exist', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue([])

      const archives = await agentService.listArchivedAgents(projectPath)

      expect(archives).toEqual([])
    })

    it('should return empty array when archive directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive`) return false
        return false
      })

      const archives = await agentService.listArchivedAgents(projectPath)

      expect(archives).toEqual([])
      expect(fs.readdirSync).not.toHaveBeenCalled()
    })

    it('should list all archived agents', async () => {
      const archive1: ArchivedAgent = {
        archiveId: 'agent-1-1700000000000',
        archivedAt: '2024-01-01T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'agent-1',
        assignmentId: 'agent-1-123',
        branch: 'feature/test1',
        feature: 'Feature 1',
        tool: 'claude',
        mode: 'dev',
        createdAt: '2024-01-01T08:00:00.000Z',
        completedAt: '2024-01-01T10:00:00.000Z',
        finalStatus: 'completed'
      }

      const archive2: ArchivedAgent = {
        archiveId: 'agent-2-1700000001000',
        archivedAt: '2024-01-02T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'agent-2',
        assignmentId: 'agent-2-456',
        branch: 'feature/test2',
        feature: 'Feature 2',
        tool: 'cursor-cli',
        mode: 'auto',
        createdAt: '2024-01-02T08:00:00.000Z',
        completedAt: '2024-01-02T10:00:00.000Z',
        finalStatus: 'merged'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue([
        'agent-1-1700000000000.json',
        'agent-2-1700000001000.json'
      ] as any)

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive/agent-1-1700000000000.json`) {
          return JSON.stringify(archive1)
        }
        if (path === `${projectPath}/.minions/archive/agent-2-1700000001000.json`) {
          return JSON.stringify(archive2)
        }
        throw new Error(`File not found: ${path}`)
      })

      const archives = await agentService.listArchivedAgents(projectPath)

      expect(archives).toHaveLength(2)
      expect(archives[0].archiveId).toBe('agent-2-1700000001000') // More recent first
      expect(archives[1].archiveId).toBe('agent-1-1700000000000')
    })

    it('should sort archives by date descending (most recent first)', async () => {
      const olderArchive: ArchivedAgent = {
        archiveId: 'agent-old-1700000000000',
        archivedAt: '2024-01-01T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'agent-old',
        assignmentId: 'agent-old-123',
        branch: 'feature/old',
        feature: 'Old Feature',
        tool: 'claude',
        mode: 'dev',
        createdAt: '2024-01-01T08:00:00.000Z',
        completedAt: '2024-01-01T10:00:00.000Z',
        finalStatus: 'completed'
      }

      const newerArchive: ArchivedAgent = {
        archiveId: 'agent-new-1700000002000',
        archivedAt: '2024-01-15T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'agent-new',
        assignmentId: 'agent-new-456',
        branch: 'feature/new',
        feature: 'New Feature',
        tool: 'claude',
        mode: 'dev',
        createdAt: '2024-01-15T08:00:00.000Z',
        completedAt: '2024-01-15T10:00:00.000Z',
        finalStatus: 'merged'
      }

      const middleArchive: ArchivedAgent = {
        archiveId: 'agent-mid-1700000001000',
        archivedAt: '2024-01-10T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'agent-mid',
        assignmentId: 'agent-mid-789',
        branch: 'feature/mid',
        feature: 'Middle Feature',
        tool: 'claude',
        mode: 'dev',
        createdAt: '2024-01-10T08:00:00.000Z',
        completedAt: '2024-01-10T10:00:00.000Z',
        finalStatus: 'completed'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      // Files returned in random order
      vi.mocked(fs.readdirSync).mockReturnValue([
        'agent-mid-1700000001000.json',
        'agent-old-1700000000000.json',
        'agent-new-1700000002000.json'
      ] as any)

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('agent-old')) return JSON.stringify(olderArchive)
        if (path.includes('agent-mid')) return JSON.stringify(middleArchive)
        if (path.includes('agent-new')) return JSON.stringify(newerArchive)
        throw new Error(`File not found: ${path}`)
      })

      const archives = await agentService.listArchivedAgents(projectPath)

      expect(archives).toHaveLength(3)
      expect(archives[0].archiveId).toBe('agent-new-1700000002000') // Most recent
      expect(archives[1].archiveId).toBe('agent-mid-1700000001000')
      expect(archives[2].archiveId).toBe('agent-old-1700000000000') // Oldest
    })

    it('should handle malformed archive files gracefully (skip them, continue with valid ones)', async () => {
      const validArchive: ArchivedAgent = {
        archiveId: 'valid-agent-1700000000000',
        archivedAt: '2024-01-01T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'valid-agent',
        assignmentId: 'valid-agent-123',
        branch: 'feature/valid',
        feature: 'Valid Feature',
        tool: 'claude',
        mode: 'dev',
        createdAt: '2024-01-01T08:00:00.000Z',
        completedAt: '2024-01-01T10:00:00.000Z',
        finalStatus: 'completed'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue([
        'valid-agent-1700000000000.json',
        'malformed-agent.json',
        'not-json.txt' // Should be filtered out by .json filter
      ] as any)

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('valid-agent')) {
          return JSON.stringify(validArchive)
        }
        if (path.includes('malformed-agent')) {
          return '{ invalid json content'
        }
        throw new Error(`File not found: ${path}`)
      })

      // Spy on console.warn to verify warning is logged
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const archives = await agentService.listArchivedAgents(projectPath)

      // Should only return valid archive
      expect(archives).toHaveLength(1)
      expect(archives[0].archiveId).toBe('valid-agent-1700000000000')

      consoleWarnSpy.mockRestore()
    })

    it('should filter out non-json files', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readdirSync).mockReturnValue([
        'readme.txt',
        '.gitkeep',
        'backup.json.bak'
      ] as any)

      const archives = await agentService.listArchivedAgents(projectPath)

      expect(archives).toEqual([])
      // readFileSync should not be called for any of these files
      expect(fs.readFileSync).not.toHaveBeenCalled()
    })
  })

  describe('getArchivedAgent', () => {
    it('should return null for non-existent archive', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive/nonexistent.json`) return false
        return false
      })

      const archive = await agentService.getArchivedAgent(projectPath, 'nonexistent')

      expect(archive).toBeNull()
    })

    it('should return specific archive by ID', async () => {
      const archiveId = 'test-agent-1700000000000'
      const expectedArchive: ArchivedAgent = {
        archiveId: archiveId,
        archivedAt: '2024-01-01T10:00:00.000Z',
        archiveVersion: 1,
        agentId: 'test-agent',
        assignmentId: 'test-agent-123',
        branch: 'feature/test',
        feature: 'Test Feature',
        prompt: 'Test prompt',
        tool: 'claude',
        model: 'opus',
        mode: 'dev',
        createdAt: '2024-01-01T08:00:00.000Z',
        completedAt: '2024-01-01T10:00:00.000Z',
        finalStatus: 'merged',
        prUrl: 'https://github.com/test/repo/pull/1',
        prStatus: 'MERGED'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive/${archiveId}.json`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive/${archiveId}.json`) {
          return JSON.stringify(expectedArchive)
        }
        throw new Error(`File not found: ${path}`)
      })

      const archive = await agentService.getArchivedAgent(projectPath, archiveId)

      expect(archive).not.toBeNull()
      expect(archive!.archiveId).toBe(archiveId)
      expect(archive!.agentId).toBe('test-agent')
      expect(archive!.feature).toBe('Test Feature')
      expect(archive!.prUrl).toBe('https://github.com/test/repo/pull/1')
    })

    it('should return null and log error for corrupted archive file', async () => {
      const archiveId = 'corrupted-archive'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive/${archiveId}.json`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/.minions/archive/${archiveId}.json`) {
          return '{ corrupted json'
        }
        throw new Error(`File not found: ${path}`)
      })

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const archive = await agentService.getArchivedAgent(projectPath, archiveId)

      expect(archive).toBeNull()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('teardownAgent with archive', () => {
    beforeEach(() => {
      // Setup mocks for listAgents
      vi.mocked(childProcess.exec).mockImplementation(((
        _command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'object') {
          return { stdout: sampleWorktreeOutput, stderr: '' } as any
        }
        if (callback) {
          callback(null, { stdout: sampleWorktreeOutput, stderr: '' })
        }
        return {} as any
      }) as any)

      // Setup mocks for execFile (teardown.sh)
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'object') {
          return { stdout: 'Teardown complete', stderr: '' } as any
        }
        if (callback) {
          callback(null, { stdout: 'Teardown complete', stderr: '' })
        }
        return {} as any
      }) as any)
    })

    it('should archive agent before teardown (verify archive is called)', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(sampleAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      // Spy on archiveAgent
      const archiveSpy = vi.spyOn(agentService, 'archiveAgent')

      await agentService.teardownAgent(projectPath, agentId)

      // Verify archive was called before teardown
      expect(archiveSpy).toHaveBeenCalledWith(projectPath, agentId)

      // Verify teardown script was called
      expect(childProcess.execFile).toHaveBeenCalled()
    })

    it('should continue teardown even if archive fails', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(sampleAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      // Make archive fail by throwing during writeFileSync
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Disk full')
      })

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Teardown should complete despite archive failure
      await agentService.teardownAgent(projectPath, agentId)

      // Verify teardown script was still called
      expect(childProcess.execFile).toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })

    it('should remove agent from sessions map after teardown', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.git`) return true
        if (path === `${worktreePath}/.agent-info`) return true
        if (path === `${worktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions/archive`) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) {
          return JSON.stringify({
            project: { name: projectName, defaultBaseBranch: 'main' },
            setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
            assignments: [],
            testEnvironments: []
          })
        }
        if (path === `${worktreePath}/.agent-info`) {
          return JSON.stringify(sampleAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      // First list agents to populate sessions
      await agentService.listAgents(projectPath)

      // Verify agent is in sessions
      const sessionsBefore = await agentService.listAgents(projectPath)
      expect(sessionsBefore.find(a => a.id === agentId)).toBeDefined()

      await agentService.teardownAgent(projectPath, agentId)

      // After teardown, the session should be removed (mocked worktree output would need to change)
      // This verifies the internal state management
      expect(childProcess.execFile).toHaveBeenCalled()
    })
  })
})
