import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn()
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/minion-test')
}))

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn()
}))

// Mock logger
vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('TerminalService - Non-Git Support', () => {
  let terminalService: TerminalService
  let mockMainWindow: any

  beforeEach(() => {
    mockMainWindow = {
      webContents: {
        send: vi.fn()
      },
      isDestroyed: vi.fn().mockReturnValue(false)
    } as unknown as BrowserWindow

    terminalService = new TerminalService(mockMainWindow)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getWorktreePath', () => {
    it('should return workingDirectory for non-git agents', () => {
      const mockAgentService = {
        readAgentInfo: vi.fn().mockReturnValue({
          agentId: 'test-agent-1',
          workingDirectory: '/home/user/my-project',
          branch: undefined
        }),
        getProjectName: vi.fn().mockReturnValue('my-project')
      }

      terminalService.setAgentService(mockAgentService as any)

      // Access private method via any
      const getWorktreePath = (terminalService as any).getWorktreePath.bind(terminalService)
      const result = getWorktreePath('/home/user/my-project', 'test-agent-1')

      expect(result).toBe('/home/user/my-project')
      expect(mockAgentService.readAgentInfo).toHaveBeenCalledWith(
        '/home/user/my-project',
        'test-agent-1',
        '/home/user/my-project'
      )
    })

    it('should fall through to git worktree path when workingDirectory is not set', () => {
      const mockAgentService = {
        readAgentInfo: vi.fn().mockReturnValue({
          agentId: 'my-project-1',
          branch: 'feature/test'
          // No workingDirectory
        }),
        getProjectName: vi.fn().mockReturnValue('my-project')
      }

      terminalService.setAgentService(mockAgentService as any)

      const getWorktreePath = (terminalService as any).getWorktreePath.bind(terminalService)
      const result = getWorktreePath('/home/user/my-project', 'my-project-1')

      // Should compute git worktree path: ../my-project-1
      expect(result).toContain('my-project-1')
      expect(result).not.toBe('/home/user/my-project')
    })

    it('should fall through to git worktree path when readAgentInfo returns null', () => {
      const mockAgentService = {
        readAgentInfo: vi.fn().mockReturnValue(null),
        getProjectName: vi.fn().mockReturnValue('my-project')
      }

      terminalService.setAgentService(mockAgentService as any)

      const getWorktreePath = (terminalService as any).getWorktreePath.bind(terminalService)
      const result = getWorktreePath('/home/user/my-project', 'my-project-1')

      // Should compute git worktree path
      expect(result).toContain('my-project-1')
    })

    it('should return project path for base branch agents regardless of workingDirectory', () => {
      const mockAgentService = {
        readAgentInfo: vi.fn().mockReturnValue({
          agentId: 'my-project-base',
          workingDirectory: '/some/other/path'
        }),
        getProjectName: vi.fn().mockReturnValue('my-project')
      }

      terminalService.setAgentService(mockAgentService as any)

      const getWorktreePath = (terminalService as any).getWorktreePath.bind(terminalService)
      const result = getWorktreePath('/home/user/my-project', 'my-project-base')

      // Base agents always work in the main project directory
      expect(result).toBe('/home/user/my-project')
      // readAgentInfo should NOT have been called for base agents (returns early)
      expect(mockAgentService.readAgentInfo).not.toHaveBeenCalled()
    })

    it('should handle workingDirectory with relative components', () => {
      const mockAgentService = {
        readAgentInfo: vi.fn().mockReturnValue({
          agentId: 'test-agent-1',
          workingDirectory: '/home/user/../user/my-project'
        }),
        getProjectName: vi.fn().mockReturnValue('my-project')
      }

      terminalService.setAgentService(mockAgentService as any)

      const getWorktreePath = (terminalService as any).getWorktreePath.bind(terminalService)
      const result = getWorktreePath('/home/user/my-project', 'test-agent-1')

      // resolve() should normalize the path
      expect(result).toBe('/home/user/my-project')
    })
  })

  describe('branch references handle undefined gracefully', () => {
    it('formatDisplayName should handle undefined branch', () => {
      const formatDisplayName = (terminalService as any).formatDisplayName.bind(terminalService)

      // agentInfo with no branch
      const result = formatDisplayName('/home/user/my-project', { branch: undefined }, 'agent-1')
      expect(result).toBe('my-project: agent-1')
    })

    it('formatDisplayName should handle present branch', () => {
      const formatDisplayName = (terminalService as any).formatDisplayName.bind(terminalService)

      const result = formatDisplayName('/home/user/my-project', { branch: 'feature/test-branch' }, 'agent-1')
      expect(result).toBe('my-project: test-branch')
    })
  })
})
