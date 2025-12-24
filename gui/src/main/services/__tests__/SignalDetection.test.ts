import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn()
}))

// Mock fs and child_process to avoid errors in TerminalService constructor/methods
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}))
vi.mock('child_process', () => ({
  execSync: vi.fn()
}))

describe('TerminalService Signal Detection', () => {
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

  it('detects PLANS_READY signal and emits event', async () => {
    await terminalService.startAgent('path', 'super-agent-1', 'claude', 'planning')
    
    // Get the data handler registered with pty
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    
    // Simulate signal output
    const signalData = 'Some log...\n===SIGNAL:PLANS_READY===\nMore logs...'
    dataHandler(signalData)
    
    // Verify signal event was emitted
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:signal', 'super-agent-1', 'PLANS_READY')
  })

  it('detects DEV_COMPLETED signal', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')
    
    // Get the data handler registered with pty
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('===SIGNAL:DEV_COMPLETED===')
    
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:signal', 'agent-1', 'DEV_COMPLETED')
  })
})

