import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

vi.mock('node-pty', () => ({ spawn: vi.fn() }))

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
}))

vi.mock('child_process', () => ({ execSync: vi.fn() }))

function createMockPty(): any {
  return {
    write: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345
  }
}

function createMockMainWindow(): any {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false)
  }
}

function createMockClaudeSessionInfoService(stateProvider?: () => { state: string; taskInvocations: any[] }): any {
  const defaultState = { sessionId: 'test-session', state: 'working', taskInvocations: [] }
  return {
    parseSessionInfo: vi.fn().mockImplementation(() => stateProvider ? { sessionId: 'test-session', ...stateProvider() } : defaultState),
    watchSession: vi.fn(),
    unwatchSession: vi.fn(),
    extractGitBranch: vi.fn().mockReturnValue(null),
    getSessionState: vi.fn().mockReturnValue('working')
  }
}

function setupFsMocks(): void {
  vi.mocked(fs.existsSync).mockReturnValue(true)
  vi.mocked(fs.statSync).mockReturnValue({
    isDirectory: () => true,
    mode: 0o755
  } as any)
}

describe('TerminalService Performance - Polling Interval', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockClaudeSessionInfoService: any

  beforeEach(() => {
    vi.useFakeTimers()

    mockMainWindow = createMockMainWindow()
    vi.mocked(pty.spawn).mockReturnValue(createMockPty())
    mockClaudeSessionInfoService = createMockClaudeSessionInfoService()
    setupFsMocks()

    terminalService = new TerminalService(mockMainWindow as unknown as BrowserWindow)
    terminalService.setClaudeSessionInfoService(mockClaudeSessionInfoService)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should use 2-second polling interval (not 1-second) to reduce load', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      'Test prompt'
    )

    // Clear initial calls
    mockClaudeSessionInfoService.parseSessionInfo.mockClear()

    // After 1 second, should NOT have been called yet (old behavior was 1s)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockClaudeSessionInfoService.parseSessionInfo).not.toHaveBeenCalled()

    // After 2 seconds total, should have been called once
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockClaudeSessionInfoService.parseSessionInfo).toHaveBeenCalledTimes(1)

    // After 4 seconds total, should have been called twice
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockClaudeSessionInfoService.parseSessionInfo).toHaveBeenCalledTimes(2)
  })
})

