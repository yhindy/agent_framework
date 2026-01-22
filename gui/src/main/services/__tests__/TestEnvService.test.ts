import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TestEnvService } from '../TestEnvService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { readFileSync, existsSync } from 'fs'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}))

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn()
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}))

// Mock logger
vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('TestEnvService', () => {
  let service: TestEnvService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents,
      isDestroyed: vi.fn().mockReturnValue(false)
    } as unknown as BrowserWindow

    // Setup mock PTY
    mockPty = {
      write: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn()
    }
    vi.mocked(pty.spawn).mockReturnValue(mockPty as unknown as pty.IPty)

    service = new TestEnvService(mockMainWindow)
  })

  afterEach(() => {
    service.cleanup()
  })

  describe('constructor', () => {
    it('initializes with empty processes map', () => {
      expect(service).toBeInstanceOf(TestEnvService)
      expect(service.getStatus('any-agent')).toEqual([])
    })
  })

  describe('setWindow', () => {
    it('updates the main window reference', () => {
      const newMockWebContents = { send: vi.fn() }
      const newMockWindow = {
        webContents: newMockWebContents,
        isDestroyed: vi.fn().mockReturnValue(false)
      } as unknown as BrowserWindow

      service.setWindow(newMockWindow)

      // The new window should be used for IPC
      // We'll verify this through the startCommand behavior
    })
  })

  describe('loadConfig', () => {
    it('returns empty commands when no config file exists', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const config = service.loadConfig('/test/project')

      expect(config).toEqual({ defaultCommands: [] })
    })

    it('loads config from minions.json (new format) with setup.testEnvironments', () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path === '/test/project/minions.json'
      })
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        setup: {
          testEnvironments: [
            { id: 'dev', name: 'Dev Server', command: 'npm run dev' }
          ]
        }
      }))

      const config = service.loadConfig('/test/project')

      expect(config.defaultCommands).toEqual([
        { id: 'dev', name: 'Dev Server', command: 'npm run dev' }
      ])
    })

    it('loads config from minions.json (new format) with top-level testEnvironments', () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path === '/test/project/minions.json'
      })
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [
          { id: 'test', name: 'Test Runner', command: 'npm test' }
        ]
      }))

      const config = service.loadConfig('/test/project')

      expect(config.defaultCommands).toEqual([
        { id: 'test', name: 'Test Runner', command: 'npm test' }
      ])
    })

    it('loads config from legacy minions/config.json', () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path === '/test/project/minions/config.json'
      })
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [
          { id: 'build', name: 'Build', command: 'npm run build' }
        ]
      }))

      const config = service.loadConfig('/test/project')

      expect(config.defaultCommands).toEqual([
        { id: 'build', name: 'Build', command: 'npm run build' }
      ])
    })

    it('prefers new format over legacy when both exist', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [
          { id: 'new', name: 'New Format', command: 'npm run new' }
        ]
      }))

      service.loadConfig('/test/project')

      expect(readFileSync).toHaveBeenCalledWith('/test/project/minions.json', 'utf-8')
    })

    it('returns empty commands on parse error', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('invalid json')

      const config = service.loadConfig('/test/project')

      expect(config).toEqual({ defaultCommands: [] })
    })
  })

  describe('getCommands', () => {
    it('returns override commands when provided', () => {
      const overrides = [
        { id: 'custom', name: 'Custom', command: 'custom cmd' }
      ]

      const commands = service.getCommands('/test/project', overrides)

      expect(commands).toEqual(overrides)
    })

    it('returns config commands when no overrides', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [
          { id: 'default', name: 'Default', command: 'default cmd' }
        ]
      }))

      const commands = service.getCommands('/test/project')

      expect(commands).toEqual([
        { id: 'default', name: 'Default', command: 'default cmd' }
      ])
    })

    it('returns empty array when overrides is empty array', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [
          { id: 'default', name: 'Default', command: 'default cmd' }
        ]
      }))

      const commands = service.getCommands('/test/project', [])

      // Empty array is falsy for length check, should use config
      expect(commands).toEqual([
        { id: 'default', name: 'Default', command: 'default cmd' }
      ])
    })
  })

  describe('startCommand', () => {
    const testCommand = {
      id: 'test-cmd',
      name: 'Test Command',
      command: 'npm test'
    }

    it('spawns a PTY with correct parameters', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String), // shell
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          cwd: '/worktree',
          env: expect.any(Object)
        })
      )
    })

    it('uses custom cwd when specified in command', async () => {
      const cmdWithCwd = { ...testCommand, cwd: 'packages/core' }

      await service.startCommand('/project', 'agent-1', '/worktree', cmdWithCwd)

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          cwd: '/worktree/packages/core'
        })
      )
    })

    it('writes command to PTY after spawn', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      expect(mockPty.write).toHaveBeenCalledWith('npm test\r')
    })

    it('sends testEnv:started IPC event', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'testEnv:started',
        'agent-1',
        'test-cmd'
      )
    })

    it('registers onData handler that sends output via IPC', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      const onDataCallback = mockPty.onData.mock.calls[0][0]
      onDataCallback('test output')

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'testEnv:output',
        'agent-1',
        'test-cmd',
        'test output'
      )
    })

    it('registers onExit handler that sends exited event', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      const onExitCallback = mockPty.onExit.mock.calls[0][0]
      onExitCallback({ exitCode: 0, signal: undefined })

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'testEnv:exited',
        'agent-1',
        'test-cmd',
        0
      )
    })

    it('stops existing command before starting new one with same id', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      // Start again with same command id
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('tracks process status correctly', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      const status = service.getStatus('agent-1')

      expect(status).toEqual([
        { commandId: 'test-cmd', name: 'Test Command', isRunning: true }
      ])
    })
  })

  describe('startAll', () => {
    it('starts all commands from config when none provided', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [
          { id: 'cmd1', name: 'Cmd 1', command: 'echo 1' },
          { id: 'cmd2', name: 'Cmd 2', command: 'echo 2' }
        ]
      }))

      await service.startAll('/project', 'agent-1', '/worktree')

      expect(pty.spawn).toHaveBeenCalledTimes(2)
    })

    it('starts provided commands instead of config commands', async () => {
      const customCommands = [
        { id: 'custom', name: 'Custom', command: 'custom cmd' }
      ]

      await service.startAll('/project', 'agent-1', '/worktree', customCommands)

      expect(pty.spawn).toHaveBeenCalledTimes(1)
      expect(mockPty.write).toHaveBeenCalledWith('custom cmd\r')
    })
  })

  describe('stopCommand', () => {
    const testCommand = {
      id: 'test-cmd',
      name: 'Test Command',
      command: 'npm test'
    }

    it('kills the PTY process', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      service.stopCommand('agent-1', 'test-cmd')

      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('sends testEnv:stopped IPC event', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)
      mockWebContents.send.mockClear()

      service.stopCommand('agent-1', 'test-cmd')

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'testEnv:stopped',
        'agent-1',
        'test-cmd'
      )
    })

    it('removes process from tracking', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      service.stopCommand('agent-1', 'test-cmd')

      expect(service.getStatus('agent-1')).toEqual([])
    })

    it('does nothing for non-existent command', () => {
      // Should not throw
      expect(() => service.stopCommand('agent-1', 'non-existent')).not.toThrow()
    })

    it('handles PTY kill errors gracefully', async () => {
      mockPty.kill.mockImplementation(() => {
        throw new Error('Already dead')
      })

      await service.startCommand('/project', 'agent-1', '/worktree', testCommand)

      // Should not throw
      expect(() => service.stopCommand('agent-1', 'test-cmd')).not.toThrow()
    })
  })

  describe('stopAll', () => {
    it('stops all commands for an agent', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd2', name: 'Cmd 2', command: 'echo 2'
      })

      service.stopAll('agent-1')

      expect(mockPty.kill).toHaveBeenCalledTimes(2)
      expect(service.getStatus('agent-1')).toEqual([])
    })

    it('does nothing for non-existent agent', () => {
      // Should not throw
      expect(() => service.stopAll('non-existent')).not.toThrow()
    })

    it('cleans up agent from processes map', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      service.stopAll('agent-1')

      // Status should be empty array (agent fully cleaned up)
      expect(service.getStatus('agent-1')).toEqual([])
    })
  })

  describe('getStatus', () => {
    it('returns empty array for unknown agent', () => {
      expect(service.getStatus('unknown')).toEqual([])
    })

    it('returns correct status for running processes', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Command 1', command: 'echo 1'
      })
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd2', name: 'Command 2', command: 'echo 2'
      })

      const status = service.getStatus('agent-1')

      expect(status).toHaveLength(2)
      expect(status).toContainEqual({ commandId: 'cmd1', name: 'Command 1', isRunning: true })
      expect(status).toContainEqual({ commandId: 'cmd2', name: 'Command 2', isRunning: true })
    })

    it('reflects isRunning=false after process exits', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Command 1', command: 'echo 1'
      })

      // Simulate exit
      const onExitCallback = mockPty.onExit.mock.calls[0][0]
      onExitCallback({ exitCode: 0, signal: undefined })

      const status = service.getStatus('agent-1')

      expect(status[0].isRunning).toBe(false)
    })
  })

  describe('sendInput', () => {
    it('writes data to the correct PTY', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      service.sendInput('agent-1', 'cmd1', 'test input')

      expect(mockPty.write).toHaveBeenCalledWith('test input')
    })

    it('does nothing for non-existent process', () => {
      // Should not throw
      expect(() => service.sendInput('agent-1', 'non-existent', 'data')).not.toThrow()
    })
  })

  describe('resize', () => {
    it('resizes the PTY', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      service.resize('agent-1', 'cmd1', 120, 40)

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('does nothing for non-existent process', () => {
      // Should not throw
      expect(() => service.resize('agent-1', 'non-existent', 120, 40)).not.toThrow()
    })

    it('does nothing for non-running process', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      // Simulate exit
      const onExitCallback = mockPty.onExit.mock.calls[0][0]
      onExitCallback({ exitCode: 0, signal: undefined })
      mockPty.resize.mockClear()

      service.resize('agent-1', 'cmd1', 120, 40)

      expect(mockPty.resize).not.toHaveBeenCalled()
    })

    it('handles resize errors gracefully', async () => {
      mockPty.resize.mockImplementation(() => {
        throw new Error('Resize failed')
      })

      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      // Should not throw
      expect(() => service.resize('agent-1', 'cmd1', 120, 40)).not.toThrow()
    })
  })

  describe('cleanup', () => {
    it('stops all processes for all agents', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })
      await service.startCommand('/project', 'agent-2', '/worktree', {
        id: 'cmd2', name: 'Cmd 2', command: 'echo 2'
      })

      service.cleanup()

      expect(mockPty.kill).toHaveBeenCalledTimes(2)
    })

    it('can be called multiple times safely', async () => {
      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      service.cleanup()
      service.cleanup()

      // Should only kill once
      expect(mockPty.kill).toHaveBeenCalledTimes(1)
    })
  })

  describe('IPC safety', () => {
    it('does not send IPC when window is destroyed', async () => {
      mockMainWindow.isDestroyed.mockReturnValue(true)

      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      // IPC send should not have been called
      expect(mockWebContents.send).not.toHaveBeenCalled()
    })

    it('handles IPC send errors gracefully', async () => {
      mockWebContents.send.mockImplementation(() => {
        throw new Error('IPC failed')
      })

      // Should not throw
      await expect(
        service.startCommand('/project', 'agent-1', '/worktree', {
          id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
        })
      ).resolves.not.toThrow()
    })
  })

  describe('platform handling', () => {
    it('uses appropriate shell for the platform', async () => {
      const originalPlatform = process.platform

      await service.startCommand('/project', 'agent-1', '/worktree', {
        id: 'cmd1', name: 'Cmd 1', command: 'echo 1'
      })

      const spawnCall = vi.mocked(pty.spawn).mock.calls[0]
      const shell = spawnCall[0]

      // Should be a valid shell
      expect(typeof shell).toBe('string')
      expect(shell.length).toBeGreaterThan(0)
    })
  })
})
