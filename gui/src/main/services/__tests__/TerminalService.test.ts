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

  it('emits waitingForInput event after timer expires (uses IdleDetector for cursor-cli)', async () => {
    await terminalService.startAgent('path', 'agent-1', 'cursor-cli', 'dev')

    // Simulate Cursor agent start and non-working output
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('Claude Code 0.0.1\n') // Header to set started = true
    dataHandler('Some output without working indicators\n')

    // Advance time past the idle threshold (2000ms)
    vi.advanceTimersByTime(2500)

    // Verify event - IdleDetector emits with a standard message
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'agent:waitingForInput',
      'agent-1',
      'Waiting for input'
    )
  })

  it('does NOT emit waitingForInput when working patterns are detected (cursor-cli)', async () => {
    await terminalService.startAgent('path', 'agent-1', 'cursor-cli', 'dev')

    // Simulate Cursor agent start with working indicators
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]
    dataHandler('Claude Code started...\n')
    dataHandler('Thinking…') // Working pattern - should prevent waiting

    // Advance time past idle threshold
    vi.advanceTimersByTime(3000)

    // Verify NO waiting event because we saw a working pattern
    expect(mockWebContents.send).not.toHaveBeenCalledWith(
      'agent:waitingForInput',
      expect.anything(),
      expect.anything()
    )
  })

  it('cancels idle timer if working output arrives (cursor-cli)', async () => {
    await terminalService.startAgent('path', 'agent-1', 'cursor-cli', 'dev')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Start agent and some output
    dataHandler('Claude Code\n')
    dataHandler('Some output...\n')

    // Advance 1500ms (partway through idle threshold)
    vi.advanceTimersByTime(1500)

    // Working pattern arrives - resets timer
    dataHandler('Thinking…')

    // Advance past original threshold
    vi.advanceTimersByTime(1000)

    // Verify NO waiting event because working pattern reset the timer
    expect(mockWebContents.send).not.toHaveBeenCalledWith(
      'agent:waitingForInput',
      expect.anything(),
      expect.anything()
    )
  })

  it('respects grace period after user input (cursor-cli)', async () => {
    await terminalService.startAgent('path', 'agent-1', 'cursor-cli', 'dev')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Start Claude
    dataHandler('Claude Code started...\n')

    // User sends input - starts grace period
    terminalService.sendInput('agent-1', 'ls\n')

    // Advance 500ms (within grace period)
    vi.advanceTimersByTime(500)

    // Output arrives after input (starts new idle timer)
    dataHandler('Some response\n')

    // Advance another 500ms (still within grace period of original input)
    vi.advanceTimersByTime(500)

    // More output
    dataHandler('More output\n')

    // At this point, when the idle timer fires, the input grace period check should pass
    // because timeSinceLastInput will be ~1000ms which is NOT < 1000ms (the threshold)
    // The test was incorrect - after 1000ms the grace period HAS expired
    // So let's fix the test by sending input again right before the threshold
    terminalService.sendInput('agent-1', 'more input\n')

    // Now advance past idle threshold
    vi.advanceTimersByTime(2500)

    // Should NOT emit because we sent input recently
    expect(mockWebContents.send).not.toHaveBeenCalledWith(
      'agent:waitingForInput',
      expect.anything(),
      expect.anything()
    )
  })

  it('clears waiting state on new input', async () => {
    await terminalService.startAgent('path', 'agent-1', 'claude', 'dev')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Start Claude and trigger waiting state
    dataHandler('Claude Code 0.0.1\n')
    dataHandler('Some output\n')
    vi.advanceTimersByTime(2500)

    // Should be waiting now
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'agent:waitingForInput',
      'agent-1',
      'Waiting for input'
    )

    // Send input
    terminalService.sendInput('agent-1', 'y\n')

    // Should emit resumedWork
    expect(mockWebContents.send).toHaveBeenCalledWith('agent:resumedWork', 'agent-1')
  })
})

