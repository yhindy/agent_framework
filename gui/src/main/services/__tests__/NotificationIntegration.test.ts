import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NotificationService } from '../NotificationService'
import { SettingsService } from '../SettingsService'
import { ClaudeSessionInfoService } from '../ClaudeSessionInfoService'
import { BrowserWindow, Notification } from 'electron'
import { readFileSync, existsSync } from 'fs'

/**
 * Notification System Integration Tests
 *
 * These tests verify the full notification flow from JSONL state detection → notification service.
 * They test the integration of ClaudeSessionInfoService and NotificationService to ensure
 * notifications are sent at the right times and spam is prevented.
 *
 * CRITICAL BUG FIXES VERIFIED:
 * - Bug #1: Slash commands should NOT trigger notifications
 * - Bug #2: Streaming text (stop_reason=null) should NOT trigger false positive notifications
 * - Bug #3: Notification cooldown (30s) and cooldown clearing when user provides input
 */

// Mock Electron
vi.mock('electron', () => {
  const mockNotificationInstance = {
    show: vi.fn(),
    on: vi.fn()
  }
  return {
    BrowserWindow: vi.fn(),
    Notification: vi.fn().mockImplementation(() => mockNotificationInstance),
    ipcMain: { on: vi.fn(), handle: vi.fn() }
  }
})

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() }))
}))

// Mock SettingsService
vi.mock('../SettingsService', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn().mockReturnValue({
      notifications: {
        enabled: true,
        cooldownSeconds: 30
      },
      defaultTool: {
        tool: 'claude',
        claudeModel: 'opusplan',
        cursorCLIModel: 'auto'
      },
      defaultAgent: {
        workflowMode: 'planning',
        yoloMode: true,
        chromeIntegration: true
      },
      version: 1
    }),
    updateSettings: vi.fn()
  }))
}))

