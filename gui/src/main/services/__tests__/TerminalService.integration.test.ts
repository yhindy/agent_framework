import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import { IdleDetector, SHELL_WORKING_PATTERNS, SHELL_IDLE_INDICATORS } from '../IdleDetector'

// Mock Electron only
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: () => '/tmp' }
}))

/**
 * Helper to spawn a PTY process, returns null if PTY spawning is not available
 * (e.g., in CI environments without proper terminal support)
 */
function trySpawnPty(command: string, args: string[], options: any): any | null {
  try {
    const pty = require('node-pty')
    return pty.spawn(command, args, options)
  } catch (error: any) {
    if (error.message?.includes('posix_spawnp failed')) {
      console.log('PTY spawning not available in this environment, skipping test')
      return null
    }
    throw error
  }
}

/**
 * Find Python executable path
 */
function findPython(): string | null {
  try {
    const { execSync } = require('child_process')
    return execSync('which python3 || which python', { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// Integration tests using real node-pty - may not work in all environments
describe('TerminalService Integration', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any

  beforeEach(() => {
    // Setup Mock Window & WebContents
    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents
    } as unknown as BrowserWindow

    terminalService = new TerminalService(mockMainWindow)
  })

  afterEach(() => {
    terminalService.cleanup()
    vi.clearAllMocks()
  })

  it('detects waiting state from a real python process', async () => {
    const pythonPath = findPython()
    if (!pythonPath) {
      console.log('Python not found, skipping integration test')
      return
    }

    const pythonScript = path.resolve(__dirname, '../../../../scripts/dummy-prompt.py')
    const fs = require('fs')
    if (!fs.existsSync(pythonScript)) {
      console.log('Python script not found, skipping integration test')
      return
    }

    const terminal = trySpawnPty(pythonPath, [pythonScript], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    })

    if (!terminal) {
      // PTY not available, skip test gracefully
      return
    }

    try {
      // Create IdleDetector with shell patterns (non-Claude tool)
      const idleDetector = new IdleDetector(
        {
          workingPatterns: SHELL_WORKING_PATTERNS,
          idleIndicators: SHELL_IDLE_INDICATORS,
          idleThreshold: 500, // Lower threshold for faster test
          inputGracePeriod: 200,
          requireStartSignal: false // No start signal needed for shell
        },
        {
          onWaitingForInput: (context: string) => {
            mockWebContents.send('agent:waitingForInput', 'integration-agent', context)
          },
          onResumedWork: () => {
            mockWebContents.send('agent:resumedWork', 'integration-agent')
          }
        }
      )

      // Manually register terminal session in the service
      const serviceAny = terminalService as any
      serviceAny.terminals.set('integration-agent', {
        pty: terminal,
        agentId: 'integration-agent',
        tool: 'test',
        mode: 'test',
        worktreePath: '/tmp/test',
        idleDetector
      })

      // Wire up output handler to feed IdleDetector
      terminal.onData((data: string) => {
        // Send to renderer (like real handleOutput does)
        mockWebContents.send('terminal:output', 'integration-agent', data)
        // Feed IdleDetector
        idleDetector.processOutput(data)
      })

      // Wait for:
      // - Python script to start and print "Working..." (matches working pattern)
      // - Python script to sleep 0.5s and print "> " prompt
      // - IdleDetector threshold (0.5s) to trigger waiting state
      // Total: ~1.5s with buffer
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify waiting event was emitted
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'integration-agent',
        expect.any(String)
      )

      // Clean up
      idleDetector.dispose()
    } finally {
      terminal.kill()
    }
  }, 10000) // 10s timeout for safety

  it('detects resumed work after receiving input', async () => {
    const pythonPath = findPython()
    if (!pythonPath) {
      console.log('Python not found, skipping integration test')
      return
    }

    const pythonScript = path.resolve(__dirname, '../../../../scripts/dummy-prompt.py')
    const fs = require('fs')
    if (!fs.existsSync(pythonScript)) {
      console.log('Python script not found, skipping integration test')
      return
    }

    const terminal = trySpawnPty(pythonPath, [pythonScript], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    })

    if (!terminal) {
      return
    }

    try {
      const idleDetector = new IdleDetector(
        {
          workingPatterns: SHELL_WORKING_PATTERNS,
          idleIndicators: SHELL_IDLE_INDICATORS,
          idleThreshold: 500,
          inputGracePeriod: 200,
          requireStartSignal: false
        },
        {
          onWaitingForInput: (_context: string) => {
            mockWebContents.send('agent:waitingForInput', 'integration-agent', _context)
          },
          onResumedWork: () => {
            mockWebContents.send('agent:resumedWork', 'integration-agent')
          }
        }
      )

      const serviceAny = terminalService as any
      serviceAny.terminals.set('integration-agent', {
        pty: terminal,
        agentId: 'integration-agent',
        tool: 'test',
        mode: 'test',
        worktreePath: '/tmp/test',
        idleDetector
      })

      terminal.onData((data: string) => {
        mockWebContents.send('terminal:output', 'integration-agent', data)
        idleDetector.processOutput(data)
      })

      // Wait for waiting state
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify we're in waiting state
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:waitingForInput',
        'integration-agent',
        expect.any(String)
      )

      // Clear mock to track new calls
      mockWebContents.send.mockClear()

      // Send input to resume work
      idleDetector.notifyInput()
      terminal.write('yes\n')

      // Wait for the script to process input and print response
      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify resumed work event was emitted
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'agent:resumedWork',
        'integration-agent'
      )

      // Clean up
      idleDetector.dispose()
    } finally {
      terminal.kill()
    }
  }, 10000)
})
