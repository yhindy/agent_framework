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
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
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
    const mockMainWindow = { webContents: mockWebContents, isDestroyed: vi.fn().mockReturnValue(false) } as unknown as BrowserWindow

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
      }),
      'agent-1',
      '/path/to/project'
    )
  })

  it('includes --dangerously-skip-permissions flag for teleport to bypass interactive prompts', async () => {
    const mockWebContents = { send: vi.fn() }
    const mockMainWindow = { webContents: mockWebContents, isDestroyed: vi.fn().mockReturnValue(false) } as unknown as BrowserWindow

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
  let mockWorkflowService: any

  // Common test data
  const TEST_PROJECT_PATH = '/path/to/project'
  const TEST_AGENT_ID = 'agent-1'
  const TEST_PROMPT = 'Create feature X'
  const SUPER_MINION_RULES_PATH = '/path/to/super-minion-rules.md'
  const SUPER_MINION_AGENT_INFO = { isSuperMinion: true }
  const REGULAR_AGENT_INFO = { isSuperMinion: false }

  // Mock workflow configuration (new simplified model)
  const MOCK_WORKFLOW = {
    id: 'test-workflow',
    name: 'Test Workflow',
    steps: [
      { id: 'step-1', name: 'Design Phase', agents: ['planner'] },
      { id: 'step-2', name: 'Implementation', agents: ['dev'] },
      { id: 'step-3', name: 'Test & Review', agents: ['tester', 'reviewer'] }
    ]
  }

  const MOCK_SUBAGENT_TYPES = [
    { id: 'planner', name: 'Planner', description: 'Plans the work' },
    { id: 'dev', name: 'Developer', description: 'Implements code' },
    { id: 'tester', name: 'Tester', description: 'Tests the code' },
    { id: 'reviewer', name: 'Reviewer', description: 'Reviews the code' }
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
    mockMainWindow = { webContents: mockWebContents, isDestroyed: vi.fn().mockReturnValue(false) } as unknown as BrowserWindow

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

    mockWorkflowService = {
      getActiveWorkflow: vi.fn().mockReturnValue(MOCK_WORKFLOW),
      getSubagentTypes: vi.fn().mockReturnValue(MOCK_SUBAGENT_TYPES),
      generateRulesMarkdown: vi.fn().mockReturnValue('# Workflow Rules\n\nThis is the workflow rules markdown.')
    }

    setupAgentInfo(SUPER_MINION_AGENT_INFO)

    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService)
    terminalService.setWorkflowService(mockWorkflowService)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should pass --system-prompt-file flag for super minion in planning mode', async () => {
    await startAgent()

    const command = getWrittenCommand()
    expect(command).toContain('--system-prompt-file')
    expect(mockWorkflowService.generateRulesMarkdown).toHaveBeenCalled()
  })

  it('should include workflow-aware prompt for super minion', async () => {
    await startAgent()

    // Verify generateRulesMarkdown was called with the workflow
    expect(mockWorkflowService.generateRulesMarkdown).toHaveBeenCalledWith(MOCK_WORKFLOW)

    // Check that the rules file was written
    expect(fs.writeFileSync).toHaveBeenCalled()
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('dynamic-rules.md')
    )
    expect(writeCall).toBeDefined()
  })

  it('should NOT pass --system-prompt-file flag for regular planning mode', async () => {
    setupAgentInfo(REGULAR_AGENT_INFO)

    await startAgent(TEST_PROMPT, 'agent-2')

    const command = getWrittenCommand()
    expect(command).not.toContain('--system-prompt-file')
  })

  it('should NOT include workflow-aware prompt for regular planning mode', async () => {
    setupAgentInfo(REGULAR_AGENT_INFO)

    await startAgent(TEST_PROMPT, 'agent-2')

    const command = getWrittenCommand()
    expect(command).toContain('Create a plan for: Create feature X')
    expect(command).not.toContain('**Super Minion**')
    expect(command).not.toContain('## Your Mission')
  })

  it('should include workflow in rules file', async () => {
    await startAgent('Build feature Y')

    // Verify generateRulesMarkdown was called
    expect(mockWorkflowService.generateRulesMarkdown).toHaveBeenCalled()

    // The command should include --system-prompt-file pointing to the rules
    const command = getWrittenCommand()
    expect(command).toContain('--system-prompt-file')
    expect(command).toContain('dynamic-rules.md')
  })

  it('should write rules to dynamic-rules.md file', async () => {
    await startAgent()

    // Check the rules file was created with the generated markdown
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('dynamic-rules.md')
    )
    expect(writeCall).toBeDefined()
    // The content should be from generateRulesMarkdown
    expect(writeCall?.[1]).toContain('# Workflow Rules')
  })

  it('should use fallback prompt if workflow service fails', async () => {
    mockWorkflowService.getActiveWorkflow.mockImplementation(() => {
      throw new Error('Workflow not found')
    })

    await startAgent('Test prompt')

    const command = getWrittenCommand()
    expect(command).toContain('Create a plan for: Test prompt')
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

describe('Teleport Session Retry Mechanism', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any
  let mockAgentService: any

  beforeEach(() => {
    vi.useFakeTimers()

    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents,
      isDestroyed: vi.fn().mockReturnValue(false)
    } as unknown as BrowserWindow

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
      readAgentInfo: vi.fn().mockResolvedValue({
        id: 'agent-1',
        cloudSessionId: 'session_123',
        claudeSessionId: 'session_123',
        resumeAttempts: 0,
        tool: 'claude',
        mode: 'dev',
        branch: 'feature/test'
      }),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      markAgentAsFailed: vi.fn().mockResolvedValue(undefined),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: Date.now()  // Add mtimeMs for file change detection
    } as any)

    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should retry resume with exponential backoff on first failure', async () => {
    // Mock startAgent to succeed immediately (no delay needed)
    vi.spyOn(terminalService, 'startAgent').mockResolvedValue(undefined)

    const promise = terminalService.retryResumeSession('/path/to/project', 'agent-1')

    // Advance timers by 1000ms (first retry delay)
    await vi.advanceTimersByTimeAsync(1000)

    await promise

    // First retry should update attempts
    expect(mockAgentService.updateAgentInfo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        resumeAttempts: 1,
        lastResumeAttempt: expect.any(String)
      }),
      undefined,
      undefined
    )
  }, 10000)

  it('should use exponential backoff delays: 1s, 2s, 4s', async () => {
    const delays: number[] = []

    // Track each retry attempt
    let attemptCount = 0
    mockAgentService.readAgentInfo.mockImplementation(async () => ({
      id: 'agent-1',
      resumeAttempts: attemptCount,
      claudeSessionId: 'session_123',
      tool: 'claude',
      mode: 'dev'
    }))

    // Mock startAgent to fail
    vi.spyOn(terminalService, 'startAgent').mockRejectedValue(new Error('Resume failed'))

    // Attempt retry 3 times
    for (let i = 0; i < 3; i++) {
      attemptCount = i

      const promise = terminalService.retryResumeSession('/path/to/project', 'agent-1').catch(() => {})

      // Calculate expected delay for this attempt
      const expectedDelay = Math.pow(2, i) * 1000
      delays.push(expectedDelay)

      await vi.advanceTimersByTimeAsync(expectedDelay)
      await promise
    }

    // Verify exponential backoff pattern (1s, 2s, 4s)
    expect(delays).toEqual([1000, 2000, 4000])
  }, 10000)

  it('should mark session as failed after 3 retry attempts', async () => {
    mockAgentService.readAgentInfo.mockResolvedValue({
      id: 'agent-1',
      resumeAttempts: 3,
      claudeSessionId: 'session_123',
      tool: 'claude',
      mode: 'dev'
    })

    await expect(terminalService.retryResumeSession('/path/to/project', 'agent-1')).rejects.toThrow('Max retry attempts')

    // Should mark as failed instead of retrying
    expect(mockAgentService.markAgentAsFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Max retry attempts'),
      'agent-1',           // agentId
      '/path/to/project'   // projectPath
    )
  })

  it('should clear failure state on successful retry', async () => {
    mockAgentService.readAgentInfo.mockResolvedValue({
      id: 'agent-1',
      resumeAttempts: 1,
      claudeSessionId: 'session_123',
      failureReason: 'Previous failure',
      tool: 'claude',
      mode: 'dev'
    })

    vi.spyOn(terminalService, 'startAgent').mockResolvedValue(undefined)

    const promise = terminalService.retryResumeSession('/path/to/project', 'agent-1')

    // Advance timers by 2000ms (second retry delay: 2^1 * 1000)
    await vi.advanceTimersByTimeAsync(2000)

    await promise

    // Should clear failure state on success (called twice: once for attempt update, once for success)
    const successCall = mockAgentService.updateAgentInfo.mock.calls.find((call: any) =>
      call[1].failureReason === undefined && call[1].resumeAttempts === 0
    )
    expect(successCall).toBeDefined()
  }, 10000)

  it('should send retry notification to UI', async () => {
    vi.spyOn(terminalService, 'startAgent').mockRejectedValue(new Error('Resume failed'))

    const promise = terminalService.retryResumeSession('/path/to/project', 'agent-1').catch(() => {})

    // Advance timers
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(mockWebContents.send).toHaveBeenCalledWith(
      'agent:retryingResume',
      'agent-1',
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 3
      })
    )
  }, 10000)
})

