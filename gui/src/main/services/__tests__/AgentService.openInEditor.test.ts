import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { AgentInfo } from '../types/ProjectConfig'
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

describe('AgentService - openInEditor', () => {
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
    status: 'active',
    tool: 'claude',
    model: 'opus',
    mode: 'dev',
    prompt: 'Test the feature implementation',
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
      if (path === `${worktreePath}/.agent-info`) return true
      if (path === `${worktreePath}/.minions-base-info`) return false
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
      if (path === `${worktreePath}/.agent-info`) {
        return JSON.stringify(sampleAgentInfo)
      }
      throw new Error(`File not found: ${path}`)
    })

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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openInEditor', () => {
    it('should open Cursor when editor is cursor', async () => {
      // Setup execFile to capture the call
      vi.mocked(childProcess.execFile).mockImplementation(((
        _command: string,
        _args: string[],
        callback: (error: Error | null) => void
      ) => {
        callback(null)
        return {} as any
      }) as any)

      await agentService.openInEditor(projectPath, agentId, 'cursor')

      expect(childProcess.execFile).toHaveBeenCalledWith(
        'cursor',
        [worktreePath],
        expect.any(Function)
      )
    })

    it('should open VS Code (code command) when editor is vscode', async () => {
      vi.mocked(childProcess.execFile).mockImplementation(((
        _command: string,
        _args: string[],
        callback: (error: Error | null) => void
      ) => {
        callback(null)
        return {} as any
      }) as any)

      await agentService.openInEditor(projectPath, agentId, 'vscode')

      expect(childProcess.execFile).toHaveBeenCalledWith(
        'code',
        [worktreePath],
        expect.any(Function)
      )
    })

    it('should open Zed when editor is zed', async () => {
      vi.mocked(childProcess.execFile).mockImplementation(((
        _command: string,
        _args: string[],
        callback: (error: Error | null) => void
      ) => {
        callback(null)
        return {} as any
      }) as any)

      await agentService.openInEditor(projectPath, agentId, 'zed')

      expect(childProcess.execFile).toHaveBeenCalledWith(
        'zed',
        [worktreePath],
        expect.any(Function)
      )
    })

    it('should throw error when agent not found', async () => {
      // Setup existsSync to make agent not found
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === `${projectPath}/minions/config.json`) return true
        if (path === `${projectPath}/.minions-base-info`) return false
        // Return false for agent info file
        return false
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

      await expect(agentService.openInEditor(projectPath, 'nonexistent-agent'))
        .rejects.toThrow('Agent not found')
    })

    it('should default to cursor when no editor specified', async () => {
      vi.mocked(childProcess.execFile).mockImplementation(((
        _command: string,
        _args: string[],
        callback: (error: Error | null) => void
      ) => {
        callback(null)
        return {} as any
      }) as any)

      // Call without specifying editor (uses default)
      await agentService.openInEditor(projectPath, agentId)

      expect(childProcess.execFile).toHaveBeenCalledWith(
        'cursor',
        [worktreePath],
        expect.any(Function)
      )
    })
  })
})
