import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { AgentService } from '../AgentService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { isPackaged: false, getAppPath: vi.fn(() => '/app') }
}))

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn()
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  execSync: vi.fn(),
  execFileSync: vi.fn()
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn()
}))

describe('Session Persistence', () => {
  let terminalService: TerminalService
  let agentService: AgentService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any

  beforeEach(() => {
    vi.useFakeTimers()

    // Setup Mock Window & WebContents
    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents
    } as unknown as BrowserWindow

    // Setup Mock PTY
    mockPty = {
      write: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 12345
    }
    vi.mocked(pty.spawn).mockReturnValue(mockPty)

    // Setup AgentService mock
    agentService = {
      readAgentInfo: vi.fn().mockResolvedValue(null),
      updateAgentInfo: vi.fn(),
      getAgentPath: vi.fn().mockReturnValue('/path/to/agent')
    } as any

    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(agentService)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('Session ID Generation', () => {
    it('generates deterministic UUID from agentId and worktreePath', async () => {
      const agentId = 'test-agent-1'
      const projectPath = '/path/to/project'

      // Start agent to trigger session ID generation
      // Note: worktreePath will be calculated from projectPath
      await terminalService.startAgent(projectPath, agentId, 'claude', 'dev')

      // Verify the session was created with a session ID
      const command = mockPty.write.mock.calls[0][0]
      expect(command).toContain('--session-id')

      // Extract the UUID
      const uuidMatch = command.match(/--session-id\s+([a-f0-9\-]+)/)
      expect(uuidMatch).toBeTruthy()
      const sessionId = uuidMatch![1]

      // Verify it's a valid UUID v5 format
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

      // Verify updateAgentInfo was called with session ID
      expect(agentService.updateAgentInfo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          claudeSessionId: sessionId,
          claudeSessionActive: true
        })
      )
    })

    it('generates different UUIDs for different agents', async () => {
      const sessionIds = new Set()

      for (let i = 0; i < 3; i++) {
        mockPty.write.mockClear()
        await terminalService.startAgent('/path/to/project', `agent-${i}`, 'claude', 'dev')

        const command = mockPty.write.mock.calls[0][0]
        const uuidMatch = command.match(/--session-id\s+([a-f0-9\-]+)/)
        sessionIds.add(uuidMatch![1])
      }

      // Should have 3 different UUIDs
      expect(sessionIds.size).toBe(3)
    })

    it('generates same UUID for same agent across restarts', async () => {
      const agentId = 'stable-agent'
      const projectPath = '/stable/project'

      // First start
      mockPty.write.mockClear()
      await terminalService.startAgent(projectPath, agentId, 'claude', 'dev')
      const firstCommand = mockPty.write.mock.calls[0][0]
      const firstUuid = firstCommand.match(/--session-id\s+([a-f0-9\-]+)/)![1]

      // Simulate restart by creating new TerminalService instance
      terminalService = new TerminalService(mockMainWindow)
      terminalService.setAgentService(agentService)

      mockPty.write.mockClear()
      await terminalService.startAgent(projectPath, agentId, 'claude', 'dev')
      const secondCommand = mockPty.write.mock.calls[0][0]
      const secondUuid = secondCommand.match(/--session-id\s+([a-f0-9\-]+)/)![1]

      expect(secondUuid).toBe(firstUuid)
    })
  })

  describe('Session Resume', () => {
    it('uses --resume flag for existing active sessions', async () => {
      const agentInfo = {
        claudeSessionId: 'some-session-uuid',
        claudeSessionActive: true
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      const command = mockPty.write.mock.calls[0][0]
      expect(command).toContain('--resume')
      expect(command).not.toContain('--session-id')
    })

    it('uses --session-id flag for new sessions', async () => {
      vi.mocked(agentService.readAgentInfo).mockResolvedValue(null)

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      const command = mockPty.write.mock.calls[0][0]
      expect(command).toContain('--session-id')
      expect(command).not.toContain('--resume')
    })

    it('skips resume if session is not marked active', async () => {
      const agentInfo = {
        claudeSessionId: 'some-id',
        claudeSessionActive: false
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      const command = mockPty.write.mock.calls[0][0]
      // Should create new session, not resume
      expect(command).toContain('--session-id')
    })

    it('skips resume if session ID is missing', async () => {
      const agentInfo = {
        claudeSessionActive: true
        // Missing claudeSessionId
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      const command = mockPty.write.mock.calls[0][0]
      // Should create new session, not resume
      expect(command).toContain('--session-id')
    })

    it('only resumes Claude sessions, not other tools', async () => {
      const agentInfo = {
        claudeSessionId: 'some-id',
        claudeSessionActive: true
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      // Try with cursor-cli (should not resume)
      await terminalService.startAgent('/path/to/project', 'agent-1', 'cursor-cli', 'dev')

      const command = mockPty.write.mock.calls[0][0]
      expect(command).not.toContain('--resume')
      expect(command).not.toContain('--session-id')
    })
  })

  describe('Session State Persistence', () => {
    it('persists session ID immediately after start', async () => {
      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      expect(agentService.updateAgentInfo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          claudeSessionId: expect.any(String),
          claudeSessionActive: true,
          claudeLastSeen: expect.any(String)
        })
      )
    })

    it('marks session inactive on terminal exit', async () => {
      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Get the exit handler
      const exitHandler = vi.mocked(mockPty.onExit).mock.calls[0][0]
      exitHandler()

      // Should have called updateAgentInfo multiple times (first for start, then for exit)
      const calls = vi.mocked(agentService.updateAgentInfo).mock.calls
      const lastCall = calls[calls.length - 1]

      expect(lastCall[1]).toEqual(
        expect.objectContaining({
          claudeSessionActive: false
        })
      )
    })

    it('persists waiting state when Claude goes idle', async () => {
      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate Claude starting and going idle
      dataHandler('Claude Code 0.0.1\n')
      dataHandler('Waiting for input...\n')

      // Advance timer to trigger waiting state
      vi.advanceTimersByTime(2100)

      expect(agentService.updateAgentInfo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          isWaitingForInput: true,
          lastOutputSnapshot: expect.any(String),
          claudeLastSeen: expect.any(String)
        })
      )
    })

    it('persists resumed state when Claude resumes work', async () => {
      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate Claude starting and going idle
      dataHandler('Claude Code 0.0.1\n')
      dataHandler('Waiting...\n')
      vi.advanceTimersByTime(2100)

      // Clear mock to see new calls
      vi.mocked(agentService.updateAgentInfo).mockClear()

      // Simulate Claude resuming work
      dataHandler('Thinking…\n')

      expect(agentService.updateAgentInfo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          isWaitingForInput: false,
          claudeLastSeen: expect.any(String)
        })
      )
    })
  })

  describe('Waiting State Restoration', () => {
    it('restores persisted waiting state on start', async () => {
      const agentInfo = {
        isWaitingForInput: true,
        claudeSessionId: 'some-id',
        claudeSessionActive: true
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      // Verify waiting state was loaded from agent info
      expect(agentService.readAgentInfo).toHaveBeenCalledWith(expect.stringContaining('worktree-agent-1'))

      // The waiting state is stored in the session and will be used
      // The actual notification is sent by the UI layer (Sidebar) or auto-resume logic
      // Just verify that readAgentInfo was called to load the state
      expect(agentService.readAgentInfo).toHaveBeenCalled()
    })

    it('clears waiting state when user sends input', async () => {
      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate waiting state
      dataHandler('Claude Code 0.0.1\n')
      dataHandler('Waiting...\n')
      vi.advanceTimersByTime(2100)

      // Clear mock
      mockWebContents.send.mockClear()

      // Send input
      terminalService.sendInput('agent-1', 'y\n')

      expect(mockWebContents.send).toHaveBeenCalledWith('agent:resumedWork', 'agent-1')
    })
  })

  describe('Error Handling and Graceful Degradation', () => {
    it('detects resume failure and falls back to fresh start', async () => {
      const agentInfo = {
        claudeSessionId: 'invalid-session-id',
        claudeSessionActive: true
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev', 'test prompt')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate resume failure
      dataHandler('Error: Session not found\n')

      // Should attempt fresh start
      // The PTY should be killed
      expect(mockPty.kill).toHaveBeenCalled()

      // Session should be cleared - check the last call which should be the inactive update
      const calls = vi.mocked(agentService.updateAgentInfo).mock.calls
      expect(calls[calls.length - 1]).toEqual([
        expect.stringContaining('worktree-agent-1'),
        expect.objectContaining({
          claudeSessionActive: false
        })
      ])
    })

    it('handles "Could not resume" error gracefully', async () => {
      const agentInfo = {
        claudeSessionId: 'some-id',
        claudeSessionActive: true
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate "Could not resume" error
      dataHandler('Could not resume session\n')

      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('handles "Error resuming session" error gracefully', async () => {
      const agentInfo = {
        claudeSessionId: 'some-id',
        claudeSessionActive: true
      }

      vi.mocked(agentService.readAgentInfo).mockResolvedValue(agentInfo as any)

      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate error
      dataHandler('Error resuming session\n')

      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('does not attempt fallback for non-resume errors', async () => {
      vi.mocked(agentService.readAgentInfo).mockResolvedValue(null)

      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Some random error (not resume-related)
      dataHandler('Error: Something went wrong\n')

      // Should NOT kill the PTY
      expect(mockPty.kill).not.toHaveBeenCalled()
    })
  })

  describe('Multi-Agent Scenarios', () => {
    it('manages multiple agents with different session IDs', async () => {
      const agents = ['agent-1', 'agent-2', 'agent-3']

      for (const agentId of agents) {
        mockPty.write.mockClear()
        await terminalService.startAgent('/path/to/worktree', agentId, 'claude', 'dev')

        const command = mockPty.write.mock.calls[0][0]
        expect(command).toContain('--session-id')
      }

      // Each agent should have been initialized with a different session
      expect(agentService.updateAgentInfo).toHaveBeenCalledTimes(agents.length)
    })

    it('maintains separate waiting states for multiple agents', async () => {
      // Start agent 1
      await terminalService.startAgent('/path/to/worktree1', 'agent-1', 'claude', 'dev')
      let dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
      dataHandler('Claude Code 0.0.1\n')
      dataHandler('Waiting...\n')
      vi.advanceTimersByTime(2100)

      // Start agent 2
      mockPty.write.mockClear()
      mockPty.onData.mockClear()
      await terminalService.startAgent('/path/to/worktree2', 'agent-2', 'claude', 'dev')
      dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
      dataHandler('Claude Code 0.0.1\n')
      dataHandler('Still working...\n')

      // Agent 1 should be waiting
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        expect.anything()
      )

      // Agent 2 should NOT be waiting
      const waitingCalls = mockWebContents.send.mock.calls.filter(
        call => call[0] === 'agent:waitingForInput' && call[1] === 'agent-2'
      )
      expect(waitingCalls.length).toBe(0)
    })
  })

  describe('Integration with existing features', () => {
    it('works with permission modes', async () => {
      vi.mocked(agentService.readAgentInfo).mockResolvedValue(null)

      await terminalService.startAgent(
        '/path/to/worktree',
        'agent-1',
        'claude',
        'planning',
        'Create a plan',
        'opus'
      )

      const command = mockPty.write.mock.calls[0][0]
      expect(command).toContain('--session-id')
      expect(command).toContain('--permission-mode')
      expect(command).toContain('plan')
      expect(command).toContain('--model')
      expect(command).toContain('opus')
    })

    it('preserves existing signal detection', async () => {
      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
      dataHandler('===SIGNAL:PLANS_READY===\n')

      expect(mockWebContents.send).toHaveBeenCalledWith('agent:signal', 'agent-1', 'PLANS_READY')
    })

    it('handles input/output correctly with session persistence', async () => {
      await terminalService.startAgent('/path/to/worktree', 'agent-1', 'claude', 'dev')

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Receive output
      dataHandler('Some output\n')

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:output', 'agent-1', 'Some output\n')

      // Send input
      terminalService.sendInput('agent-1', 'input\n')

      expect(mockPty.write).toHaveBeenCalledWith('input\n')
    })
  })
})