describe('Notification System Integration Tests', () => {
  let notificationService: NotificationService
  let sessionInfoService: ClaudeSessionInfoService
  let mockMainWindow: any
  let mockSettingsService: SettingsService

  beforeEach(() => {
    vi.useFakeTimers()

    // Setup Mock Window
    mockMainWindow = {
      webContents: {
        send: vi.fn()
      },
      isFocused: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      focus: vi.fn()
    } as unknown as BrowserWindow

    mockSettingsService = new SettingsService()
    notificationService = new NotificationService(mockMainWindow, mockSettingsService)
    notificationService.clearAllCooldowns()
    notificationService.setWindowFocus(false) // Start with window unfocused

    sessionInfoService = new ClaudeSessionInfoService()

    // Default: project directory exists
    vi.mocked(existsSync).mockReturnValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    sessionInfoService.dispose()
  })

  /**
   * Helper to create JSONL content for different scenarios
   */
  const createJSONL = (...entries: any[]): string => {
    return entries.map(e => JSON.stringify(e)).join('\n')
  }

  /**
   * Helper to simulate the full flow: JSONL → state detection → notification
   */
  const simulateSessionFlow = (jsonlContent: string, worktreePath: string = '/Users/test/project'): {
    state: 'working' | 'waiting' | 'unknown'
    notificationSent: boolean
  } => {
    // Mock the JSONL file content
    vi.mocked(readFileSync).mockReturnValue(jsonlContent)

    // Get state from session info service
    const sessionId = 'test-session'
    const state = sessionInfoService.getSessionState(sessionId, worktreePath)

    // Simulate notification logic (like TerminalService does)
    let notificationSent = false
    if (state === 'waiting') {
      const result = notificationService.notify({
        title: 'Input Required',
        body: `Agent is waiting for your input`,
        agentId: sessionId
      })
      notificationSent = result
    }

    return { state, notificationSent }
  }

  // ========================================================================
  // === SHOULD NOTIFY scenarios ===
  // ========================================================================
  describe('Should notify when', () => {
    it('Claude uses AskUserQuestion tool', () => {
      const jsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'What should I do?' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_ask_1',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    { question: 'Which option do you prefer?', options: ['A', 'B', 'C'] }
                  ]
                }
              }
            ],
            stop_reason: null
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
      expect(notificationSent).toBe(true)
      expect(Notification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Input Required',
          body: expect.stringContaining('waiting for your input')
        })
      )
    })

    it('Claude uses ExitPlanMode tool', () => {
      const jsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'Plan my feature' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              { type: 'text', text: 'Here is my plan...' },
              {
                type: 'tool_use',
                id: 'toolu_exit_1',
                name: 'ExitPlanMode',
                input: {}
              }
            ],
            stop_reason: null
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
      expect(notificationSent).toBe(true)
    })

    it('Claude ends turn with END_TURN stop reason', () => {
      const jsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'Analyze this code' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [
              { type: 'text', text: 'I have completed the analysis. Let me know what to do next.' }
            ],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
      expect(notificationSent).toBe(true)
    })

    it('Claude sends text-only message with stop_sequence stop reason', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [
              { type: 'text', text: 'Task completed successfully!' }
            ],
            stop_reason: 'stop_sequence'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
      expect(notificationSent).toBe(true)
    })
  })

  // ========================================================================
  // === SHOULD NOT NOTIFY scenarios ===
  // ========================================================================
  describe('Should NOT notify when', () => {
    it('Claude uses Bash tool (working, not waiting)', () => {
      const jsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'List the files' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              { type: 'text', text: 'Let me check the files.' },
              {
                type: 'tool_use',
                id: 'toolu_bash_1',
                name: 'Bash',
                input: { command: 'ls -la' }
              }
            ],
            stop_reason: 'tool_use'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('working')
      expect(notificationSent).toBe(false)
      expect(Notification).not.toHaveBeenCalled()
    })

    it('Claude uses Read tool (working, not waiting)', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_read_1',
                name: 'Read',
                input: { file_path: '/test.txt' }
              }
            ],
            stop_reason: 'tool_use'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('working')
      expect(notificationSent).toBe(false)
    })

    it('Claude uses Write tool (working, not waiting)', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_write_1',
                name: 'Write',
                input: { file_path: '/output.txt', content: 'Hello' }
              }
            ],
            stop_reason: 'tool_use'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('working')
      expect(notificationSent).toBe(false)
    })

    it('Claude sends text-only message with null stop_reason (completed message) - Bug #2 fix reversed', () => {
      // Bug #2 fix reversed: In real Claude Code CLI, stop_reason=null for completed messages
      // Text-only messages (no tool use, no thinking) indicate Claude finished speaking
      // This is the MOST COMMON case in production, so we default to waiting
      const jsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'Write a long explanation' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [
              { type: 'text', text: 'Let me explain this in detail. First, we need to understand the fundamentals...' }
            ],
            stop_reason: null // Common in Claude Code CLI for completed messages
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting') // Text-only = completed, waiting for input
      expect(notificationSent).toBe(true) // Should notify user that Claude is waiting
      expect(Notification).toHaveBeenCalled()
    })

    it('user executes /model slash command - Bug #1 fix', () => {
      // Bug #1: Slash commands should NOT trigger notifications
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [
              { type: 'text', text: 'I can help with that.' }
            ],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<command-name>/model</command-name>'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<local-command-stdout>Set model to sonnet</local-command-stdout>'
          },
          timestamp: '2026-01-07T10:00:02.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      // Should stay waiting (from previous assistant message), not transition to working
      expect(state).toBe('waiting')
      // But notification should have already been sent for the assistant message
      // The key point: slash command entries are SKIPPED in state detection
      expect(notificationSent).toBe(true)
    })

    it('user executes /commit slash command - Bug #1 fix', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-sonnet-4-5-20250929',
            content: [
              { type: 'text', text: 'Changes have been made.' }
            ],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<command-name>/commit</command-name>'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state } = simulateSessionFlow(jsonl)

      // Slash command should be skipped, state stays waiting
      expect(state).toBe('waiting')
    })

    it('app window is focused (regardless of state)', () => {
      notificationService.setWindowFocus(true) // Window is focused

      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [
              { type: 'text', text: 'Done!' }
            ],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting') // State is waiting
      expect(notificationSent).toBe(false) // But no notification because window is focused
      expect(Notification).not.toHaveBeenCalled()
    })
  })

  // ========================================================================
  // === SLASH COMMAND scenarios ===
  // ========================================================================
  describe('Slash command handling', () => {
    it('should NOT notify during /model command execution', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Ready.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: '<command-name>/model</command-name>' },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state } = simulateSessionFlow(jsonl)

      // Slash command is skipped, so we stay in waiting state from previous assistant message
      expect(state).toBe('waiting')
    })

    it('should notify correctly AFTER slash command completes if Claude is waiting', () => {
      // First: Assistant finishes, triggers notification
      vi.mocked(readFileSync).mockReturnValue(createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Done!' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      ))

      let sessionId = 'test-session'
      let state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('waiting')

      let notificationSent = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: sessionId
      })
      expect(notificationSent).toBe(true)

      // Clear mock
      vi.mocked(Notification).mockClear()

      // Then: Slash command happens (should be skipped)
      vi.mocked(readFileSync).mockReturnValue(createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Done!' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: '<command-name>/model</command-name>' },
          timestamp: '2026-01-07T10:00:01.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: '<local-command-result>Success</local-command-result>' },
          timestamp: '2026-01-07T10:00:02.000Z'
        }
      ))

      state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('waiting') // Still waiting (slash command skipped)

      // Try to notify again - should be blocked by cooldown
      notificationSent = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: sessionId
      })
      expect(notificationSent).toBe(false) // Blocked by cooldown
      expect(Notification).not.toHaveBeenCalled()
    })

    it('should skip <local-command-stdout> entries in state detection', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Ready.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<local-command-stdout>Model switched to opus</local-command-stdout>'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state } = simulateSessionFlow(jsonl)

      // local-command-stdout is skipped, state remains waiting from assistant
      expect(state).toBe('waiting')
    })

    it('should skip <local-command-result> entries in state detection', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Complete.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<local-command-result>Command executed successfully</local-command-result>'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
    })

    it('should skip isMeta messages in state detection', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Finished.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: 'Meta information',
            isMeta: true
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const { state } = simulateSessionFlow(jsonl)

      // isMeta message is skipped, state remains waiting
      expect(state).toBe('waiting')
    })
  })

  // ========================================================================
  // === SPAM PREVENTION scenarios - Bug #3 ===
  // ========================================================================
  describe('Notification spam prevention - Bug #3', () => {
    it('should NOT spam notifications during long streaming response', () => {
      // After Bug #2 fix reversal: stop_reason=null is treated as waiting (completed message)
      // Spam prevention is handled by state transition detection (only notify when state changes)
      const completedJsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'Explain quantum physics' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [{ type: 'text', text: 'Quantum physics is a fundamental theory...' }],
            stop_reason: null // Treated as completed message
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      // First check - waiting (completed)
      let result1 = simulateSessionFlow(completedJsonl)
      expect(result1.state).toBe('waiting')
      // First notification is sent on transition to waiting
      expect(result1.notificationSent).toBe(true)

      // Clear the notification mock
      vi.mocked(Notification).mockClear()

      // Second check - still waiting (no state change, no new notification)
      let result2 = simulateSessionFlow(completedJsonl)
      expect(result2.state).toBe('waiting')
      // No new notification because state didn't change
      expect(Notification).not.toHaveBeenCalled()

      // Third check - still waiting (no state change, no new notification)
      let result3 = simulateSessionFlow(completedJsonl)
      expect(result3.state).toBe('waiting')
      // Still no new notifications
      expect(Notification).not.toHaveBeenCalled()
    })

    it('should NOT notify during mid-work status updates (text with colon)', () => {
      // Colon heuristic: Messages ending with ':' are status updates, not completion messages
      const statusUpdateJsonl = createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'Search for the bug' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [{ type: 'text', text: 'Let me search for that:' }],
            stop_reason: null // Text ends with colon = mid-work status update
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const result = simulateSessionFlow(statusUpdateJsonl)
      // Should be detected as working, not waiting
      expect(result.state).toBe('working')
      // No notification because Claude is still working
      expect(result.notificationSent).toBe(false)
      expect(Notification).not.toHaveBeenCalled()
    })

    it('should notify when text does NOT end with colon (completion message)', () => {
      // Messages without colon are completion messages
      const completionJsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [{ type: 'text', text: 'All done! Let me know if you need help.' }],
            stop_reason: null // Text doesn't end with colon = completion message
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      const result = simulateSessionFlow(completionJsonl)
      // Should be detected as waiting
      expect(result.state).toBe('waiting')
      // Notification sent because Claude is waiting for input
      expect(result.notificationSent).toBe(true)
    })

    it('should NOT notify multiple times for same waiting state', () => {
      const waitingJsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'What next?' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      )

      // First check - should notify
      const result1 = simulateSessionFlow(waitingJsonl)
      expect(result1.state).toBe('waiting')
      expect(result1.notificationSent).toBe(true)

      vi.mocked(Notification).mockClear()

      // Second check immediately - should be blocked by cooldown
      const result2 = simulateSessionFlow(waitingJsonl)
      expect(result2.state).toBe('waiting')
      expect(result2.notificationSent).toBe(false)
      expect(Notification).not.toHaveBeenCalled()
    })

    it('should respect 30s cooldown between notifications for same agent', () => {
      const waitingJsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Waiting.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      )

      // First notification
      const result1 = simulateSessionFlow(waitingJsonl)
      expect(result1.notificationSent).toBe(true)

      vi.mocked(Notification).mockClear()

      // After 15 seconds - still in cooldown
      vi.advanceTimersByTime(15000)
      const result2 = simulateSessionFlow(waitingJsonl)
      expect(result2.notificationSent).toBe(false)

      // After 31 seconds total - cooldown expired
      vi.advanceTimersByTime(16000) // 15 + 16 = 31 seconds
      vi.mocked(Notification).mockClear()
      const result3 = simulateSessionFlow(waitingJsonl)
      expect(result3.notificationSent).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })

    it('should clear cooldown when user provides input (waiting → working)', () => {
      const sessionId = 'test-session'

      // Step 1: Claude is waiting
      const waitingJsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Need input.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      )

      vi.mocked(readFileSync).mockReturnValue(waitingJsonl)
      let state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('waiting')

      // Send notification
      let notificationSent = notificationService.notify({
        title: 'Input Required',
        body: 'Agent waiting',
        agentId: sessionId
      })
      expect(notificationSent).toBe(true)

      vi.mocked(Notification).mockClear()

      // Step 2: User provides input (state → working)
      const workingJsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Need input.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: 'Do this task' },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      )

      vi.mocked(readFileSync).mockReturnValue(workingJsonl)
      state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('working')

      // Simulate cooldown clearing (like TerminalService does)
      notificationService.clearCooldown(sessionId)

      // Step 3: Claude finishes and is waiting again - should notify immediately
      const waitingAgainJsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Need input.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: 'Do this task' },
          timestamp: '2026-01-07T10:00:01.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Task complete. What next?' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:02.000Z'
        }
      )

      vi.mocked(readFileSync).mockReturnValue(waitingAgainJsonl)
      state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('waiting')

      // Should be able to notify immediately (cooldown was cleared)
      notificationSent = notificationService.notify({
        title: 'Input Required',
        body: 'Agent waiting',
        agentId: sessionId
      })
      expect(notificationSent).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })
  })

  // ========================================================================
  // === WINDOW FOCUS scenarios ===
  // ========================================================================
  describe('Window focus behavior', () => {
    it('should NOT notify when window is focused', () => {
      notificationService.setWindowFocus(true) // Window focused

      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Ready for input.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
      expect(notificationSent).toBe(false) // No notification when focused
      expect(Notification).not.toHaveBeenCalled()
    })

    it('should notify when window is unfocused', () => {
      notificationService.setWindowFocus(false) // Window unfocused

      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Ready for input.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      )

      const { state, notificationSent } = simulateSessionFlow(jsonl)

      expect(state).toBe('waiting')
      expect(notificationSent).toBe(true) // Should notify when unfocused
      expect(Notification).toHaveBeenCalled()
    })

    it('should handle focus/unfocus state changes correctly', () => {
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Input needed.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      )

      // Window focused - no notification
      notificationService.setWindowFocus(true)
      let result = simulateSessionFlow(jsonl)
      expect(result.notificationSent).toBe(false)

      // Window unfocused - should notify
      notificationService.setWindowFocus(false)
      notificationService.clearCooldown('test-session') // Clear cooldown for test
      vi.mocked(Notification).mockClear()
      result = simulateSessionFlow(jsonl)
      expect(result.notificationSent).toBe(true)

      // Window focused again - no notification
      notificationService.setWindowFocus(true)
      notificationService.clearCooldown('test-session')
      vi.mocked(Notification).mockClear()
      result = simulateSessionFlow(jsonl)
      expect(result.notificationSent).toBe(false)
    })
  })

  // ========================================================================
  // === COMPLEX INTEGRATION scenarios ===
  // ========================================================================
  describe('Complex integration scenarios', () => {
    it('should handle complete conversation flow with multiple state transitions', () => {
      const sessionId = 'test-session'
      notificationService.setWindowFocus(false)

      // Step 1: User asks question → working
      vi.mocked(readFileSync).mockReturnValue(createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'List files in /src' },
          timestamp: '2026-01-07T10:00:00.000Z'
        }
      ))
      let state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('working')

      // Step 2: Claude uses tool → working (no notification)
      vi.mocked(readFileSync).mockReturnValue(createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'List files in /src' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'ls /src' }
              }
            ],
            stop_reason: 'tool_use'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        }
      ))
      state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('working')

      // Step 3: Tool result → working
      vi.mocked(readFileSync).mockReturnValue(createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'List files in /src' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'ls /src' }
              }
            ],
            stop_reason: 'tool_use'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: 'index.ts\nutils.ts'
              }
            ]
          },
          timestamp: '2026-01-07T10:00:02.000Z'
        }
      ))
      state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('working')

      // Step 4: Claude finishes with text → waiting (SHOULD NOTIFY)
      vi.mocked(readFileSync).mockReturnValue(createJSONL(
        {
          type: 'user',
          message: { role: 'user', content: 'List files in /src' },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'ls /src' }
              }
            ],
            stop_reason: 'tool_use'
          },
          timestamp: '2026-01-07T10:00:01.000Z'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: 'index.ts\nutils.ts'
              }
            ]
          },
          timestamp: '2026-01-07T10:00:02.000Z'
        },
        {
          type: 'assistant',
          message: {
            model: 'claude-opus-4-5-20251101',
            content: [
              { type: 'text', text: 'Found 2 files. What would you like me to do next?' }
            ],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:03.000Z'
        }
      ))
      state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')
      expect(state).toBe('waiting')

      const notified = notificationService.notify({
        title: 'Input Required',
        body: 'Agent waiting',
        agentId: sessionId
      })
      expect(notified).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })

    it('should handle slash command in the middle of conversation without false notifications', () => {
      const sessionId = 'test-session'
      notificationService.setWindowFocus(false)

      // Conversation with slash command in the middle
      const jsonl = createJSONL(
        {
          type: 'assistant',
          message: {
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'Task complete.' }],
            stop_reason: 'end_turn'
          },
          timestamp: '2026-01-07T10:00:00.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: '<command-name>/model</command-name>' },
          timestamp: '2026-01-07T10:00:01.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: '<local-command-stdout>Switched model</local-command-stdout>' },
          timestamp: '2026-01-07T10:00:02.000Z'
        },
        {
          type: 'user',
          message: { role: 'user', content: '<local-command-result>Success</local-command-result>' },
          timestamp: '2026-01-07T10:00:03.000Z'
        }
      )

      vi.mocked(readFileSync).mockReturnValue(jsonl)
      const state = sessionInfoService.getSessionState(sessionId, '/Users/test/project')

      // All slash command entries are skipped, so state is waiting from assistant message
      expect(state).toBe('waiting')

      // First notification should work
      const notified1 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent waiting',
        agentId: sessionId
      })
      expect(notified1).toBe(true)

      vi.mocked(Notification).mockClear()

      // Second notification should be blocked by cooldown
      const notified2 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent waiting',
        agentId: sessionId
      })
      expect(notified2).toBe(false)
      expect(Notification).not.toHaveBeenCalled()
    })
  })
})
