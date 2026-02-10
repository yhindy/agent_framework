import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
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

describe('AgentService - Default Branch Detection', () => {
  let agentService: AgentService
  const projectPath = '/test/project'

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getDefaultBranch via ensureBaseBranchAgent', () => {
    it('should detect "master" as default branch when no config exists and gh reports master', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.endsWith('.git')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        throw new Error(`File not found: ${path}`)
      })

      vi.mocked(childProcess.exec).mockImplementation(((
        command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'function') {
          callback = options
        }
        if (callback) {
          if (command.includes('gh repo view')) {
            callback(null, { stdout: 'master\n', stderr: '' })
          } else {
            callback(null, { stdout: '', stderr: '' })
          }
        }
        return {} as any
      }) as any)

      const result = await agentService.ensureBaseBranchAgent(projectPath)

      expect(result.branch).toBe('master')
      expect(result.feature).toContain('master')
    })

    it('should detect "master" via git branch fallback when no config and gh CLI fails', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.endsWith('.git')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        throw new Error(`File not found: ${path}`)
      })

      vi.mocked(childProcess.exec).mockImplementation(((
        command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'function') {
          callback = options
        }
        if (callback) {
          if (command.includes('gh repo view')) {
            callback(new Error('gh not installed'), { stdout: '', stderr: 'gh not found' })
          } else if (command.includes('git branch -a')) {
            callback(null, {
              stdout: '  master\n  remotes/origin/master\n',
              stderr: ''
            })
          } else {
            callback(null, { stdout: '', stderr: '' })
          }
        }
        return {} as any
      }) as any)

      const result = await agentService.ensureBaseBranchAgent(projectPath)

      expect(result.branch).toBe('master')
      expect(result.feature).toContain('master')
    })
  })

  describe('ensureBaseBranchAgent stale branch update', () => {
    it('should update cached base agent info when the detected branch differs from stored branch', async () => {
      const staleInfo = {
        id: 'unknown-base-123',
        agentId: 'unknown-base',
        branch: 'master',
        project: 'unknown',
        feature: 'Base Branch (master)',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        prompt: 'You are helping maintain the master branch of unknown.',
        model: 'opus',
        chrome: true,
        createdAt: '2025-01-01T00:00:00.000Z',
        lastActivity: '2025-01-01T00:00:00.000Z',
        isBaseBranchAgent: true
      }

      // .minions-base-info exists with stale "master" branch
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.endsWith('.git')) return true
        if (String(path).endsWith('.minions-base-info')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('.minions-base-info')) {
          return JSON.stringify(staleInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      // gh reports "main" as the default branch now
      vi.mocked(childProcess.exec).mockImplementation(((
        command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'function') {
          callback = options
        }
        if (callback) {
          if (command.includes('gh repo view')) {
            callback(null, { stdout: 'main\n', stderr: '' })
          } else {
            callback(null, { stdout: '', stderr: '' })
          }
        }
        return {} as any
      }) as any)

      const result = await agentService.ensureBaseBranchAgent(projectPath)

      // Should return updated info with "main"
      expect(result.branch).toBe('main')
      expect(result.feature).toBe('Base Branch (main)')
      expect(result.prompt).toContain('main')
      expect(result.prompt).not.toContain('master')

      // Should have written the updated info back to disk
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.minions-base-info'),
        expect.stringContaining('"branch": "main"')
      )
    })

    it('should not rewrite base agent info when the branch has not changed', async () => {
      const currentInfo = {
        id: 'unknown-base-123',
        agentId: 'unknown-base',
        branch: 'main',
        project: 'unknown',
        feature: 'Base Branch (main)',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        prompt: 'You are helping maintain the main branch of unknown.',
        model: 'opus',
        chrome: true,
        createdAt: '2025-01-01T00:00:00.000Z',
        lastActivity: '2025-01-01T00:00:00.000Z',
        isBaseBranchAgent: true
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (typeof path === 'string' && path.endsWith('.git')) return true
        if (String(path).endsWith('.minions-base-info')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (String(path).endsWith('.minions-base-info')) {
          return JSON.stringify(currentInfo)
        }
        throw new Error(`File not found: ${path}`)
      })

      // gh also reports "main" - no change
      vi.mocked(childProcess.exec).mockImplementation(((
        command: string,
        options: any,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (!callback && typeof options === 'function') {
          callback = options
        }
        if (callback) {
          if (command.includes('gh repo view')) {
            callback(null, { stdout: 'main\n', stderr: '' })
          } else {
            callback(null, { stdout: '', stderr: '' })
          }
        }
        return {} as any
      }) as any)

      const result = await agentService.ensureBaseBranchAgent(projectPath)

      expect(result.branch).toBe('main')
      // writeFileSync should NOT have been called since nothing changed
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })
  })
})