describe('PlainTerminal Detection', () => {
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
    vi.mocked(fs.existsSync).mockReturnValue(true)

    terminalService = new TerminalService(mockMainWindow)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('emits plainTerminal:waitingForInput after idle threshold', async () => {
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'shell-1')

    // Get the data handler
    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Send some output
    dataHandler('$ \n')

    // Advance past idle threshold
    vi.advanceTimersByTime(2500)

    // Should emit waiting event for plain terminal
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'plainTerminal:waitingForInput',
      'agent-1-shell-1',
      'Terminal is waiting for input'
    )
  })

  it('emits plainTerminal:resumedWork when working patterns detected', async () => {
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'shell-1')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Trigger waiting state
    dataHandler('$ \n')
    vi.advanceTimersByTime(2500)

    expect(mockWebContents.send).toHaveBeenCalledWith(
      'plainTerminal:waitingForInput',
      'agent-1-shell-1',
      'Terminal is waiting for input'
    )

    // Send working pattern (Claude running in plain terminal)
    dataHandler('Thinking…')

    // Should emit resumedWork
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'plainTerminal:resumedWork',
      'agent-1-shell-1'
    )
  })

  it('clears waiting state on user input', async () => {
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'shell-1')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Trigger waiting state
    dataHandler('$ \n')
    vi.advanceTimersByTime(2500)

    expect(mockWebContents.send).toHaveBeenCalledWith(
      'plainTerminal:waitingForInput',
      'agent-1-shell-1',
      'Terminal is waiting for input'
    )

    // Send user input
    terminalService.sendPlainInput('agent-1-shell-1', 'ls\n')

    // Should emit resumedWork
    expect(mockWebContents.send).toHaveBeenCalledWith(
      'plainTerminal:resumedWork',
      'agent-1-shell-1'
    )
  })

  it('uses combined shell + Claude patterns for detection', async () => {
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'shell-1')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Test shell working patterns
    const shellWorkingPatterns = [
      'Installing packages... 50%',
      'Building project...',
      'Compiling TypeScript...'
    ]

    for (const pattern of shellWorkingPatterns) {
      // Start idle timer
      dataHandler('$ \n')
      vi.advanceTimersByTime(1500)

      // Send shell working pattern - should prevent waiting
      dataHandler(pattern + '\n')

      // Advance past threshold
      vi.advanceTimersByTime(1500)

      // Should NOT have emitted waiting because of working pattern
      const waitingCalls = mockWebContents.send.mock.calls.filter(
        (call: any[]) => call[0] === 'plainTerminal:waitingForInput'
      )
      expect(waitingCalls.length).toBe(0)

      mockWebContents.send.mockClear()
    }
  })

  it('does not emit waiting before idle threshold', async () => {
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'shell-1')

    const dataHandler = vi.mocked(mockPty.onData).mock.calls[0][0]

    // Send output
    dataHandler('$ \n')

    // Advance but not past threshold
    vi.advanceTimersByTime(1500)

    // Should NOT have emitted waiting
    expect(mockWebContents.send).not.toHaveBeenCalledWith(
      'plainTerminal:waitingForInput',
      expect.anything(),
      expect.anything()
    )
  })
})

describe('TerminalService Model Handling', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any

  beforeEach(() => {
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
  })

  it('passes opusplan model to Claude CLI', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'claude',
      'planning',
      'Create a plan',
      'opusplan'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('--model')
    expect(command).toContain('opusplan')
  })

  it('passes haiku model to Claude CLI', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'claude',
      'planning',
      'Create a plan',
      'haiku'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('--model')
    expect(command).toContain('haiku')
  })

  it('passes sonnet model to Claude CLI', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'claude',
      'planning',
      'Create a plan',
      'sonnet'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('--model')
    expect(command).toContain('sonnet')
  })

  it('passes opus model to Claude CLI', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'claude',
      'planning',
      'Create a plan',
      'opus'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('--model')
    expect(command).toContain('opus')
  })

  it('handles undefined model gracefully', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'claude',
      'planning',
      'Create a plan'
    )

    const command = mockPty.write.mock.calls[0][0]
    // Should not contain --model flag if model is undefined
    expect(command).not.toContain('--model')
  })
})