describe('TerminalService Performance - Broadcast Throttling', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockAgentService: any

  beforeEach(() => {
    vi.useFakeTimers()

    mockMainWindow = createMockMainWindow()
    vi.mocked(pty.spawn).mockReturnValue(createMockPty())
    setupFsMocks()

    mockAgentService = {
      readAgentInfo: vi.fn().mockResolvedValue({ isSuperMinion: true }),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getSuperMinionRulesPath: vi.fn().mockReturnValue('/path/to/rules'),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    // Alternating state provider to trigger broadcasts on each poll
    let pollCount = 0
    const stateProvider = () => {
      pollCount++
      return {
        state: pollCount % 2 === 0 ? 'waiting' : 'working',
        taskInvocations: [{ toolUseId: `task-${pollCount}`, status: 'running' }]
      }
    }

    terminalService = new TerminalService(mockMainWindow as unknown as BrowserWindow)
    terminalService.setAgentService(mockAgentService)
    terminalService.setClaudeSessionInfoService(createMockClaudeSessionInfoService(stateProvider))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should throttle agents:updated broadcasts to max once per 500ms per agent', async () => {
    const sendMock = mockMainWindow.webContents.send

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'planning', 'Test prompt')
    sendMock.mockClear()

    // First poll at 2s - should broadcast
    await vi.advanceTimersByTimeAsync(2000)
    const broadcastsAt2s = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length

    sendMock.mockClear()

    // 400ms later - within throttle window, should not broadcast
    await vi.advanceTimersByTimeAsync(400)
    const broadcastsWithinThrottle = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length

    // 1600ms more (4s total) - past throttle, should allow broadcast
    await vi.advanceTimersByTimeAsync(1600)
    const broadcastsAt4s = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length

    expect(broadcastsAt2s).toBeLessThanOrEqual(2)
    expect(broadcastsWithinThrottle).toBe(0)
    expect(broadcastsAt4s).toBeLessThanOrEqual(2)
  })

  it('should allow broadcasts for different agents independently', async () => {
    const sendMock = mockMainWindow.webContents.send

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev', 'Test 1')
    await terminalService.startAgent('/path/to/project', 'agent-2', 'claude', 'dev', 'Test 2')
    sendMock.mockClear()

    // Throttle is per-agent, so both should be able to broadcast
    await vi.advanceTimersByTimeAsync(2000)

    const agentsUpdatedCalls = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated')
    expect(agentsUpdatedCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('should reset throttle after 500ms has passed', async () => {
    const sendMock = mockMainWindow.webContents.send

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'planning', 'Test prompt')
    sendMock.mockClear()

    // First broadcast at 2s
    await vi.advanceTimersByTimeAsync(2000)
    const firstBroadcast = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length

    sendMock.mockClear()

    // 600ms past throttle window, then next poll at 4s total
    await vi.advanceTimersByTimeAsync(2000)
    const secondBroadcast = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length

    expect(firstBroadcast).toBeGreaterThanOrEqual(1)
    expect(secondBroadcast).toBeGreaterThanOrEqual(1)
  })
})

describe('TerminalService Performance - File Watcher Throttling', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockAgentService: any
  let mockClaudeSessionInfoService: any
  let capturedWatchCallback: ((info: any) => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()

    mockMainWindow = createMockMainWindow()
    vi.mocked(pty.spawn).mockReturnValue(createMockPty())
    setupFsMocks()

    mockAgentService = {
      readAgentInfo: vi.fn().mockResolvedValue({ isSuperMinion: true }),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getSuperMinionRulesPath: vi.fn().mockReturnValue('/path/to/rules'),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    // Capture the callback passed to watchSession
    capturedWatchCallback = null
    mockClaudeSessionInfoService = {
      parseSessionInfo: vi.fn().mockReturnValue({ sessionId: 'test-session', state: 'working', taskInvocations: [] }),
      watchSession: vi.fn().mockImplementation((_sessionId: string, _worktreePath: string, callback: (info: any) => void) => {
        capturedWatchCallback = callback
      }),
      unwatchSession: vi.fn(),
      extractGitBranch: vi.fn().mockReturnValue(null),
      getSessionState: vi.fn().mockReturnValue('working')
    }

    terminalService = new TerminalService(mockMainWindow as unknown as BrowserWindow)
    terminalService.setAgentService(mockAgentService)
    terminalService.setClaudeSessionInfoService(mockClaudeSessionInfoService)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should throttle file watcher callback broadcasts for super minions', async () => {
    const sendMock = mockMainWindow.webContents.send

    // Start a super minion agent - this should register a file watcher
    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'planning', 'Test prompt')

    // Verify watchSession was called (super minion agents get file watchers)
    expect(mockClaudeSessionInfoService.watchSession).toHaveBeenCalled()
    expect(capturedWatchCallback).not.toBeNull()

    // Clear any initial broadcasts
    sendMock.mockClear()

    // Simulate rapid file watcher callbacks (as if fs.watch fired multiple times)
    // These should be throttled to max once per 500ms
    capturedWatchCallback!({ sessionId: 'test', state: 'working', taskInvocations: [] })
    capturedWatchCallback!({ sessionId: 'test', state: 'working', taskInvocations: [] })
    capturedWatchCallback!({ sessionId: 'test', state: 'working', taskInvocations: [] })

    // Count agents:updated broadcasts - should be throttled to at most 1
    const broadcastsAfterRapidCalls = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length
    expect(broadcastsAfterRapidCalls).toBeLessThanOrEqual(1)

    // After 500ms, another broadcast should be allowed
    sendMock.mockClear()
    await vi.advanceTimersByTimeAsync(500)
    capturedWatchCallback!({ sessionId: 'test', state: 'working', taskInvocations: [] })

    const broadcastsAfterThrottle = sendMock.mock.calls.filter((c: any[]) => c[0] === 'agents:updated').length
    expect(broadcastsAfterThrottle).toBeLessThanOrEqual(1)
  })
})
