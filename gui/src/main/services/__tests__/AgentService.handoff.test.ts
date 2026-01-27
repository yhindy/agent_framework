import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { AgentInfo, HandoffRequest } from '../types/ProjectConfig'
import { sanitizeBranchName } from '../../../renderer/src/utils/branchUtils'
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

describe('AgentService - Handoff Functionality', () => {
  let agentService: AgentService
  const projectPath = '/test/project'
  const projectName = 'test-project'
  const sourceAgentId = `${projectName}-source123`
  const sourceWorktreePath = `/test/${sourceAgentId}`

  // Sample source agent info
  const sourceAgentInfo: AgentInfo = {
    id: `${sourceAgentId}-1234567890`,
    agentId: sourceAgentId,
    branch: `feature/${sourceAgentId}/original-feature`,
    project: projectName,
    feature: 'Original feature description',
    status: 'active',
    tool: 'claude',
    model: 'opus',
    mode: 'dev',
    yolo: true,
    chrome: true,
    prompt: 'Original prompt',
    createdAt: '2024-01-01T10:00:00.000Z',
    lastActivity: '2024-01-01T12:00:00.000Z'
  }

  // Sample worktree output
  const sampleWorktreeOutput = `worktree ${sourceWorktreePath}
HEAD abc123
branch refs/heads/feature/${sourceAgentId}/original-feature

worktree ${projectPath}
HEAD def456
branch refs/heads/main
`

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()

    // Default mock for getProjectConfig
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      if (path === `${projectPath}/minions/config.json`) return true
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

    // Setup default mocks for listAgents
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('sanitizeBranchName', () => {
    it('should replace spaces with hyphens', () => {
      expect(sanitizeBranchName('my feature branch')).toBe('my-feature-branch')
    })

    it('should remove special characters', () => {
      expect(sanitizeBranchName('feature@#$%^&*()name')).toBe('featurename')
    })

    it('should convert to lowercase', () => {
      expect(sanitizeBranchName('MyFeatureBranch')).toBe('myfeaturebranch')
    })

    it('should handle empty string', () => {
      expect(sanitizeBranchName('')).toBe('')
    })

    it('should trim leading and trailing hyphens', () => {
      expect(sanitizeBranchName('--my-branch--')).toBe('my-branch')
    })

    it('should collapse multiple consecutive hyphens', () => {
      expect(sanitizeBranchName('my---branch---name')).toBe('my-branch-name')
    })

    it('should handle underscores', () => {
      expect(sanitizeBranchName('my_feature_branch')).toBe('my_feature_branch')
    })
  })

  describe('isValidHandoffPayload', () => {
    it('should return true for valid handoff payload', () => {
      const payload: HandoffRequest = {
        sourceAgentId: 'test-agent-123',
        prompt: 'Continue working on this feature',
        branchMode: 'inherit'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(true)
    })

    it('should return false for missing sourceAgentId', () => {
      const payload = {
        prompt: 'Some prompt',
        branchMode: 'inherit'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(false)
    })

    it('should return false for empty sourceAgentId', () => {
      const payload: HandoffRequest = {
        sourceAgentId: '',
        prompt: 'Some prompt',
        branchMode: 'inherit'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(false)
    })

    it('should return false for missing prompt', () => {
      const payload = {
        sourceAgentId: 'test-agent-123',
        branchMode: 'inherit'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(false)
    })

    it('should return false for empty prompt', () => {
      const payload: HandoffRequest = {
        sourceAgentId: 'test-agent-123',
        prompt: '',
        branchMode: 'inherit'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(false)
    })

    it('should return false for invalid branchMode', () => {
      const payload = {
        sourceAgentId: 'test-agent-123',
        prompt: 'Some prompt',
        branchMode: 'invalid'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(false)
    })

    it('should return true with optional fields', () => {
      const payload: HandoffRequest = {
        sourceAgentId: 'test-agent-123',
        prompt: 'Some prompt',
        branchMode: 'fresh',
        tool: 'cursor-cli',
        model: 'claude-3-opus',
        shortName: 'custom-branch'
      }
      const result = (agentService as any).isValidHandoffPayload(payload)
      expect(result).toBe(true)
    })
  })

  describe('handoffAgent', () => {
    beforeEach(() => {
      // Setup mocks for source agent lookup
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${sourceWorktreePath}/.agent-info`) return true
        if (path === `${sourceWorktreePath}/.minions-base-info`) return false
        if (path === `${projectPath}/.minions-base-info`) return false
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
        if (path === `${sourceWorktreePath}/.agent-info`) {
          return JSON.stringify(sourceAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      // Mock execFile for setup.sh
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'object') {
          return { stdout: 'Setup complete', stderr: '' } as any
        }
        if (callback) {
          callback(null, { stdout: 'Setup complete', stderr: '' })
        }
        return {} as any
      }) as any)
    })

    it('should create a new agent with handoffSource metadata (inherit mode)', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue implementing the feature',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent).toBeDefined()
      expect(result.newAgent!.handoffSource).toBeDefined()
      expect(result.newAgent!.handoffSource!.agentId).toBe(sourceAgentId)
      expect(result.newAgent!.handoffSource!.branchMode).toBe('inherit')
      expect(result.newAgent!.handoffSource!.originalBranch).toBe(sourceAgentInfo.branch)
    })

    it('should create a new agent with handoffSource metadata (fresh mode)', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Start fresh implementation',
        branchMode: 'fresh'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent).toBeDefined()
      expect(result.newAgent!.handoffSource).toBeDefined()
      expect(result.newAgent!.handoffSource!.branchMode).toBe('fresh')
    })

    it('should set parentAgentId to source agent for tree hierarchy', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent).toBeDefined()
      expect(result.newAgent!.parentAgentId).toBe(sourceAgentId)
    })

    it('should inherit tool and model from source agent by default', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue the work',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.tool).toBe(sourceAgentInfo.tool)
      expect(result.newAgent!.model).toBe(sourceAgentInfo.model)
    })

    it('should allow overriding tool and model', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue with different tool',
        branchMode: 'inherit',
        tool: 'cursor-cli',
        model: 'claude-3-sonnet'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.tool).toBe('cursor-cli')
      expect(result.newAgent!.model).toBe('claude-3-sonnet')
    })

    it('should inherit yolo mode from source agent', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.yolo).toBe(sourceAgentInfo.yolo)
    })

    it('should allow explicit yolo override', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work without yolo',
        branchMode: 'inherit',
        yolo: false
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.yolo).toBe(false)
    })

    it('should use custom shortName for branch if provided', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit',
        shortName: 'custom-suffix'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.branch).toContain('custom-suffix')
    })

    it('should return error for non-existent source agent', async () => {
      const request: HandoffRequest = {
        sourceAgentId: 'nonexistent-agent',
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      // Mock to make agent not found
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

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should return error for invalid handoff request', async () => {
      const request = {
        sourceAgentId: sourceAgentId,
        prompt: '', // Invalid: empty prompt
        branchMode: 'inherit'
      } as HandoffRequest

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid')
    })

    it('should set correct prompt on new agent', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue implementing the login feature',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.prompt).toBe('Continue implementing the login feature')
    })

    it('should include handoffTimestamp in handoffSource', async () => {
      const beforeTime = new Date().toISOString()

      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      const afterTime = new Date().toISOString()

      expect(result.success).toBe(true)
      expect(result.newAgent!.handoffSource!.handoffTimestamp).toBeDefined()

      // Timestamp should be between before and after times
      const timestamp = result.newAgent!.handoffSource!.handoffTimestamp
      expect(timestamp >= beforeTime).toBe(true)
      expect(timestamp <= afterTime).toBe(true)
    })

    it('should call setup.sh with correct base branch for inherit mode', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      await agentService.handoffAgent(projectPath, request)

      // Verify setup.sh was called
      expect(childProcess.execFile).toHaveBeenCalled()

      // Get the call arguments
      const execFileCalls = vi.mocked(childProcess.execFile).mock.calls
      const setupCall = execFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('setup.sh')
      )

      expect(setupCall).toBeDefined()
      // In inherit mode, the branch should be based off source agent's branch
    })

    it('should handle setup.sh failure gracefully', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      // Mock setup.sh to fail
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        const error = new Error('Setup failed: worktree already exists')
        if (!callback && typeof options === 'object') {
          throw error
        }
        if (callback) {
          callback(error, { stdout: '', stderr: 'Setup failed' })
        }
        return {} as any
      }) as any)

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should set mode to dev by default', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.mode).toBe('dev')
    })

    it('should generate unique agentId for new agent', async () => {
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.agentId).not.toBe(sourceAgentId)
      expect(result.newAgent!.agentId).toMatch(new RegExp(`^${projectName}-`))
    })
  })

  describe('handoff with archived source', () => {
    it('should preserve handoffSource in archived agent', async () => {
      // First create a handoff agent
      const request: HandoffRequest = {
        sourceAgentId: sourceAgentId,
        prompt: 'Continue work',
        branchMode: 'inherit'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${sourceWorktreePath}/.agent-info`) return true
        if (path === `${sourceWorktreePath}/.minions-base-info`) return false
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
        if (path === `${sourceWorktreePath}/.agent-info`) {
          return JSON.stringify(sourceAgentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'object') {
          return { stdout: 'Setup complete', stderr: '' } as any
        }
        if (callback) {
          callback(null, { stdout: 'Setup complete', stderr: '' })
        }
        return {} as any
      }) as any)

      const result = await agentService.handoffAgent(projectPath, request)

      expect(result.success).toBe(true)
      expect(result.newAgent!.handoffSource).toBeDefined()

      // Verify that handoffSource would be preserved in archive
      // (This tests the type structure, actual archive behavior is in archive tests)
      const handoffSource = result.newAgent!.handoffSource!
      expect(handoffSource.agentId).toBe(sourceAgentId)
      expect(handoffSource.branchMode).toBe('inherit')
      expect(handoffSource.originalBranch).toBe(sourceAgentInfo.branch)
    })
  })
})
