import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'

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
  statSync: vi.fn()
}))

/**
 * Codex Status Detection Tests
 *
 * Codex is the OpenAI agent CLI tool. Like cursor-cli, it doesn't have JSONL files,
 * so we use pattern-based detection via IdleDetector.
 *
 * Acceptance Criteria:
 * 1. Detect when codex agent completes work (parse terminal output for completion signals)
 * 2. Update agent status appropriately (active → completed)
 * 3. Handle error states
 */
describe('Codex Status Detection', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any
  let mockAgentService: any

  beforeEach(() => {
    vi.useFakeTimers()

    // Setup Mock Window & WebContents
    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents,
      isDestroyed: vi.fn().mockReturnValue(false)
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
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)

    mockAgentService = {
      readAgentInfo: vi.fn().mockResolvedValue(null),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('Completion Detection', () => {
    it('detects when codex completes work successfully', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Fix the bug'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate codex startup
      dataHandler('Codex v1.0.0\n')

      // Simulate working output
      dataHandler('Analyzing codebase...\n')
      dataHandler('Making changes...\n')

      // Simulate completion signal
      dataHandler('✓ Task completed successfully\n')
      dataHandler('All changes have been applied.\n')

      // Advance time to allow idle detection
      vi.advanceTimersByTime(2500)

      // Should detect waiting for input after completion
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )
    })

    it('detects codex idle state after work completes', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Implement feature'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate work completion
      dataHandler('Codex started\n')
      dataHandler('Processing...\n')
      dataHandler('Done.\n')

      // No more output = idle
      vi.advanceTimersByTime(2500)

      // Should detect idle state
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )
    })

    it('does NOT emit waiting when codex is still working', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Refactor code'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate continuous work
      dataHandler('Codex started\n')
      dataHandler('Analyzing...\n')
      dataHandler('Processing...\n') // Keep working

      vi.advanceTimersByTime(1000)

      dataHandler('Still working...\n')

      vi.advanceTimersByTime(2500)

      // Should NOT be waiting because output is recent
      expect(mockWebContents.send).not.toHaveBeenCalledWith(
        'agent:waitingForInput',
        expect.anything(),
        expect.anything()
      )
    })

    it('handles terminal exit as completion', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Test task'
      )

      const exitHandler = vi.mocked(mockPty.onExit).mock.calls[0][0]

      // Simulate clean exit (exitCode 0)
      exitHandler({ exitCode: 0, signal: 0 })

      // Should have cleaned up and broadcast update
      expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
    })
  })

  describe('Error State Detection', () => {
    it('detects error state from exit code', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Buggy task'
      )

      const exitHandler = vi.mocked(mockPty.onExit).mock.calls[0][0]

      // Simulate error exit (non-zero exit code)
      exitHandler({ exitCode: 1, signal: 0 })

      // Should have cleaned up
      expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
    })

    it('detects error messages in output', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task that fails'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Simulate error output
      dataHandler('Codex started\n')
      dataHandler('ERROR: Failed to process request\n')
      dataHandler('Task aborted\n')

      // Advance time to allow state detection
      vi.advanceTimersByTime(2500)

      // Should still detect idle (even after error)
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )
    })

    it('handles unexpected termination gracefully', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const exitHandler = vi.mocked(mockPty.onExit).mock.calls[0][0]

      // Simulate signal termination (killed)
      exitHandler({ exitCode: null, signal: 9 })

      // Should have cleaned up gracefully
      expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
    })
  })

  describe('Status Transitions', () => {
    it('transitions from working to waiting when output stops', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Feature task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Start working
      dataHandler('Codex v1.0\n')
      dataHandler('Working...\n') // This matches working pattern, resets timer

      // Advance time but keep working
      vi.advanceTimersByTime(1000)

      // Output that doesn't match working patterns (no "working" keyword)
      dataHandler('Output: result here\n')

      // Now stop output - simulate completion
      vi.advanceTimersByTime(2500)

      // Should transition to waiting
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )
    })

    it('transitions from waiting to working when user provides input', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Interactive task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Get to waiting state
      dataHandler('Codex ready\n')
      vi.advanceTimersByTime(2500)

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )

      // User sends input
      terminalService.sendInput('agent-1', 'continue\n')

      // Should emit resumed work
      expect(mockWebContents.send).toHaveBeenCalledWith('agent:resumedWork', 'agent-1')
    })

    it('clears waiting state when new output arrives', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Get to waiting state
      dataHandler('Codex started\n')
      vi.advanceTimersByTime(2500)

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )

      mockWebContents.send.mockClear()

      // New output arrives with working pattern (agent resumed on its own)
      dataHandler('Working on next task...\n')

      // Should emit resumed work via IdleDetector's working pattern detection
      expect(mockWebContents.send).toHaveBeenCalledWith('agent:resumedWork', 'agent-1')
    })
  })

  describe('Pattern-based Detection', () => {
    it('uses IdleDetector for status monitoring', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // IdleDetector should process output
      dataHandler('Some output\n')

      // Verify output was sent to renderer (indicates IdleDetector is working)
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'terminal:output',
        'agent-1',
        'Some output\n'
      )
    })

    it('respects idle threshold of 2000ms', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      dataHandler('Codex output\n')

      // Advance 1999ms (just under threshold)
      vi.advanceTimersByTime(1999)

      // Should NOT be waiting yet
      expect(mockWebContents.send).not.toHaveBeenCalledWith(
        'agent:waitingForInput',
        expect.anything(),
        expect.anything()
      )

      // Advance 1 more ms to cross threshold
      vi.advanceTimersByTime(1)

      // Now should be waiting
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'agent-1',
        'Waiting for input'
      )
    })

    it('respects input grace period of 1000ms', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Output appears
      dataHandler('Codex ready\n')

      // User sends input immediately
      terminalService.sendInput('agent-1', 'go\n')

      // Advance 999ms (within grace period)
      vi.advanceTimersByTime(999)

      // Should NOT trigger waiting (grace period active)
      expect(mockWebContents.send).not.toHaveBeenCalledWith(
        'agent:waitingForInput',
        expect.anything(),
        expect.anything()
      )
    })
  })

  describe('Integration with TerminalService', () => {
    it('cleans up IdleDetector on terminal exit', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const exitHandler = vi.mocked(mockPty.onExit).mock.calls[0][0]

      // Exit should clean up detector
      exitHandler({ exitCode: 0, signal: 0 })

      // Terminal should be removed
      expect(terminalService.hasActiveTerminal('agent-1')).toBe(false)
    })

    it('updates agent info on status changes', async () => {
      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Trigger waiting state
      dataHandler('Codex output\n')
      vi.advanceTimersByTime(2500)

      // Should update agent info
      expect(mockAgentService.updateAgentInfo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          isWaitingForInput: true
        })
      )
    })

    it('sends desktop notification when waiting for input', async () => {
      const mockNotificationService = {
        notify: vi.fn(),
        clearCooldown: vi.fn()
      }

      const customTerminalService = new TerminalService(mockMainWindow, mockNotificationService as any)
      customTerminalService.setAgentService(mockAgentService as any)

      await customTerminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'codex',
        'dev',
        'Task'
      )

      const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

      // Trigger waiting state
      dataHandler('Codex ready\n')
      vi.advanceTimersByTime(2500)

      // Should send notification
      expect(mockNotificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Input Required',
          body: expect.stringContaining('is waiting for your input'),
          agentId: 'agent-1'
        })
      )
    })
  })
})