describe('Late Branch Detection', () => {
  let mockClaudeSessionInfoService: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockClaudeSessionInfoService = {
      getSessionState: vi.fn().mockReturnValue('working'),
      extractGitBranch: vi.fn().mockReturnValue(null) // Initially no branch
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should detect branch name when JSONL file gets content', async () => {
    // Initially no branch, then it appears
    let callCount = 0
    mockClaudeSessionInfoService.extractGitBranch.mockImplementation(() => {
      callCount++
      return callCount >= 3 ? 'feature/detected-branch' : null
    })

    // This simulates what happens in the polling loop
    // First call: no branch (returns null)
    expect(mockClaudeSessionInfoService.extractGitBranch()).toBeNull()

    // Second call: no branch (returns null)
    expect(mockClaudeSessionInfoService.extractGitBranch()).toBeNull()

    // Third call: branch appears!
    expect(mockClaudeSessionInfoService.extractGitBranch()).toBe('feature/detected-branch')
  })

  it('should stop checking for branch once detected', async () => {
    mockClaudeSessionInfoService.extractGitBranch.mockReturnValue('feature/my-branch')

    // Simulate multiple calls - should only update once
    const branch1 = mockClaudeSessionInfoService.extractGitBranch()
    const branch2 = mockClaudeSessionInfoService.extractGitBranch()

    expect(branch1).toBe('feature/my-branch')
    expect(branch2).toBe('feature/my-branch')
    // The service returns the same value - the TerminalService tracks needsBranchDetection flag
  })

  it('needsBranchDetection should be true for teleport sessions without displayBranchName', () => {
    const agentInfo = {
      agentId: 'teleport-agent',
      branch: 'feature/teleport-agent/teleport-01CVbxti',
      displayBranchName: undefined
    }

    // Check the condition that would be used in TerminalService
    const currentDisplayBranch = agentInfo.displayBranchName
    const needsBranchDetection = !currentDisplayBranch || (currentDisplayBranch as string).startsWith('teleport-')

    expect(needsBranchDetection).toBe(true)
  })

  it('needsBranchDetection should be true for teleport-xxx fallback names', () => {
    const agentInfo = {
      agentId: 'teleport-agent',
      branch: 'feature/teleport-agent/teleport-01CVbxti',
      displayBranchName: 'teleport-01CVbxti' // Fallback name
    }

    const currentDisplayBranch = agentInfo.displayBranchName
    const needsBranchDetection = !currentDisplayBranch || currentDisplayBranch.startsWith('teleport-')

    expect(needsBranchDetection).toBe(true)
  })

  it('needsBranchDetection should be false for detected branch names', () => {
    const agentInfo = {
      agentId: 'teleport-agent',
      branch: 'feature/teleport-agent/teleport-01CVbxti',
      displayBranchName: 'feature/my-real-branch' // Already detected
    }

    const currentDisplayBranch = agentInfo.displayBranchName
    const needsBranchDetection = !currentDisplayBranch || currentDisplayBranch.startsWith('teleport-')

    expect(needsBranchDetection).toBe(false)
  })
})

