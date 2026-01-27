import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TestEnvService } from '../TestEnvService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { readFileSync, existsSync } from 'fs'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(), existsSync: vi.fn() }))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

describe('TestEnvService', () => {
  let service: TestEnvService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockWebContents = { send: vi.fn() }
    mockMainWindow = {
      webContents: mockWebContents,
      isDestroyed: vi.fn().mockReturnValue(false)
    } as unknown as BrowserWindow

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

  describe('loadConfig', () => {
    it('returns empty commands when no config exists', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      expect(service.loadConfig('/test')).toEqual({ defaultCommands: [] })
    })

    it('loads from minions.json setup.testEnvironments', () => {
      vi.mocked(existsSync).mockImplementation((p: any) => p === '/test/minions.json')
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        setup: { testEnvironments: [{ id: 'dev', name: 'Dev', command: 'npm dev' }] }
      }))

      const config = service.loadConfig('/test')
      expect(config.defaultCommands).toEqual([{ id: 'dev', name: 'Dev', command: 'npm dev' }])
    })

    it('loads from minions.json top-level testEnvironments', () => {
      vi.mocked(existsSync).mockImplementation((p: any) => p === '/test/minions.json')
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [{ id: 'test', name: 'Test', command: 'npm test' }]
      }))

      const config = service.loadConfig('/test')
      expect(config.defaultCommands).toEqual([{ id: 'test', name: 'Test', command: 'npm test' }])
    })

    it('loads from legacy minions/config.json when new format missing', () => {
      vi.mocked(existsSync).mockImplementation((p: any) => p === '/test/minions/config.json')
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [{ id: 'build', name: 'Build', command: 'npm build' }]
      }))

      const config = service.loadConfig('/test')
      expect(config.defaultCommands).toEqual([{ id: 'build', name: 'Build', command: 'npm build' }])
    })

    it('prefers new format over legacy', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('{}')

      service.loadConfig('/test')
      expect(readFileSync).toHaveBeenCalledWith('/test/minions.json', 'utf-8')
    })

    it('returns empty on JSON parse error', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('not json')

      expect(service.loadConfig('/test')).toEqual({ defaultCommands: [] })
    })
  })

  describe('getCommands', () => {
    it('returns overrides when provided', () => {
      const overrides = [{ id: 'custom', name: 'Custom', command: 'custom' }]
      expect(service.getCommands('/test', overrides)).toEqual(overrides)
    })

    it('falls back to config when overrides empty', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        testEnvironments: [{ id: 'cfg', name: 'Config', command: 'config' }]
      }))

      expect(service.getCommands('/test', [])).toEqual([{ id: 'cfg', name: 'Config', command: 'config' }])
    })
  })

  describe('startCommand', () => {
    const cmd = { id: 'test', name: 'Test', command: 'npm test' }

    it('spawns PTY in worktree directory', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({ cwd: '/worktree' })
      )
    })

    it('uses command.cwd relative to worktree when specified', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { ...cmd, cwd: 'packages/core' })

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String), [], expect.objectContaining({ cwd: '/worktree/packages/core' })
      )
    })

    it('writes command to PTY with carriage return', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      expect(mockPty.write).toHaveBeenCalledWith('npm test\r')
    })

    it('sends testEnv:started IPC event', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      expect(mockWebContents.send).toHaveBeenCalledWith('testEnv:started', 'agent-1', 'test')
    })

    it('forwards PTY output via IPC', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      const onDataCb = mockPty.onData.mock.calls[0][0]
      onDataCb('output data')

      expect(mockWebContents.send).toHaveBeenCalledWith('testEnv:output', 'agent-1', 'test', 'output data')
    })

    it('sends exit event and marks process as not running on exit', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      const onExitCb = mockPty.onExit.mock.calls[0][0]
      onExitCb({ exitCode: 1, signal: undefined })

      expect(mockWebContents.send).toHaveBeenCalledWith('testEnv:exited', 'agent-1', 'test', 1)
      expect(service.getStatus('agent-1')[0].isRunning).toBe(false)
    })

    it('stops existing command with same ID before starting new one', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      expect(mockPty.kill).toHaveBeenCalledTimes(1)
    })

    it('tracks multiple commands per agent', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'a', name: 'A', command: 'a' })
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'b', name: 'B', command: 'b' })

      expect(service.getStatus('agent-1')).toHaveLength(2)
    })
  })

  describe('stopCommand', () => {
    const cmd = { id: 'test', name: 'Test', command: 'npm test' }

    it('kills PTY and sends stopped event', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)
      mockWebContents.send.mockClear()

      service.stopCommand('agent-1', 'test')

      expect(mockPty.kill).toHaveBeenCalled()
      expect(mockWebContents.send).toHaveBeenCalledWith('testEnv:stopped', 'agent-1', 'test')
    })

    it('removes command from tracking', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)
      service.stopCommand('agent-1', 'test')

      expect(service.getStatus('agent-1')).toEqual([])
    })

    it('handles already-dead PTY gracefully', async () => {
      mockPty.kill.mockImplementation(() => { throw new Error('No such process') })
      await service.startCommand('/proj', 'agent-1', '/worktree', cmd)

      expect(() => service.stopCommand('agent-1', 'test')).not.toThrow()
    })

    it('is safe for non-existent command', () => {
      expect(() => service.stopCommand('agent-1', 'nonexistent')).not.toThrow()
    })
  })

  describe('stopAll', () => {
    it('stops all commands for an agent', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'a', name: 'A', command: 'a' })
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'b', name: 'B', command: 'b' })

      service.stopAll('agent-1')

      expect(mockPty.kill).toHaveBeenCalledTimes(2)
      expect(service.getStatus('agent-1')).toEqual([])
    })

    it('is safe for non-existent agent', () => {
      expect(() => service.stopAll('nonexistent')).not.toThrow()
    })
  })

  describe('sendInput', () => {
    it('writes to correct PTY', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })

      service.sendInput('agent-1', 'cmd', 'input\n')

      expect(mockPty.write).toHaveBeenCalledWith('input\n')
    })

    it('is safe for non-existent process', () => {
      expect(() => service.sendInput('agent-1', 'nonexistent', 'data')).not.toThrow()
    })
  })

  describe('resize', () => {
    it('resizes running PTY', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })

      service.resize('agent-1', 'cmd', 120, 40)

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('skips resize for exited process', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })
      mockPty.onExit.mock.calls[0][0]({ exitCode: 0 })
      mockPty.resize.mockClear()

      service.resize('agent-1', 'cmd', 120, 40)

      expect(mockPty.resize).not.toHaveBeenCalled()
    })

    it('handles resize errors gracefully', async () => {
      mockPty.resize.mockImplementation(() => { throw new Error('Resize failed') })
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })

      expect(() => service.resize('agent-1', 'cmd', 120, 40)).not.toThrow()
    })
  })

  describe('cleanup', () => {
    it('stops all processes across all agents', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'a', name: 'A', command: 'a' })
      await service.startCommand('/proj', 'agent-2', '/worktree', { id: 'b', name: 'B', command: 'b' })

      service.cleanup()

      expect(mockPty.kill).toHaveBeenCalledTimes(2)
    })

    it('is idempotent', async () => {
      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'a', name: 'A', command: 'a' })

      service.cleanup()
      service.cleanup()

      expect(mockPty.kill).toHaveBeenCalledTimes(1)
    })
  })

  describe('IPC safety', () => {
    it('skips IPC when window is destroyed', async () => {
      mockMainWindow.isDestroyed.mockReturnValue(true)

      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })

      expect(mockWebContents.send).not.toHaveBeenCalled()
    })

    it('handles IPC errors gracefully', async () => {
      mockWebContents.send.mockImplementation(() => { throw new Error('IPC failed') })

      await expect(
        service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })
      ).resolves.not.toThrow()
    })
  })

  describe('setWindow', () => {
    it('uses new window for IPC after switch', async () => {
      const newWebContents = { send: vi.fn() }
      const newWindow = { webContents: newWebContents, isDestroyed: vi.fn().mockReturnValue(false) } as unknown as BrowserWindow

      await service.startCommand('/proj', 'agent-1', '/worktree', { id: 'cmd', name: 'Cmd', command: 'cmd' })
      service.setWindow(newWindow)

      // Trigger output on existing PTY
      mockPty.onData.mock.calls[0][0]('new output')

      expect(newWebContents.send).toHaveBeenCalledWith('testEnv:output', 'agent-1', 'cmd', 'new output')
    })
  })
})
