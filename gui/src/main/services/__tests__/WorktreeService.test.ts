import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorktreeService } from '../WorktreeService'
import { ProjectConfigHelper } from '../ProjectConfigHelper'

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

// Mock util for promisify - properly wraps callback-based functions
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

const mockExec = vi.mocked(exec)
const mockExecFile = vi.mocked(execFile)

describe('WorktreeService', () => {
  let service: WorktreeService
  let mockProjectConfig: ProjectConfigHelper

  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectConfig = {
      getProjectConfig: vi.fn().mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }),
      getProjectName: vi.fn().mockReturnValue('myrepo')
    } as unknown as ProjectConfigHelper
    service = new WorktreeService(mockProjectConfig)
  })

  describe('parseWorktrees', () => {
    it('should parse porcelain output correctly', () => {
      const output = `worktree /path/to/myrepo-agent-1
HEAD abc123
branch refs/heads/feature/agent-1/task

worktree /path/to/myrepo
HEAD def456
branch refs/heads/main
`
      const result = service.parseWorktrees(output, 'myrepo')
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('/path/to/myrepo-agent-1')
      expect(result[0].branch).toBe('feature/agent-1/task')
    })

    it('should handle multiple matching worktrees', () => {
      const output = `worktree /path/to/myrepo-1
HEAD abc123
branch refs/heads/feature/1

worktree /path/to/myrepo-2
HEAD def456
branch refs/heads/feature/2
`
      const result = service.parseWorktrees(output, 'myrepo')
      expect(result).toHaveLength(2)
    })

    it('should ignore worktrees that do not match project prefix', () => {
      const output = `worktree /path/to/other-repo-1
HEAD abc123
branch refs/heads/feature/test
`
      const result = service.parseWorktrees(output, 'myrepo')
      expect(result).toHaveLength(0)
    })

    it('should handle empty output', () => {
      const result = service.parseWorktrees('', 'myrepo')
      expect(result).toHaveLength(0)
    })

    it('should handle output without trailing newline', () => {
      const output = `worktree /path/to/myrepo-1
HEAD abc123
branch refs/heads/feature/1`
      const result = service.parseWorktrees(output, 'myrepo')
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('/path/to/myrepo-1')
    })
  })

  describe('sanitizeBranchName', () => {
    it('should lowercase and replace spaces with hyphens', () => {
      expect(service.sanitizeBranchName('Hello World')).toBe('hello-world')
    })

    it('should remove special characters', () => {
      expect(service.sanitizeBranchName('feat!@#$%test')).toBe('feattest')
    })

    it('should collapse multiple hyphens', () => {
      expect(service.sanitizeBranchName('hello---world')).toBe('hello-world')
    })

    it('should trim leading/trailing hyphens', () => {
      expect(service.sanitizeBranchName('-hello-world-')).toBe('hello-world')
    })

    it('should return empty string for empty input', () => {
      expect(service.sanitizeBranchName('')).toBe('')
    })

    it('should handle underscores (allowed)', () => {
      expect(service.sanitizeBranchName('hello_world')).toBe('hello_world')
    })
  })

  describe('generateBranchSuffix', () => {
    it('should use shortName when provided', () => {
      const result = service.generateBranchSuffix('my-feature', 'some prompt')
      expect(result).toBe('my-feature')
    })

    it('should sanitize shortName', () => {
      const result = service.generateBranchSuffix('My Feature!', 'some prompt')
      expect(result).toBe('my-feature')
    })

    it('should use first 3 words of prompt when no shortName', () => {
      const result = service.generateBranchSuffix(undefined, 'fix the broken tests')
      expect(result).toBe('fix-the-broken')
    })

    it('should default to "handoff" when no shortName or prompt', () => {
      const result = service.generateBranchSuffix(undefined, undefined)
      expect(result).toBe('handoff')
    })

    it('should default to "handoff" when prompt sanitizes to empty', () => {
      const result = service.generateBranchSuffix(undefined, '!@#$%')
      expect(result).toBe('handoff')
    })
  })

  describe('getDefaultBranch', () => {
    it('should return branch from config when available', async () => {
      vi.mocked(mockProjectConfig.getProjectConfig).mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: 'develop' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      })

      const result = await service.getDefaultBranch('/projects/myrepo', '/projects/myrepo-1')
      expect(result).toBe('develop')
    })

    it('should try gh CLI when config has no branch', async () => {
      vi.mocked(mockProjectConfig.getProjectConfig).mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: '' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      })
      mockExec.mockImplementation(((_cmd: string, _opts: any, callback?: any) => {
        if (callback) callback(null, 'main\n', '')
        return {} as any
      }) as any)

      const result = await service.getDefaultBranch('/projects/myrepo', '/projects/myrepo-1')
      expect(result).toBe('main')
    })

    it('should fallback to git branch check when gh fails', async () => {
      vi.mocked(mockProjectConfig.getProjectConfig).mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: '' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      })

      let callCount = 0
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        callCount++
        if (callCount === 1) {
          cb(new Error('gh not found'), '', '')
        } else {
          cb(null, '  remotes/origin/main\n  remotes/origin/develop\n', '')
        }
        return {} as any
      }) as any)

      const result = await service.getDefaultBranch('/projects/myrepo', '/projects/myrepo-1')
      expect(result).toBe('main')
    })

    it('should return "master" as final fallback', async () => {
      vi.mocked(mockProjectConfig.getProjectConfig).mockReturnValue({
        project: { name: 'myrepo', defaultBaseBranch: '' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      })

      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(new Error('fail'), '', '')
        return {} as any
      }) as any)

      const result = await service.getDefaultBranch('/projects/myrepo', '/projects/myrepo-1')
      expect(result).toBe('master')
    })
  })

  describe('getRemote', () => {
    it('should return "origin" when it is listed', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, 'origin\nupstream\n', '')
        return {} as any
      }) as any)
      const result = await service.getRemote('/projects/myrepo-1')
      expect(result).toBe('origin')
    })

    it('should return first remote when origin is not listed', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, 'upstream\n', '')
        return {} as any
      }) as any)
      const result = await service.getRemote('/projects/myrepo-1')
      expect(result).toBe('upstream')
    })

    it('should return "origin" as fallback on error', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(new Error('git error'), '', '')
        return {} as any
      }) as any)
      const result = await service.getRemote('/projects/myrepo-1')
      expect(result).toBe('origin')
    })
  })

  describe('commitSetupFiles', () => {
    it('should do nothing when no uncommitted changes', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, '', '')
        return {} as any
      }) as any)
      await service.commitSetupFiles('/projects/myrepo-1')
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('should add and commit when there are changes', async () => {
      let execCallCount = 0
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        execCallCount++
        if (execCallCount === 1) {
          cb(null, 'M file.txt\n', '')
        } else {
          cb(null, '', '')
        }
        return {} as any
      }) as any)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(null, '', '')
        return {} as any
      }) as any)

      await service.commitSetupFiles('/projects/myrepo-1')
      expect(mockExecFile).toHaveBeenCalled()
    })

    it('should handle identity unknown error', async () => {
      let execCallCount = 0
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        execCallCount++
        cb(null, execCallCount === 1 ? 'M file.txt\n' : '', '')
        return {} as any
      }) as any)

      let execFileCallCount = 0
      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        execFileCallCount++
        if (execFileCallCount === 1) {
          const error = new Error('identity unknown') as any
          error.stderr = 'identity unknown'
          cb(error, '', '')
        } else {
          cb(null, '', '')
        }
        return {} as any
      }) as any)

      await service.commitSetupFiles('/projects/myrepo-1')
      // first commit fail, config email, config name, retry commit
      expect(mockExecFile).toHaveBeenCalledTimes(4)
    })
  })

  describe('commitCurrentChanges', () => {
    it('should return success when no changes', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        cb(null, '', '')
        return {} as any
      }) as any)
      const result = await service.commitCurrentChanges('/projects/myrepo-1')
      expect(result).toEqual({ success: true })
    })

    it('should commit and return success', async () => {
      let execCallCount = 0
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        execCallCount++
        cb(null, execCallCount === 1 ? 'M file.txt\n' : '', '')
        return {} as any
      }) as any)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        cb(null, '', '')
        return {} as any
      }) as any)

      const result = await service.commitCurrentChanges('/projects/myrepo-1')
      expect(result).toEqual({ success: true })
    })

    it('should return error on pre-commit hook failure', async () => {
      let execCallCount = 0
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        execCallCount++
        cb(null, execCallCount === 1 ? 'M file.txt\n' : '', '')
        return {} as any
      }) as any)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        const error = new Error('hook failed') as any
        error.stderr = 'pre-commit hook failed'
        error.stdout = ''
        cb(error, '', '')
        return {} as any
      }) as any)

      const result = await service.commitCurrentChanges('/projects/myrepo-1')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Pre-commit hooks failed')
    })

    it('should return error on general commit failure', async () => {
      let execCallCount = 0
      mockExec.mockImplementation(((_cmd: string, _opts: any, cb?: any) => {
        execCallCount++
        cb(null, execCallCount === 1 ? 'M file.txt\n' : '', '')
        return {} as any
      }) as any)

      mockExecFile.mockImplementation(((_file: string, _args: any, _opts: any, cb?: any) => {
        const error = new Error('some other error') as any
        error.stderr = ''
        error.stdout = ''
        cb(error, '', '')
        return {} as any
      }) as any)

      const result = await service.commitCurrentChanges('/projects/myrepo-1')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to commit changes')
    })
  })
})