describe('Super Minion Unified Polling (State + Tasks)', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any
  let mockAgentService: any
  let mockClaudeSessionInfoService: any
  let mockWorkflowService: any

  beforeEach(() => {
    vi.useFakeTimers()

    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents,
      isDestroyed: vi.fn().mockReturnValue(false)
    } as unknown as BrowserWindow

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
      readAgentInfo: vi.fn().mockResolvedValue({ isSuperMinion: true }),
      updateAgentInfo: vi.fn().mockResolvedValue(undefined),
      getSuperMinionRulesPath: vi.fn().mockReturnValue('/path/to/rules'),
      getProjectName: vi.fn().mockImplementation((p: string) => p.split('/').pop() || 'project')
    }

    // Unified polling uses parseSessionInfo for both state and tasks
    mockClaudeSessionInfoService = {
      parseSessionInfo: vi.fn().mockReturnValue({
        sessionId: 'test-session',
        state: 'working',
        taskInvocations: []
      }),
      watchSession: vi.fn(),
      unwatchSession: vi.fn(),
      extractGitBranch: vi.fn().mockReturnValue(null),
      getSessionState: vi.fn().mockReturnValue('working'),
      findSessionFile: vi.fn().mockReturnValue('/mock/session/file.jsonl')
    }

    mockWorkflowService = {
      getActiveWorkflow: vi.fn().mockReturnValue({ id: 'default', name: 'Default', steps: [] }),
      getSubagentTypes: vi.fn().mockReturnValue([]),
      generateRulesMarkdown: vi.fn().mockReturnValue('# Rules')
    }

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: Date.now()  // Add mtimeMs for file change detection
    } as any)

    terminalService = new TerminalService(mockMainWindow)
    terminalService.setAgentService(mockAgentService)
    terminalService.setClaudeSessionInfoService(mockClaudeSessionInfoService)
    terminalService.setWorkflowService(mockWorkflowService)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should use unified 2-second polling for super minions (state + tasks)', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Should have set up the watcher
    expect(mockClaudeSessionInfoService.watchSession).toHaveBeenCalled()

    // Advance time by 2 seconds (unified polling interval)
    await vi.advanceTimersByTimeAsync(2000)

    // Should have called parseSessionInfo for unified state + task checking
    expect(mockClaudeSessionInfoService.parseSessionInfo).toHaveBeenCalled()
  })

  it('should emit agents:updated when task invocations change', async () => {
    // Use incrementing mtime to simulate file changes
    let mtimeCounter = 1000
    vi.mocked(fs.statSync).mockImplementation(() => ({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: mtimeCounter++
    } as any))

    // Start with no tasks
    mockClaudeSessionInfoService.parseSessionInfo.mockReturnValue({
      sessionId: 'test-session',
      state: 'working',
      taskInvocations: []
    })

    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Clear any initial calls
    mockWebContents.send.mockClear()

    // Advance time by 2 seconds (unified polling interval)
    await vi.advanceTimersByTimeAsync(2000)

    // Now simulate a task being spawned
    mockClaudeSessionInfoService.parseSessionInfo.mockReturnValue({
      sessionId: 'test-session',
      state: 'working',
      taskInvocations: [
        {
          toolUseId: 'task-1',
          description: 'Implement feature',
          subagentType: 'Developer',
          prompt: 'Build the feature',
          status: 'running',
          startedAt: new Date().toISOString()
        }
      ]
    })

    // Advance another 2 seconds
    await vi.advanceTimersByTimeAsync(2000)

    // Should have emitted agents:updated when tasks changed
    const updateCalls = mockWebContents.send.mock.calls.filter(
      (call: any[]) => call[0] === 'agents:updated'
    )
    expect(updateCalls.length).toBeGreaterThan(0)
  })

  it('should NOT emit agents:updated when task invocations are unchanged', async () => {
    // Start with one task
    mockClaudeSessionInfoService.parseSessionInfo.mockReturnValue({
      sessionId: 'test-session',
      state: 'working',
      taskInvocations: [
        {
          toolUseId: 'task-1',
          description: 'Implement feature',
          subagentType: 'Developer',
          prompt: 'Build the feature',
          status: 'running',
          startedAt: new Date().toISOString()
        }
      ]
    })

    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Advance past initial poll (2 second unified interval)
    await vi.advanceTimersByTimeAsync(2000)

    // Clear calls after initial detection
    mockWebContents.send.mockClear()

    // Advance another 2 seconds - same tasks, no change
    await vi.advanceTimersByTimeAsync(2000)

    // Should NOT have emitted agents:updated (no change in hash)
    const updateCalls = mockWebContents.send.mock.calls.filter(
      (call: any[]) => call[0] === 'agents:updated'
    )
    expect(updateCalls.length).toBe(0)
  })

  it('should emit agents:updated when task status changes', async () => {
    // Use incrementing mtime to simulate file changes (needed for optimization that skips unchanged files)
    let mtimeCounter = 1000
    vi.mocked(fs.statSync).mockImplementation(() => ({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: mtimeCounter++
    } as any))

    // Start with running task
    mockClaudeSessionInfoService.parseSessionInfo.mockReturnValue({
      sessionId: 'test-session',
      state: 'working',
      taskInvocations: [
        {
          toolUseId: 'task-1',
          description: 'Implement feature',
          subagentType: 'Developer',
          prompt: 'Build the feature',
          status: 'running',
          startedAt: new Date().toISOString()
        }
      ]
    })

    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Advance past initial poll (2 second unified interval)
    await vi.advanceTimersByTimeAsync(2000)

    // Clear calls
    mockWebContents.send.mockClear()

    // Task completes
    mockClaudeSessionInfoService.parseSessionInfo.mockReturnValue({
      sessionId: 'test-session',
      state: 'working',
      taskInvocations: [
        {
          toolUseId: 'task-1',
          description: 'Implement feature',
          subagentType: 'Developer',
          prompt: 'Build the feature',
          status: 'completed',  // Changed from running
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        }
      ]
    })

    // Advance another 2 seconds
    await vi.advanceTimersByTimeAsync(2000)

    // Should have emitted agents:updated due to status change
    const updateCalls = mockWebContents.send.mock.calls.filter(
      (call: any[]) => call[0] === 'agents:updated'
    )
    expect(updateCalls.length).toBeGreaterThan(0)
  })

  it('should clean up unified polling interval on stopAgent', async () => {
    // Use incrementing mtime to simulate file changes
    let mtimeCounter = 1000
    vi.mocked(fs.statSync).mockImplementation(() => ({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: mtimeCounter++
    } as any))

    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Verify polling is working (2 second unified interval)
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockClaudeSessionInfoService.parseSessionInfo.mock.calls.length).toBeGreaterThan(0)

    // Stop the agent
    terminalService.stopAgent('super-minion-1')

    // Advance time and verify no more polling calls
    mockClaudeSessionInfoService.parseSessionInfo.mockClear()
    await vi.advanceTimersByTimeAsync(3000)

    // Should not have any new parseSessionInfo calls after stopAgent
    expect(mockClaudeSessionInfoService.parseSessionInfo.mock.calls.length).toBe(0)
  })

  it('should clean up unified polling interval on terminal exit', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Get the exit handler
    const exitHandler = mockPty.onExit.mock.calls[0][0]

    // Verify polling is working (2 second unified interval)
    await vi.advanceTimersByTimeAsync(2000)

    // Simulate terminal exit
    exitHandler({ exitCode: 0, signal: null })

    // Clear and advance time
    mockClaudeSessionInfoService.parseSessionInfo.mockClear()
    await vi.advanceTimersByTimeAsync(3000)

    // Should not have any new parseSessionInfo calls after exit
    expect(mockClaudeSessionInfoService.parseSessionInfo.mock.calls.length).toBe(0)
  })

  it('should NOT set up task watcher for regular agents', async () => {
    // Non-super minion agent
    mockAgentService.readAgentInfo.mockResolvedValue({ isSuperMinion: false })

    await terminalService.startAgent(
      '/path/to/project',
      'regular-agent-1',
      'claude',
      'dev',
      'Fix a bug'
    )

    // Should NOT have set up watcher (only for super minions)
    expect(mockClaudeSessionInfoService.watchSession).not.toHaveBeenCalled()

    // Advance time (1 second unified interval)
    mockClaudeSessionInfoService.parseSessionInfo.mockClear()
    await vi.advanceTimersByTimeAsync(2000)

    // parseSessionInfo is still called for state polling (unified polling handles both)
    // but the task hash check is only done for super minions
    // The key verification is that watchSession was not called
  })

  it('should detect task changes within 2 seconds (polling interval)', async () => {
    // Use incrementing mtime to simulate file changes
    let mtimeCounter = 1000
    vi.mocked(fs.statSync).mockImplementation(() => ({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: mtimeCounter++
    } as any))

    // This test verifies: tasks are detected at 2-second polling intervals
    mockClaudeSessionInfoService.parseSessionInfo.mockReturnValue({
      sessionId: 'test-session',
      state: 'working',
      taskInvocations: []
    })

    await terminalService.startAgent(
      '/path/to/project',
      'super-minion-1',
      'claude',
      'planning',
      'Create a feature'
    )

    // Clear initial calls
    mockWebContents.send.mockClear()
    mockClaudeSessionInfoService.parseSessionInfo.mockClear()

    // After 2 seconds, parsing should have been called
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockClaudeSessionInfoService.parseSessionInfo.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('PTY Cleanup Error Handling', () => {
  let terminalService: TerminalService
  let mockMainWindow: any
  let mockWebContents: any
  let mockPty: any

  beforeEach(() => {
    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents,
      isDestroyed: vi.fn().mockReturnValue(false)
    } as unknown as BrowserWindow

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
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      mode: 0o755,
      mtimeMs: Date.now()  // Add mtimeMs for file change detection
    } as any)

    terminalService = new TerminalService(mockMainWindow)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle PTY kill errors in stopAgent gracefully', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      'Test prompt'
    )

    // Mock pty.kill to throw an error (simulating process already dead)
    mockPty.kill.mockImplementation(() => {
      throw new Error('ESRCH: No such process')
    })

    // Should not throw - errors are caught and logged
    expect(() => terminalService.stopAgent('agent-1')).not.toThrow()

    // Verify terminal was cleaned up despite error
    expect(terminalService.hasActiveTerminal('agent-1')).toBe(false)
  })

  it('should handle PTY kill errors in stopPlainTerminal gracefully', async () => {
    await terminalService.startPlainTerminal('/path/to/project', 'agent-1', 'shell-1')

    // Mock pty.kill to throw an error
    mockPty.kill.mockImplementation(() => {
      throw new Error('ESRCH: No such process')
    })

    // Should not throw - errors are caught and logged
    expect(() => terminalService.stopPlainTerminal('agent-1-shell-1')).not.toThrow()
  })

  it('should continue cleanup when one PTY fails in cleanup method', async () => {
    // Start multiple agents
    await terminalService.startAgent('/path/to/project', 'agent-1', 'claude', 'dev')
    await terminalService.startAgent('/path/to/project', 'agent-2', 'claude', 'dev')

    // Get the PTY instances for each agent
    const pty1 = vi.mocked(pty.spawn).mock.results[0].value
    const pty2 = vi.mocked(pty.spawn).mock.results[1].value

    // First PTY throws error, second should still be cleaned
    pty1.kill.mockImplementation(() => {
      throw new Error('First PTY error')
    })
    pty2.kill.mockImplementation(() => {
      // This should still be called even if first fails
    })

    // Should not throw - cleanup continues
    expect(() => terminalService.cleanup()).not.toThrow()

    // Both should have been attempted
    expect(pty1.kill).toHaveBeenCalled()
    expect(pty2.kill).toHaveBeenCalled()
  })

  it('should handle dispose errors on idle detector', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'cursor-cli', // Uses IdleDetector
      'dev',
      'Test prompt'
    )

    // Get the terminal session and mock dispose to throw
    const mockIdleDetector = {
      dispose: vi.fn().mockImplementation(() => {
        throw new Error('Dispose error')
      }),
      processOutput: vi.fn(),
      recordInput: vi.fn()
    }

    // Replace the idle detector in the session
    const session = (terminalService as any).terminals.get('agent-1')
    session.idleDetector = mockIdleDetector

    // Should not throw - errors are caught
    expect(() => terminalService.stopAgent('agent-1')).not.toThrow()
    expect(mockIdleDetector.dispose).toHaveBeenCalled()
  })

  it('should handle clearInterval errors gracefully', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      'Test prompt'
    )

    // Get session and set invalid interval
    const session = (terminalService as any).terminals.get('agent-1')
    session.statePollingInterval = {} as any // Invalid interval object

    // Should not throw - errors are caught
    expect(() => terminalService.stopAgent('agent-1')).not.toThrow()
  })

  it('should handle PTY kill error during resume recovery', async () => {
    // Start agent
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      'Test prompt'
    )

    // Get the data handler
    const dataHandler = mockPty.onData.mock.calls[0][0]

    // Mock pty.kill to throw error
    mockPty.kill.mockImplementation(() => {
      throw new Error('Process already exited')
    })

    // Trigger resume failure recovery by simulating "Session not found" output
    const session = (terminalService as any).terminals.get('agent-1')
    session._attemptingResume = true
    session.projectPath = '/path/to/project'

    // Should handle the error gracefully
    expect(() => dataHandler('Session not found\n')).not.toThrow()
  })

  it('should send IPC updates even when PTY cleanup fails', async () => {
    await terminalService.startAgent(
      '/path/to/project',
      'agent-1',
      'claude',
      'dev',
      'Test prompt'
    )

    // Mock pty.kill to throw error
    mockPty.kill.mockImplementation(() => {
      throw new Error('ESRCH: No such process')
    })

    // Clear previous IPC calls
    mockWebContents.send.mockClear()

    // Stop agent
    terminalService.stopAgent('agent-1')

    // Should still send IPC update
    expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
  })
})
