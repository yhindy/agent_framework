import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as path from 'path'

// Mock Electron only
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: () => '/tmp' }
}))

// We use REAL node-pty, fs, child_process for integration test
// But we need to make sure TerminalService imports them correctly. 
// Since we are not mocking them, they should work.

describe.skip('TerminalService Integration', () => {
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
    // We need to override the method that determines the command arguments
    // because we want to run our python script, not claude/cursor.
    // We can do this by adding a "test" tool to TerminalService or just hacking it for the test.
    // Or simpler: We subclass TerminalService for testing to override startAgent to run python.
    
    class TestTerminalService extends TerminalService {
      async startPythonScript(agentId: string) {
        // Use node-pty directly or expose a way to run arbitrary command
        // But easier to just use the public API if we can "fool" it?
        // No, startAgent is specific to tools.
        
        // Let's implement a 'custom' tool in startAgent? 
        // No, let's just use 'claude' but mock getClaudeArgs?
        // No, the command is hardcoded to 'claude'.
        
        // Okay, we need to modify TerminalService to allow custom commands OR
        // we manually use pty.spawn here, effectively duplicating startAgent logic 
        // but using the private methods of TerminalService (if we cast to any).
        
        // Let's assume we can modify TerminalService to support a 'shell' tool or similar?
        // Or we just add a method for testing?
        
        // Better: We copy the startAgent logic here but run python.
        // Actually, we can just use the real startAgent if we make a wrapper script named 'claude' 
        // that calls python? Too complex.
        
        // I'll extend TerminalService in the test to add a method.
      }
    }
    
    // Actually, I can just use 'any' casting to access private 'terminals' map and spawn my own pty
    // and let handleOutput do the work.
    
    const pty = require('node-pty')
    const pythonScript = path.resolve(__dirname, '../../../../scripts/dummy-prompt.py')
    
    // Spawn python process
    const shell = process.platform === 'win32' ? 'python' : 'python3'
    const terminal = pty.spawn(shell, [pythonScript], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    })
    
    // Manually register it in the service
    const serviceAny = terminalService as any
    serviceAny.terminals.set('integration-agent', {
      pty: terminal,
      agentId: 'integration-agent',
      tool: 'test',
      mode: 'test',
      lastInputTime: 0
    })
    
    // Wire up listeners exactly like startAgent does
    terminal.onData((data: string) => {
       serviceAny.handleOutput('integration-agent', data)
    })
    
    // Now wait for the script to print prompt and hang
    // The python script sleeps 1s then prompts.
    
    // We need to wait enough time:
    // 1s (python sleep) + 1s (idle timer in service) + buffer
    
    await new Promise(resolve => setTimeout(resolve, 3500))
    
    // Verify waiting event
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:waitingForInput', 'integration-agent', expect.stringContaining('Do you want to proceed?'))
    
    // Clean up
    terminal.kill()
  }, 10000) // Increase timeout
})

