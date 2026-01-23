import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JsonClaudeService } from '../JsonClaudeService'
import { BrowserWindow } from 'electron'
import * as childProcess from 'child_process'
import { EventEmitter } from 'events'
import type { Readable } from 'stream'

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}))

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

// Create mock stream that emits data and readline events
// Must include resume/pause methods for readline.createInterface
function createMockReadable(): Readable & EventEmitter {
  const emitter = new EventEmitter() as Readable & EventEmitter & {
    resume: () => void
    pause: () => void
    setEncoding: (encoding: string) => void
  }
  // These methods are required by readline.createInterface
  emitter.resume = vi.fn()
  emitter.pause = vi.fn()
  emitter.setEncoding = vi.fn()
  return emitter
}

describe('JsonClaudeService', () => {
  let service: JsonClaudeService
  let mockMainWindow: BrowserWindow
  let mockProcess: childProcess.ChildProcess
  let mockStdout: Readable & EventEmitter
  let mockStderr: Readable & EventEmitter
  let mockStdin: { write: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    // Create mock window
    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn()
      }
    } as unknown as BrowserWindow

    // Create mock streams
    mockStdout = createMockReadable()
    mockStderr = createMockReadable()
    mockStdin = { write: vi.fn() }

    // Create mock process
    mockProcess = new EventEmitter() as childProcess.ChildProcess
    mockProcess.stdout = mockStdout as any
    mockProcess.stderr = mockStderr as any
    mockProcess.stdin = mockStdin as any
    mockProcess.kill = vi.fn()

    // Mock spawn using vi.mocked
    vi.mocked(childProcess.spawn).mockReturnValue(mockProcess)

    // Create service
    service = new JsonClaudeService(mockMainWindow)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('startAgent', () => {
    it('should spawn claude process with correct arguments', async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        model: 'sonnet',
        mode: 'planning',
        displayName: 'Test Agent'
      })

      expect(vi.mocked(childProcess.spawn)).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p',
          '--output-format',
          'stream-json',
          '--input-format',
          'stream-json',
          '--include-partial-messages',
          '--model',
          'sonnet',
          '--permission-mode',
          'plan',
          '--',
          'test prompt'
        ]),
        expect.objectContaining({
          cwd: '/test/path'
        })
      )
    })

    it('should emit initializing state on start', async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:stateChanged',
        'test-agent',
        'initializing'
      )
    })

    it('should not start duplicate agent', async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })

      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt 2',
        displayName: 'Test Agent 2'
      })

      // Should only spawn once
      expect(vi.mocked(childProcess.spawn)).toHaveBeenCalledTimes(1)
    })
  })

  describe('message parsing', () => {
    beforeEach(async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })
    })

    // Helper to emit data as readline would receive it (with newline)
    const emitLine = (data: string) => {
      mockStdout.emit('data', Buffer.from(data + '\n'))
    }

    it('should parse system message and set session ID', () => {
      const systemMessage = JSON.stringify({
        type: 'system',
        session_id: 'test-session-123',
        model: 'claude-sonnet'
      })

      emitLine(systemMessage)

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:stateChanged',
        'test-agent',
        'working'
      )
    })

    it('should parse assistant message with text', () => {
      const assistantMessage = JSON.stringify({
        type: 'assistant',
        uuid: 'msg-123',
        session_id: 'test-session',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, I am Claude!' }],
          stop_reason: 'end_turn'
        }
      })

      emitLine(assistantMessage)

      // Should emit conversation item
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:conversationItem',
        'test-agent',
        expect.objectContaining({
          type: 'assistant_text',
          content: 'Hello, I am Claude!'
        })
      )

      // Should detect waiting state
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:stateChanged',
        'test-agent',
        'waiting'
      )
    })

    it('should parse tool_use and detect waiting tools', () => {
      const toolUseMessage = JSON.stringify({
        type: 'assistant',
        uuid: 'msg-123',
        session_id: 'test-session',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-123',
            name: 'AskUserQuestion',
            input: { question: 'What color do you prefer?' }
          }],
          stop_reason: 'tool_use'
        }
      })

      emitLine(toolUseMessage)

      // Should detect waiting state for AskUserQuestion
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:waitingForInput',
        'test-agent',
        expect.objectContaining({
          type: 'question',
          toolName: 'AskUserQuestion',
          question: 'What color do you prefer?'
        })
      )
    })

    it('should parse tool_result and emit working state', () => {
      const toolResultMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-123',
            content: 'File contents here...'
          }]
        }
      })

      emitLine(toolResultMessage)

      // Should emit working state (tool results mean Claude is processing)
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:stateChanged',
        'test-agent',
        'working'
      )
    })

    it('should parse result message', () => {
      const resultMessage = JSON.stringify({
        type: 'result',
        is_error: false,
        num_turns: 5,
        total_cost_usd: 0.02
      })

      emitLine(resultMessage)

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:stateChanged',
        'test-agent',
        'completed'
      )

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'claude:sessionEnded',
        'test-agent',
        expect.objectContaining({
          isError: false,
          stats: expect.objectContaining({
            totalCostUsd: 0.02,
            numTurns: 5
          })
        })
      )
    })
  })

  describe('sendInput', () => {
    // Helper to emit data as readline would receive it (with newline)
    const emitLine = (data: string) => {
      mockStdout.emit('data', Buffer.from(data + '\n'))
    }

    beforeEach(async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })
    })

    it('should send text input to stdin', () => {
      service.sendInput('test-agent', 'Hello Claude!')

      expect(mockStdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"user"')
      )
      expect(mockStdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"text":"Hello Claude!"')
      )
    })

    it('should send tool_result when responding to waiting tool', () => {
      // First, simulate a waiting tool state
      const toolUseMessage = JSON.stringify({
        type: 'assistant',
        uuid: 'msg-123',
        session_id: 'test-session',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-456',
            name: 'AskUserQuestion',
            input: { question: 'Color?' }
          }],
          stop_reason: 'tool_use'
        }
      })
      emitLine(toolUseMessage)

      // Now send response
      service.sendInput('test-agent', 'Blue')

      expect(mockStdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"tool_use_id":"tool-456"')
      )
      expect(mockStdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"content":"Blue"')
      )
    })
  })

  describe('stopAgent', () => {
    it('should kill the process', async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })

      service.stopAgent('test-agent')

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })

  describe('getConversation', () => {
    // Helper to emit data as readline would receive it (with newline)
    const emitLine = (data: string) => {
      mockStdout.emit('data', Buffer.from(data + '\n'))
    }

    it('should return empty array for unknown agent', () => {
      expect(service.getConversation('unknown')).toEqual([])
    })

    it('should return conversation items', async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })

      const assistantMessage = JSON.stringify({
        type: 'assistant',
        uuid: 'msg-123',
        session_id: 'test-session',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          stop_reason: 'end_turn'
        }
      })
      emitLine(assistantMessage)

      const conversation = service.getConversation('test-agent')
      expect(conversation).toHaveLength(1)
      expect(conversation[0].type).toBe('assistant_text')
      expect(conversation[0].content).toBe('Hello!')
    })
  })

  describe('memory management', () => {
    // Helper to emit data as readline would receive it (with newline)
    const emitLine = (data: string) => {
      mockStdout.emit('data', Buffer.from(data + '\n'))
    }

    it('should truncate large tool results', async () => {
      await service.startAgent({
        agentId: 'test-agent',
        worktreePath: '/test/path',
        projectPath: '/test/project',
        prompt: 'test prompt',
        displayName: 'Test Agent'
      })

      // Create a large tool result (>50KB)
      const largeContent = 'x'.repeat(60000)
      const toolResultMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-123',
            content: largeContent
          }]
        }
      })

      emitLine(toolResultMessage)

      const conversation = service.getConversation('test-agent')
      expect(conversation[0].content.length).toBeLessThan(largeContent.length)
      expect(conversation[0].isTruncated).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('should kill all sessions on cleanup', async () => {
      await service.startAgent({
        agentId: 'test-agent-1',
        worktreePath: '/test/path1',
        projectPath: '/test/project',
        prompt: 'test prompt 1',
        displayName: 'Test Agent 1'
      })

      service.cleanup()

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(service.hasAgent('test-agent-1')).toBe(false)
    })
  })
})
