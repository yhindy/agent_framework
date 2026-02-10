import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { SpawnSource } from '../types/ProjectConfig'
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

describe('AgentService - spawnSuperMinion', () => {
  let agentService: AgentService
  const projectPath = '/test/project'
  const projectName = 'test-project'
  const sourceAgentId = 'source-agent-123'
  const workflowId = 'debug-workflow'
  const batchId = 'batch-abc123'
  const plan = 'Implement feature X with tests and documentation'

  // Sample worktree output
  const sampleWorktreeOutput = `worktree ${projectPath}
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

    // Setup default mocks for git commands
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('spawnSuperMinion', () => {
    it('should create a fresh worktree from main (branchMode: fresh)', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)
      expect(result.agentId).toBeDefined()

      // Verify setup.sh was called
      expect(childProcess.execFile).toHaveBeenCalled()

      // Get the call arguments for setup.sh
      const execFileCalls = vi.mocked(childProcess.execFile).mock.calls
      const setupCall = execFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('setup.sh')
      )

      expect(setupCall).toBeDefined()
      // The third argument should be the base branch (main)
      const setupArgs = setupCall![1] as string[]
      expect(setupArgs[2]).toBe('main') // base branch for fresh mode
    })

    it('should set isSuperMinion: true flag', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      // Verify writeFileSync was called with agent info containing isSuperMinion
      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      expect(agentInfoCall).toBeDefined()
      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.isSuperMinion).toBe(true)
    })

    it('should set spawnSource metadata correctly', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      // Verify writeFileSync was called with correct spawnSource
      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      expect(agentInfoCall).toBeDefined()
      const writtenData = JSON.parse(agentInfoCall![1] as string)

      expect(writtenData.spawnSource).toBeDefined()
      const spawnSource: SpawnSource = writtenData.spawnSource
      expect(spawnSource.parentAgentId).toBe(sourceAgentId)
      expect(spawnSource.workflowId).toBe(workflowId)
      expect(spawnSource.batchId).toBe(batchId)
      expect(spawnSource.spawnTimestamp).toBeDefined()
    })

    it('should use specified workflowId', async () => {
      const customWorkflowId = 'custom-workflow-456'

      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        customWorkflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)
      expect(result.workflowId).toBe(customWorkflowId)

      // Also verify in the written agent info
      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.spawnSource.workflowId).toBe(customWorkflowId)
    })

    it('should auto-generate branch name with super- prefix', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      // Verify the branch name contains 'super-' prefix
      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.branch).toMatch(/feature\/.*\/super-/)
    })

    it('should use custom shortName for branch when provided', async () => {
      const customShortName = 'my-custom-branch'

      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId,
        customShortName
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.branch).toContain('my-custom-branch')
    })

    it('should handle git errors gracefully', async () => {
      // Mock setup.sh to fail
      vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        const error = new Error('fatal: worktree already exists')
        if (!callback && typeof options === 'object') {
          throw error
        }
        if (callback) {
          callback(error, { stdout: '', stderr: 'fatal: worktree already exists' })
        }
        return {} as any
      }) as any)

      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Failed to spawn super minion')
    })

    it('should track lineage via spawnSource (not parentAgentId)', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      // Super minions are top-level agents; lineage is tracked via spawnSource, not parentAgentId
      expect(writtenData.parentAgentId).toBeUndefined()
      expect(writtenData.spawnSource.parentAgentId).toBe(sourceAgentId)
    })

    it('should set mode to planning for workflow execution', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.mode).toBe('planning')
    })

    it('should store the plan as the prompt', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.prompt).toBe(plan)
    })

    it('should truncate long plans for feature description', async () => {
      const longPlan = 'A'.repeat(200) // Plan longer than 100 chars

      const result = await agentService.spawnSuperMinion(
        projectPath,
        longPlan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.feature.length).toBe(100)
      expect(writtenData.prompt).toBe(longPlan) // Full plan preserved in prompt
    })

    it('should generate unique agentId with project name prefix', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)
      expect(result.agentId).toMatch(new RegExp(`^${projectName}-`))
    })

    it('should use claude as the default tool', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.tool).toBe('claude')
    })

    it('should set yolo to false and chrome to true by default', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.yolo).toBe(false)
      expect(writtenData.chrome).toBe(true)
    })

    it('should set status to active', async () => {
      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)
      expect(writtenData.status).toBe('active')
    })

    it('should include createdAt and lastActivity timestamps', async () => {
      const beforeTime = new Date().toISOString()

      const result = await agentService.spawnSuperMinion(
        projectPath,
        plan,
        workflowId,
        sourceAgentId,
        batchId
      )

      const afterTime = new Date().toISOString()

      expect(result.success).toBe(true)

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
      const agentInfoCall = writeFileCalls.find(call =>
        typeof call[0] === 'string' && call[0].includes('.agent-info')
      )

      const writtenData = JSON.parse(agentInfoCall![1] as string)

      expect(writtenData.createdAt).toBeDefined()
      expect(writtenData.lastActivity).toBeDefined()
      expect(writtenData.createdAt >= beforeTime).toBe(true)
      expect(writtenData.createdAt <= afterTime).toBe(true)
    })
  })
})