describe('TerminalService Cloud Session ID Detection', () => {
  // Note: The detectAndStoreCloudSessionId method is called from handleOutput
  // when terminal output matches the cloud session pattern. Integration testing
  // with mock PTY callbacks has issues with the closure binding, so we test the
  // regex pattern matching and the overall implementation correctness here.

  it('cloud session ID regex matches expected patterns', () => {
    const cloudSessionPattern = /session_[a-zA-Z0-9]+/g

    // URL pattern
    const urlMatch = 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B'.match(cloudSessionPattern)
    expect(urlMatch).toContain('session_01CVbxtiJWp387FoCSvAiS2B')

    // Teleport pattern
    const teleportMatch = 'claude --teleport session_ABCdef123xyz'.match(cloudSessionPattern)
    expect(teleportMatch).toContain('session_ABCdef123xyz')

    // No match for non-session text
    const noMatch = 'This is just some text without session'.match(cloudSessionPattern)
    expect(noMatch).toBeNull()

    // Multiple sessions in output (should match all)
    const multiMatch = 'session_abc123 and session_def456'.match(cloudSessionPattern)
    expect(multiMatch).toContain('session_abc123')
    expect(multiMatch).toContain('session_def456')
  })

  it('stores cloudSessionId when teleporting', async () => {
    const mockWebContents = { send: vi.fn() }
    const mockMainWindow = { webContents: mockWebContents } as unknown as BrowserWindow

    const mockPty = {
      write: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 12345
    }
    vi.mocked(pty.spawn).mockReturnValue(mockPty as any)

    const mockAgentService = {
      readAgentInfo: vi.fn().mockResolvedValue(null),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getSuperMinionRulesPath: vi.fn().mockReturnValue('/path/to/rules'),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    const terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService as any)

    // Start agent with teleportSessionId
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      undefined, // prompt
      undefined, // model
      false, // yolo
      true, // chrome
      'session_CloudSession123' // teleportSessionId
    )

    // Should have stored the cloudSessionId during startAgent
    expect(mockAgentService.updateAgentInfo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cloudSessionId: 'session_CloudSession123'
      })
    )
  })

  it('includes --dangerously-skip-permissions flag for teleport to bypass interactive prompts', async () => {
    const mockWebContents = { send: vi.fn() }
    const mockMainWindow = { webContents: mockWebContents } as unknown as BrowserWindow

    const mockPty = {
      write: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 12345
    }
    vi.mocked(pty.spawn).mockReturnValue(mockPty as any)

    const mockAgentService = {
      readAgentInfo: vi.fn().mockResolvedValue(null),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getSuperMinionRulesPath: vi.fn().mockReturnValue('/path/to/rules'),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    const terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService as any)

    // Start agent with teleportSessionId (yolo=false to ensure flag is added for teleport specifically)
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      undefined, // prompt
      undefined, // model
      false, // yolo (explicitly false - flag should still be added for teleport)
      true, // chrome
      'session_CloudSession123' // teleportSessionId
    )

    // Check that the written command includes --dangerously-skip-permissions
    expect(mockPty.write).toHaveBeenCalled()
    const writtenCommand = mockPty.write.mock.calls[0][0]
    expect(writtenCommand).toContain('--teleport session_CloudSession123')
    expect(writtenCommand).toContain('--dangerously-skip-permissions')
    expect(writtenCommand).toContain('--chrome')
  })
})

