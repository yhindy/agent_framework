import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalService } from '../TerminalService'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'
import { execSync } from 'child_process'

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
  writeFileSync: vi.fn()
}))

vi.mock('child_process', () => ({
  execSync: vi.fn()
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
    mode: 0o755
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
      vi.mocked(execSync).mockReturnValue(Buffer.from(''))

      terminalService.killTmuxSession('agent-123')

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('tmux kill-session'),
        expect.any(Object)
      )
    })

    it('does not throw when session does not exist', () => {
      // Mock kill-session throwing (session doesn't exist)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('session not found')
      })

      // Should not throw - errors are silently ignored
      expect(() => terminalService.killTmuxSession('agent-123')).not.toThrow()
    })

    it('uses sanitized session name', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from(''))

      terminalService.killTmuxSession('agent/with:special.chars')

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('minion-agent_with_special_chars'),
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
      // tmux is available
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

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

    it('writes command to temp script file for tmux mode', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Prompt contains single quotes (common in super minion prompts like "Claude Code's Task tool")
      const promptWithQuotes = "Use Claude Code's Task tool"

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        promptWithQuotes
      )

      // Verify script file was written to temp directory with agent ID suffix
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.minion-cmd-agent-1\.sh$/),
        expect.stringContaining('#!/bin/bash'),
        expect.any(Object)
      )

      // Verify terminal command runs the script from temp directory
      const writeCalls = mockPty.write.mock.calls
      const firstWrite = writeCalls[0][0]
      expect(firstWrite).toContain('.minion-cmd-agent-1.sh')
    })

    it('script file contains the full command with special characters', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

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

      // Get the content written to the script file (now in temp dir with agent ID suffix)
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        call => String(call[0]).includes('.minion-cmd-')
      )
      expect(writeCall).toBeDefined()
      const scriptContent = writeCall![1] as string

      // Script should contain the raw prompt with quotes and newlines preserved
      expect(scriptContent).toContain("Claude Code's Task tool")
      expect(scriptContent).toContain('## Mission')
    })

    it('properly escapes backticks in prompts to prevent command substitution', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Prompt with backticks (was causing "command not found" errors)
      const promptWithBackticks = 'Fix the bug in `content_handlers.py` and update `config.json`'

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        promptWithBackticks
      )

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        call => String(call[0]).includes('.minion-cmd-')
      )
      expect(writeCall).toBeDefined()
      const scriptContent = writeCall![1] as string

      // Backticks should be escaped to prevent bash command substitution
      expect(scriptContent).toContain('\\`content_handlers.py\\`')
      expect(scriptContent).toContain('\\`config.json\\`')
      // Should NOT contain unescaped backticks inside the quoted string
      expect(scriptContent).not.toMatch(/"`[^\\]/)
    })

    it('properly escapes dollar signs in prompts to prevent variable expansion', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Prompt with dollar signs
      const promptWithDollars = 'Check the $HOME directory and set $MY_VAR=value'

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        promptWithDollars
      )

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        call => String(call[0]).includes('.minion-cmd-')
      )
      expect(writeCall).toBeDefined()
      const scriptContent = writeCall![1] as string

      // Dollar signs should be escaped to prevent bash variable expansion
      expect(scriptContent).toContain('\\$HOME')
      expect(scriptContent).toContain('\\$MY_VAR')
    })

    it('properly escapes backslashes in prompts', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Prompt with backslashes (common in regex or Windows paths)
      const promptWithBackslashes = 'Use regex \\d+ to match numbers and path C:\\Users\\test'

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        promptWithBackslashes
      )

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        call => String(call[0]).includes('.minion-cmd-')
      )
      expect(writeCall).toBeDefined()
      const scriptContent = writeCall![1] as string

      // Backslashes should be escaped (doubled)
      expect(scriptContent).toContain('\\\\d+')
      expect(scriptContent).toContain('C:\\\\Users\\\\test')
    })

    it('properly escapes all shell metacharacters together', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Complex prompt with multiple metacharacters
      const complexPrompt = 'Run `echo $HOME` and check if "$PATH" contains \\bin'

      await terminalService.startAgent(
        '/path/to/project',
        'agent-1',
        'claude',
        'dev',
        complexPrompt
      )

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        call => String(call[0]).includes('.minion-cmd-')
      )
      expect(writeCall).toBeDefined()
      const scriptContent = writeCall![1] as string

      // All metacharacters should be properly escaped
      expect(scriptContent).toContain('\\`echo')
      expect(scriptContent).toContain('\\$HOME\\`')
      expect(scriptContent).toContain('\\"\\$PATH\\"')
      expect(scriptContent).toContain('\\\\bin')
    })

    it('handles complex super minion prompts via script file', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

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

      // Should reference the script file, not inline command (now with agent ID suffix)
      expect(firstWrite).toContain('.minion-cmd-agent-1.sh')

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
      vi.mocked(execSync).mockReturnValue(Buffer.from(''))

      // Stop the agent
      terminalService.stopAgent('agent-1')

      // Should have called kill-session
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('tmux kill-session -t minion-agent-1'),
        expect.any(Object)
      )
    })
  })

  describe('cleanup on app exit', () => {
    beforeEach(() => {
      terminalService.setAgentService(createMockAgentService())
      terminalService.setSettingsService(mockSettingsService)
    })

    it('kills all tmux sessions on cleanup', async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

      // Start multiple agents
      await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')
      await terminalService.startAgent('/path/to/project', 'agent-2', 'claude', 'dev')

      // Clear previous calls
      vi.mocked(execSync).mockClear()
      vi.mocked(execSync).mockReturnValue(Buffer.from(''))

      // Cleanup all
      terminalService.cleanup()

      // Should have killed both tmux sessions
      const killCalls = vi.mocked(execSync).mock.calls.filter(
        call => call[0].includes('kill-session')
      )
      expect(killCalls.length).toBe(2)
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
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))
    terminalService.setAgentService(createMockAgentService())
    terminalService.setSettingsService(createMockSettingsService('tmux'))

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Should use tmux
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
    vi.mocked(execSync).mockReturnValue(Buffer.from(''))

    // Resize the terminal
    terminalService.resize('agent-1', 120, 40)

    // Should have called pty.resize
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)

    // Should have called tmux resize-window for both windows (rows - 1 for status bar)
    expect(execSync).toHaveBeenCalledWith(
      'tmux resize-window -t minion-agent-1:0 -x 120 -y 39 2>/dev/null || true',
      { encoding: 'utf8' }
    )
    expect(execSync).toHaveBeenCalledWith(
      'tmux resize-window -t minion-agent-1:1 -x 120 -y 39 2>/dev/null || true',
      { encoding: 'utf8' }
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

    // Resize the terminal
    terminalService.resize('agent-1', 120, 40)

    // Should have called pty.resize
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)

    // Should NOT have called tmux resize-window (no tmux session)
    expect(execSync).not.toHaveBeenCalled()
  })

  it('silently handles tmux resize-window failure', async () => {
    // tmux is available
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

    // Start agent in tmux mode
    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    // Make resize-window fail (e.g., session doesn't exist yet)
    vi.mocked(execSync).mockClear()
    vi.mocked(execSync).mockImplementation(() => {
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
    // tmux is available
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

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
    // tmux is available
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/tmux'))

    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')

    const tmuxCommand = mockPty.write.mock.calls[0][0]

    // The order should be: new-session -> send-keys (agent command) -> new-window -d
    const newSessionIndex = tmuxCommand.indexOf('new-session')
    const sendKeysIndex = tmuxCommand.indexOf('send-keys')
    const newWindowIndex = tmuxCommand.indexOf('new-window -d -n shell')

    expect(newSessionIndex).toBeLessThan(sendKeysIndex)
    expect(sendKeysIndex).toBeLessThan(newWindowIndex)
  })
})
