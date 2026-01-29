import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentMigrationService, MigrationAgentOps } from '../AgentMigrationService'
import { ProjectConfigHelper } from '../ProjectConfigHelper'
import { WorktreeService } from '../WorktreeService'

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

import { readFileSync, existsSync } from 'fs'
import { exec } from 'child_process'

const mockReadFileSync = vi.mocked(readFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockExec = vi.mocked(exec)

describe('AgentMigrationService', () => {
  let service: AgentMigrationService
  let mockProjectConfig: ProjectConfigHelper
  let mockWorktreeService: WorktreeService
  let mockAgentOps: MigrationAgentOps

  beforeEach(() => {
    vi.clearAllMocks()

    mockProjectConfig = {
      getProjectConfig: vi.fn().mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [
          {
            id: 'assign-1',
            agentId: 'agent-1',
            feature: 'Test feature',
            status: 'active',
            tool: 'claude',
            mode: 'auto'
          }
        ],
        testEnvironments: []
      }),
      saveProjectConfig: vi.fn(),
      getProjectName: vi.fn().mockReturnValue('myrepo')
    } as unknown as ProjectConfigHelper

    mockWorktreeService = {
      parseWorktrees: vi.fn().mockReturnValue([
        { path: '/projects/myrepo-agent-1', branch: 'feature/agent-1/task' }
      ])
    } as unknown as WorktreeService

    mockAgentOps = {
      writeAgentInfo: vi.fn()
    }

    service = new AgentMigrationService(mockProjectConfig, mockWorktreeService, mockAgentOps)
  })

  describe('parseAgentInfo', () => {
    it('should parse legacy key=value format', () => {
      mockReadFileSync.mockReturnValue('AGENT_ID=agent-1\nBRANCH=feature/test\nPROJECT=myrepo\n')
      const result = service.parseAgentInfo('/path/.agent-info')
      expect(result).toEqual({
        AGENT_ID: 'agent-1',
        BRANCH: 'feature/test',
        PROJECT: 'myrepo'
      })
    })

    it('should handle lines without value', () => {
      mockReadFileSync.mockReturnValue('AGENT_ID=agent-1\nEMPTY_LINE\n')
      const result = service.parseAgentInfo('/path/.agent-info')
      expect(result.AGENT_ID).toBe('agent-1')
      expect(result).not.toHaveProperty('EMPTY_LINE')
    })

    it('should handle empty file', () => {
      mockReadFileSync.mockReturnValue('')
      const result = service.parseAgentInfo('/path/.agent-info')
      expect(result).toEqual({})
    })

    it('should handle values with equals signs', () => {
      mockReadFileSync.mockReturnValue('KEY=value=with=equals\n')
      const result = service.parseAgentInfo('/path/.agent-info')
      // split('=') gives ['KEY', 'value', 'with', 'equals'], key='KEY', value='value'
      expect(result.KEY).toBe('value')
    })
  })

  describe('migrateAssignments', () => {
    it('should migrate legacy format to new JSON format', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, 'worktree /projects/myrepo-agent-1\nHEAD abc\nbranch refs/heads/feature/test\n\n', '')
        return {} as any
      }) as any)

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('AGENT_ID=agent-1\nBRANCH=feature/test\nPROJECT=myrepo\n')

      await service.migrateAssignments('/projects/myrepo')

      expect(mockAgentOps.writeAgentInfo).toHaveBeenCalledWith(
        '/projects/myrepo-agent-1',
        expect.objectContaining({
          agentId: 'agent-1',
          branch: 'feature/test',
          project: 'myrepo'
        })
      )
    })

    it('should skip already-migrated JSON format files', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, 'worktree /projects/myrepo-agent-1\nHEAD abc\nbranch refs/heads/feature/test\n\n', '')
        return {} as any
      }) as any)

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ id: 'test', agentId: 'agent-1' }))

      await service.migrateAssignments('/projects/myrepo')

      expect(mockAgentOps.writeAgentInfo).not.toHaveBeenCalled()
    })

    it('should handle errors gracefully', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(new Error('git command failed'), '', '')
        return {} as any
      }) as any)

      await expect(service.migrateAssignments('/projects/myrepo')).resolves.toBeUndefined()
    })

    it('should clear config assignments after migration', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, 'worktree /projects/myrepo-agent-1\nHEAD abc\nbranch refs/heads/feature/test\n\n', '')
        return {} as any
      }) as any)

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('AGENT_ID=agent-1\nBRANCH=feature/test\nPROJECT=myrepo\n')

      await service.migrateAssignments('/projects/myrepo')

      expect(vi.mocked(mockProjectConfig.saveProjectConfig)).toHaveBeenCalled()
    })
  })
})
