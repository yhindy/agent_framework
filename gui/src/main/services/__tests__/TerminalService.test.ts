import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'
import * as cp from 'child_process'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() } // Add other used exports if needed
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

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn()
}))

describe('TerminalService Input Detection', () => {
  let terminalService: TerminalService
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

    terminalService = new TerminalService(mockMainWindow)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('starts idle timer when prompt pattern is detected', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    // Simulate prompt output
    const promptData = 'Do you want to proceed? [y/N]'
    
    // Get the data handler registered with pty
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler(promptData)
    
    // Verify output was sent to renderer
    expect(mockWebContents.send).toHaveBeenCalledWith('terminal:output', 'agent-1', promptData)
    
    // Verify timer is set (we can't easily check private property, but we can advance time and check effect)
    // We expect NO waiting event yet
    expect(mockWebContents.send).not.toHaveBeenCalledWith('agent:waitingForInput', expect.anything(), expect.anything())
  })

  it('emits waitingForInput event after timer expires and process is sleeping', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    // Mock process state to be sleeping (Linux style)
    Object.defineProperty(process, 'platform', { value: 'linux' })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('12345 (python) S ...') // 'S' state
    
    // Simulate prompt
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('Continue? [y/n]')
    
    // Advance time by 1s
    vi.advanceTimersByTime(1000)
    
    // Verify event
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:waitingForInput', 'agent-1', 'Continue? [y/n]')
  })

  it('does NOT emit waitingForInput if process is running', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    // Mock process state to be running (Linux style)
    Object.defineProperty(process, 'platform', { value: 'linux' })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('12345 (python) R ...') // 'R' state
    
    // Simulate prompt
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('Continue? [y/n]')
    
    // Advance time
    vi.advanceTimersByTime(1000)
    
    // Verify NO waiting event
    expect(mockWebContents.send).not.toHaveBeenCalledWith('agent:waitingForInput', expect.anything(), expect.anything())
  })

  it('cancels idle timer if new output arrives', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    
    // Prompt
    dataHandler('Continue? [y/n]')
    
    // Advance 500ms (halfway)
    vi.advanceTimersByTime(500)
    
    // More output
    dataHandler('More data...')
    
    // Advance past original 1s mark
    vi.advanceTimersByTime(600)
    
    // Verify NO waiting event
    expect(mockWebContents.send).not.toHaveBeenCalledWith('agent:waitingForInput', expect.anything(), expect.anything())
  })

  it('respects grace period after user input', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    // User sends input
    terminalService.sendInput('agent-1', 'ls\n')
    
    // Mock process state to be sleeping
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('12345 (python) S ...')
    
    // Prompt immediately after input
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('Confirm? [y/n]')
    
    // Advance 1s
    vi.advanceTimersByTime(1000)
    
    // Should NOT emit because < 5s since input
    expect(mockWebContents.send).not.toHaveBeenCalledWith('agent:waitingForInput', expect.anything(), expect.anything())
    
    // Advance past grace period (4s more)
    vi.advanceTimersByTime(4500)
    
    // Still shouldn't emit because the timer only runs once per prompt detection.
    // The "grace period check" happens inside the timer callback.
    // So the previous prompt was ignored. This is correct behavior.
  })

  it('clears waiting state on new input', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    // Force waiting state (manually trigger logic flow)
    // We'll just assume it's waiting for this test setup if we could, 
    // but better to simulate the flow
    
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('12345 (python) S ...')
    
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('Confirm? [y/n]')
    vi.advanceTimersByTime(1000)
    
    // Should be waiting now
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:waitingForInput', 'agent-1', 'Confirm? [y/n]')
    
    // Send input
    terminalService.sendInput('agent-1', 'y\n')
    
    // Should emit resumedWork
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:resumedWork', 'agent-1')
  })
})