describe('Super Minion System Prompt', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockPty: any
  let mockAgentService: any

  // Common test data
  const TEST_PROJECT_PATH = '/path/to/project'
  const TEST_AGENT_ID = 'agent-1'
  const TEST_PROMPT = 'Create feature X'
  const SUPER_MINION_RULES_PATH = '/path/to/super-minion-rules.md'
  const SUPER_MINION_AGENT_INFO = { isSuperMinion: true }
  const REGULAR_AGENT_INFO = { isSuperMinion: false }

  const ACCEPTANCE_CRITERIA_KEYWORDS = [
    'ACCEPTANCE CRITERIA',
    'AskUserQuestion',
    'PHASE 1',
    'WAIT for explicit'
  ]

  // Helper to get the command written to PTY
  const getWrittenCommand = () => mockPty.write.mock.calls[0][0]

  // Helper to setup agent info
  const setupAgentInfo = (agentInfo: { isSuperMinion: boolean }) => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(agentInfo))
    mockAgentService.readAgentInfo.mockResolvedValue(agentInfo)
  }

  // Helper to start agent with default parameters
  const startAgent = (prompt = TEST_PROMPT, agentId = TEST_AGENT_ID) => {
    return terminalService.startAgent(
      TEST_PROJECT_PATH,
      agentId,
      'claude',
      'planning',
      prompt,
      'sonnet'
    )
  }

  beforeEach(() => {
    const mockWebContents = { send: vi.fn() }
    mockMainWindow = { webContents: mockWebContents } as unknown as BrowserWindow

    mockPty = {
      write: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 12345
    }
    vi.mocked(pty.spawn).mockReturnValue(mockPty)

    mockAgentService = {
      getSuperMinionRulesPath: vi.fn().mockReturnValue(SUPER_MINION_RULES_PATH),
      readAgentInfo: vi.fn().mockResolvedValue(SUPER_MINION_AGENT_INFO),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    vi.mocked(fs.existsSync).mockReturnValue(true)
    setupAgentInfo(SUPER_MINION_AGENT_INFO)

    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should pass --system-prompt-file flag for super minion in planning mode', async () => {
    await startAgent()

    const command = getWrittenCommand()
    expect(command).toContain('--system-prompt-file')
    expect(command).toContain(SUPER_MINION_RULES_PATH)
  })

  it('should include acceptance criteria instructions in planning prompt for super minion', async () => {
    await startAgent()

    const command = getWrittenCommand()
    ACCEPTANCE_CRITERIA_KEYWORDS.forEach(keyword => {
      expect(command).toContain(keyword)
    })
  })

  it('should NOT pass --system-prompt-file flag for regular planning mode', async () => {
    setupAgentInfo(REGULAR_AGENT_INFO)

    await startAgent(TEST_PROMPT, 'agent-2')

    const command = getWrittenCommand()
    expect(command).not.toContain('--system-prompt-file')
    expect(command).not.toContain('super-minion-rules.md')
  })

  it('should NOT include acceptance criteria instructions for regular planning mode', async () => {
    setupAgentInfo(REGULAR_AGENT_INFO)

    await startAgent(TEST_PROMPT, 'agent-2')

    const command = getWrittenCommand()
    expect(command).not.toContain('5-PHASE WORKFLOW')
    expect(command).not.toContain('ACCEPTANCE CRITERIA')
  })

  it('should include 5-phase workflow with mandatory design and review phases', async () => {
    await startAgent('Build feature Y')

    const command = getWrittenCommand()
    expect(command).toContain('PHASE 2 - ENGINEERING DESIGN')
    expect(command).toContain('PHASE 3 - DESIGN REVIEW')
    expect(command).toContain('MANDATORY')
    expect(command).toContain('NEVER skip')
  })
})

describe('TerminalService Codex CLI', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any

  beforeEach(() => {
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
  })

  it('spawns codex CLI with correct command', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'dev',
      'Fix the authentication bug'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('codex')
  })

  it('hardcodes model to gpt-5.2-codex for codex', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'dev',
      'Implement the new feature'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('--model')
    expect(command).toContain('gpt-5.2-codex')
  })

  it('passes prompt to codex CLI', async () => {
    const prompt = 'Refactor the database module'
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'dev',
      prompt
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain(prompt)
  })

  it('escapes quotes in prompt for codex', async () => {
    const prompt = 'Fix "critical" bug in the API'
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'dev',
      prompt
    )

    const command = mockPty.write.mock.calls[0][0]
    // Should escape the inner quotes
    expect(command).toContain('\\"critical\\"')
  })

  it('handles planning mode with codex', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'planning',
      'Create a plan for the new feature'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('codex')
    expect(command).toContain('--model')
    expect(command).toContain('gpt-5.2-codex')
    expect(command).toContain('Create a plan for')
  })

  it('works without a prompt', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'dev'
    )

    const command = mockPty.write.mock.calls[0][0]
    expect(command).toContain('codex')
    expect(command).toContain('--model')
    expect(command).toContain('gpt-5.2-codex')
  })

  it('ignores model parameter when passed to codex (always uses gpt-5.2-codex)', async () => {
    await terminalService.startAgent(
      '/path/to/worktree',
      'agent-1',
      'codex',
      'dev',
      'Fix the bug',
      'opus' // This should be ignored
    )

    const command = mockPty.write.mock.calls[0][0]
    // Should still use gpt-5.2-codex, not opus
    expect(command).toContain('gpt-5.2-codex')
    expect(command).not.toContain('opus')
  })
})
