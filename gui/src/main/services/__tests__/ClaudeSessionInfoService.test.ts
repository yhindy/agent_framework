import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClaudeSessionInfoService } from '../ClaudeSessionInfoService'
import { readFileSync, existsSync, watch, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() }))
}))

describe('ClaudeSessionInfoService', () => {
  let service: ClaudeSessionInfoService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ClaudeSessionInfoService()
  })

  afterEach(() => {
    service.dispose()
  })

  describe('getClaudeProjectHash', () => {
    it('converts path to Claude project hash format', () => {
      const hash = service.getClaudeProjectHash('/Users/test/code/my-project')
      // Claude keeps the leading dash from the path conversion
      expect(hash).toBe('-Users-test-code-my-project')
    })

    it('handles paths with multiple slashes', () => {
      const hash = service.getClaudeProjectHash('/a/b/c/d/e')
      expect(hash).toBe('-a-b-c-d-e')
    })
  })

  describe('getClaudeProjectPath', () => {
    it('returns path when project directory exists', () => {
      const worktreePath = '/Users/test/code/project'
      // Claude keeps the leading dash
      const expectedPath = join(homedir(), '.claude', 'projects', '-Users-test-code-project')

      vi.mocked(existsSync).mockReturnValue(true)

      const result = service.getClaudeProjectPath(worktreePath)
      expect(result).toBe(expectedPath)
    })

    it('returns null when project directory does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = service.getClaudeProjectPath('/Users/test/nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('findSessionFile', () => {
    it('returns session file path when it exists', () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const result = service.findSessionFile('session-123', '/Users/test/project')
      expect(result).toContain('session-123.jsonl')
    })

    it('returns null when session file does not exist', () => {
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)  // Project path exists
        .mockReturnValueOnce(false) // Session file does not exist

      const result = service.findSessionFile('nonexistent', '/Users/test/project')
      expect(result).toBeNull()
    })

    it('returns null when project path does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = service.findSessionFile('session-123', '/nonexistent/path')
      expect(result).toBeNull()
    })
  })

  describe('parseSessionInfo', () => {
    it('parses a valid session file', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","sessionId":"test-123","version":"2.0.76","message":{"role":"user","content":"Hello"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi!"}],"stop_reason":"stop_sequence","usage":{"input_tokens":100,"output_tokens":25}},"timestamp":"2026-01-07T10:00:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test-123', '/Users/test/project')

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe('test-123')
      expect(result!.actualModel).toBe('claude-haiku-4-5-20251001')
      expect(result!.claudeCodeVersion).toBe('2.0.76')
      expect(result!.state).toBe('waiting')
      expect(result!.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      })
    })

    it('handles malformed lines gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2026-01-07T10:00:00.000Z"}
not valid json
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi!"}],"stop_reason":"stop_sequence","usage":{"input_tokens":50,"output_tokens":10}},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result).not.toBeNull()
      expect(result!.actualModel).toBe('claude-haiku-4-5-20251001')
    })

    it('returns null when session file not found', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = service.parseSessionInfo('nonexistent', '/Users/test/project')
      expect(result).toBeNull()
    })

    it('extracts model from assistant messages', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Response"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-opus-4-5-20251101')
    })

    it('aggregates token usage across multiple turns', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"1"}],"stop_reason":"stop_sequence","usage":{"input_tokens":100,"output_tokens":10,"cache_read_input_tokens":50}},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"More"},"timestamp":"2026-01-07T10:00:01.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"2"}],"stop_reason":"stop_sequence","usage":{"input_tokens":150,"output_tokens":20,"cache_read_input_tokens":100}},"timestamp":"2026-01-07T10:00:02.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.tokenUsage!.inputTokens).toBe(250)
      expect(result!.tokenUsage!.outputTokens).toBe(30)
      expect(result!.tokenUsage!.cacheReadTokens).toBe(150)
    })
  })

  describe('State Detection', () => {
    it('detects waiting state ONLY when stop_reason is end_turn', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Question?"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Answer."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('waiting')
    })

    it('should detect waiting state for text-only messages with null stop_reason (completed messages)', () => {
      // This is the most common case in real JSONL files from Claude Code CLI
      // Claude completes a response but stop_reason is null
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Perfect! All notification bugs have been fixed! Let me know if you need anything else."}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should be waiting, not working! This is a completed message.
      expect(result!.state).toBe('waiting')
    })

    it('should detect working state for text ending with colon (status update)', () => {
      // Messages ending with colon are ALWAYS mid-work status updates (100% accurate based on 201 samples)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Let me search for that:"}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Status update with colon - more work coming (tool_use follows)
      expect(result!.state).toBe('working')
    })

    it('should detect working state for "Now I will" pattern with colon', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Now I'll read the file:"}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Status update indicating work in progress
      expect(result!.state).toBe('working')
    })

    it('should detect waiting state for text NOT ending with colon', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Perfect! All bugs are fixed. Let me know if you need anything else."}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Completion message without colon
      expect(result!.state).toBe('waiting')
    })

    it('should detect waiting state for completion messages without colon', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"The task is complete. All tests are passing."}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Completion message
      expect(result!.state).toBe('waiting')
    })

    it('detects waiting when stop_reason is stop_sequence (edge case)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('waiting')
    })

    it('detects working when stop_reason is tool_use', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"tool_use","id":"toolu_123","name":"Bash","input":{"command":"ls"}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects working state when assistant has tool_use content', () => {
      // Real JSONL structure: assistant with tool_use = working (tool is executing)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","isSidechain":false,"userType":"external","cwd":"/Users/test/project","sessionId":"test-session","version":"2.1.1","gitBranch":"main","type":"assistant","message":{"model":"claude-opus-4-5-20251101","id":"msg_123","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01U2sBQNa3JuqCFXDzjJuFoJ","name":"Bash","input":{"command":"ls -la"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}},"uuid":"def456","timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects working state when assistant is thinking', () => {
      // Real JSONL structure: assistant with thinking = working (extended thinking)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","isSidechain":false,"userType":"external","cwd":"/Users/test/project","sessionId":"test-session","version":"2.1.1","gitBranch":"main","type":"assistant","message":{"model":"claude-opus-4-5-20251101","id":"msg_123","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze this problem...","signature":"EuMBCkYICxgC..."}],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}},"uuid":"def456","timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects working state when last entry is user with tool_result', () => {
      // Real JSONL structure: user sending tool_result = working (Claude processing)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","isSidechain":false,"userType":"external","cwd":"/Users/test/project","sessionId":"test-session","version":"2.1.1","gitBranch":"main","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01TVZdHQsv6x16zUrhXXsLDa","type":"tool_result","content":"file contents here"}]},"uuid":"def456","timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects waiting state when assistant finished with text and end_turn', () => {
      // Real JSONL structure: assistant with text + end_turn = waiting (Claude finished responding)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","isSidechain":false,"userType":"external","cwd":"/Users/test/project","sessionId":"test-session","version":"2.1.1","gitBranch":"main","type":"assistant","message":{"model":"claude-opus-4-5-20251101","id":"msg_123","type":"message","role":"assistant","content":[{"type":"text","text":"I've completed the task. Let me know if you need anything else."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":50}},"uuid":"def456","timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('waiting')
    })

    it('skips non-conversation entries (summary, file-history-snapshot)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:01.000Z"}
{"type":"summary","summary":"Test summary"}
{"type":"file-history-snapshot","messageId":"msg-1","snapshot":{"trackedFileBackups":{}}}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should still be waiting because last CONVERSATION entry is assistant with text + end_turn
      expect(result!.state).toBe('waiting')
    })

    it('detects working when assistant has text + tool_use together', () => {
      // Real scenario: Claude says something then uses a tool
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Let me check that file."},{"type":"tool_use","id":"toolu_123","name":"Read","input":{"file_path":"/test.txt"}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects waiting when ExitPlanMode is used (human approval needed)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_123","name":"ExitPlanMode","input":{}}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // ExitPlanMode waits for HUMAN approval, not automatic tool result
      expect(result!.state).toBe('waiting')
    })

    it('detects waiting when AskUserQuestion is used (human answer needed)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_456","name":"AskUserQuestion","input":{"questions":[{"question":"Which option?","options":["A","B"]}]}}],"stop_reason":null},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // AskUserQuestion waits for HUMAN answer, not automatic tool result
      expect(result!.state).toBe('waiting')
    })
  })

  describe('getSessionState', () => {
    it('returns waiting when assistant finished with text only', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"I've finished the analysis."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('waiting')
    })

    it('returns working for text ending with colon (status update)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Let me search for that:"}],"stop_reason":null},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('working')
    })

    it('returns waiting for text NOT ending with colon (completion)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"All done! Let me know if you need help."}],"stop_reason":null},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('waiting')
    })

    it('returns working when last entry is user', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"content":[{"type":"text","text":"Done"}],"stop_reason":null},"timestamp":"2026-01-07T10:00:00.000Z"}
{"parentUuid":"def456","type":"user","message":{"role":"user","content":"New question"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('working')
    })

    it('returns working when assistant has tool_use', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_123","name":"Bash","input":{}}],"stop_reason":null},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('working')
    })

    it('returns working when assistant is thinking', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"content":[{"type":"thinking","thinking":"Analyzing..."}],"stop_reason":null},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('working')
    })

    it('returns unknown when session file not found', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const state = service.getSessionState('nonexistent', '/Users/test/project')
      expect(state).toBe('unknown')
    })

    it('skips summary and file-history-snapshot entries', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"parentUuid":"abc123","type":"assistant","message":{"content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"summary","summary":"Conversation summary"}
{"type":"file-history-snapshot","messageId":"msg-1","snapshot":{"trackedFileBackups":{}}}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      // Should be waiting because last CONVERSATION entry is assistant with text only
      expect(state).toBe('waiting')
    })
  })

  describe('Model Change Detection', () => {
    it('detects model change and records history', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"content":"/model opus"},"timestamp":"2026-01-07T10:01:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Switched"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:01:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-opus-4-5-20251101')
      expect(result!.modelHistory).toHaveLength(1)
      expect(result!.modelHistory[0].model).toBe('claude-opus-4-5-20251101')
    })

    it('tracks multiple model changes', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"1"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"2"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:01:00.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"3"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:02:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-haiku-4-5-20251001')
      expect(result!.modelHistory).toHaveLength(2)
    })
  })

  describe('OpusPlan Model Support', () => {
    it('extracts claude-opus-4-5-20251101 as actual model', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Planning..."}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-opus-4-5-20251101')
    })

    it('tracks model change from Opus to Sonnet in OpusPlan', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Planning the implementation..."}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"content":"Approved"},"timestamp":"2026-01-07T10:01:00.000Z"}
{"type":"assistant","message":{"model":"claude-sonnet-4-5-20250929","content":[{"type":"text","text":"Implementing..."}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:01:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-sonnet-4-5-20250929')
      expect(result!.modelHistory).toHaveLength(1)
      expect(result!.modelHistory[0].model).toBe('claude-sonnet-4-5-20250929')
      expect(result!.modelHistory[0].timestamp).toBe('2026-01-07T10:01:05.000Z')
    })

    it('formats Opus 4.5 model name correctly', () => {
      const formatted = ClaudeSessionInfoService.formatModelName('claude-opus-4-5-20251101')
      expect(formatted).toBe('claude-opus-4-5')
    })
  })

  describe('Static formatting methods', () => {
    it('formatModelName removes date suffix', () => {
      expect(ClaudeSessionInfoService.formatModelName('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
      expect(ClaudeSessionInfoService.formatModelName('claude-opus-4-5-20251101')).toBe('claude-opus-4-5')
    })

    it('formatTokenCount formats numbers correctly', () => {
      expect(ClaudeSessionInfoService.formatTokenCount(500)).toBe('500')
      expect(ClaudeSessionInfoService.formatTokenCount(1234)).toBe('1.2K')
      expect(ClaudeSessionInfoService.formatTokenCount(12345)).toBe('12.3K')
    })

    it('formatCost formats currency correctly', () => {
      expect(ClaudeSessionInfoService.formatCost(0.001)).toBe('$0.0010')
      expect(ClaudeSessionInfoService.formatCost(0.0124)).toBe('$0.01')
      expect(ClaudeSessionInfoService.formatCost(1.50)).toBe('$1.50')
    })
  })

  describe('watchSession', () => {
    it('creates file watcher for session', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const mockWatcher = { close: vi.fn() }
      vi.mocked(watch).mockReturnValue(mockWatcher as any)

      const callback = vi.fn()
      service.watchSession('test', '/Users/test/project', callback)

      expect(watch).toHaveBeenCalled()
    })

    it('does not create duplicate watchers', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const mockWatcher = { close: vi.fn() }
      vi.mocked(watch).mockReturnValue(mockWatcher as any)

      const callback = vi.fn()
      service.watchSession('test', '/Users/test/project', callback)
      service.watchSession('test', '/Users/test/project', callback)

      expect(watch).toHaveBeenCalledTimes(1)
    })
  })

  describe('unwatchSession', () => {
    it('closes watcher when unwatching', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const mockWatcher = { close: vi.fn() }
      vi.mocked(watch).mockReturnValue(mockWatcher as any)

      service.watchSession('test', '/Users/test/project', vi.fn())
      service.unwatchSession('test')

      expect(mockWatcher.close).toHaveBeenCalled()
    })
  })

  describe('Slash Command Detection', () => {
    it('should skip <command-name> entries', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"<command-name>/model</command-name>"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should stay waiting because we skip slash command
      expect(result!.state).toBe('waiting')
    })

    it('should skip <local-command-stdout> entries', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"<local-command-stdout>Set model to haiku...</local-command-stdout>"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should stay waiting because we skip local-command-stdout
      expect(result!.state).toBe('waiting')
    })

    it('should skip <local-command-result> entries', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"<local-command-result>Success</local-command-result>"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should stay waiting because we skip local-command-result
      expect(result!.state).toBe('waiting')
    })

    it('should skip isMeta messages', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"Meta message","isMeta":true},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should stay waiting because we skip isMeta messages
      expect(result!.state).toBe('waiting')
    })

    it('should handle /model slash command without false waiting state', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"I'll help you with that."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"<command-name>/model</command-name>"},"timestamp":"2026-01-07T10:00:01.000Z"}
{"type":"user","message":{"role":"user","content":"<local-command-stdout>Set model to sonnet...</local-command-stdout>"},"timestamp":"2026-01-07T10:00:02.000Z"}
{"type":"user","message":{"role":"user","content":"<local-command-result>Success</local-command-result>"},"timestamp":"2026-01-07T10:00:03.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should stay waiting because all slash command related entries are skipped
      expect(result!.state).toBe('waiting')
    })

    it('should handle /commit slash command correctly', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-sonnet-4-5-20250929","content":[{"type":"text","text":"Changes made."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"<command-name>/commit</command-name>"},"timestamp":"2026-01-07T10:00:01.000Z"}
{"type":"user","message":{"role":"user","content":"<local-command-stdout>Committing...</local-command-stdout>"},"timestamp":"2026-01-07T10:00:02.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      // Should stay waiting - slash command should not trigger working state
      expect(result!.state).toBe('waiting')
    })

    it('should also work in getSessionState for slash commands', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"<local-command-stdout>Set model to haiku...</local-command-stdout>"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      // Should be waiting because slash command entries are skipped
      expect(state).toBe('waiting')
    })
  })

  describe('Task Tool Invocation Parsing', () => {
    it('parses a running Task tool invocation', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Help me implement auth"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"I'll spawn a subagent."},{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Implement login component","subagent_type":"general-purpose","prompt":"Create a login form..."}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result).not.toBeNull()
      expect(result!.taskInvocations).toHaveLength(1)
      expect(result!.taskInvocations[0]).toEqual({
        toolUseId: 'toolu_task_001',
        description: 'Implement login component',
        subagentType: 'general-purpose',
        prompt: 'Create a login form...',
        status: 'running',
        startedAt: '2026-01-07T10:00:05.000Z'
      })
    })

    it('parses a completed Task tool invocation', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Help me implement auth"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Implement login","subagent_type":"general-purpose","prompt":"Create login..."}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:05.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_001","content":"Task completed successfully. Created Login.tsx and LoginForm.tsx files."}]},"timestamp":"2026-01-07T10:05:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result).not.toBeNull()
      expect(result!.taskInvocations).toHaveLength(1)
      expect(result!.taskInvocations[0].status).toBe('completed')
      expect(result!.taskInvocations[0].completedAt).toBe('2026-01-07T10:05:00.000Z')
      expect(result!.taskInvocations[0].resultSummary).toBe('Task completed successfully. Created Login.tsx and LoginForm.tsx files.')
    })

    it('parses a failed Task tool invocation', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_task_002","name":"Task","input":{"description":"Fix bug","subagent_type":"general-purpose","prompt":"Fix the bug..."}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_002","content":"Error: Could not complete task","is_error":true}]},"timestamp":"2026-01-07T10:01:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.taskInvocations).toHaveLength(1)
      expect(result!.taskInvocations[0].status).toBe('failed')
    })

    it('parses multiple Task tool invocations (parallel tasks)', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Task 1","subagent_type":"general-purpose","prompt":"Do task 1"}},{"type":"tool_use","id":"toolu_task_002","name":"Task","input":{"description":"Task 2","subagent_type":"Explore","prompt":"Do task 2"}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_001","content":"Task 1 done"}]},"timestamp":"2026-01-07T10:01:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.taskInvocations).toHaveLength(2)
      expect(result!.taskInvocations[0].description).toBe('Task 1')
      expect(result!.taskInvocations[0].status).toBe('completed')
      expect(result!.taskInvocations[1].description).toBe('Task 2')
      expect(result!.taskInvocations[1].subagentType).toBe('Explore')
      expect(result!.taskInvocations[1].status).toBe('running')
    })

    it('ignores non-Task tool uses', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_read_001","name":"Read","input":{"file_path":"/test.txt"}},{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Real task","subagent_type":"general-purpose","prompt":"Do something"}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.taskInvocations).toHaveLength(1)
      expect(result!.taskInvocations[0].description).toBe('Real task')
    })

    it('returns empty array when no Task tools used', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Hi there!"}],"stop_reason":"stop_sequence"},"timestamp":"2026-01-07T10:00:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.taskInvocations).toHaveLength(0)
    })

    it('truncates long result summaries to 500 chars', () => {
      const longResult = 'A'.repeat(1000)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Task","subagent_type":"general-purpose","prompt":"Do it"}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_001","content":"${longResult}"}]},"timestamp":"2026-01-07T10:01:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.taskInvocations[0].resultSummary).toHaveLength(500)
    })

    it('should return working state when super minion has text-only message but running Task invocations', () => {
      // REGRESSION TEST: Super minions should NOT trigger "waiting for input" notifications
      // between Task invocations. When a Task subagent is running, the super minion
      // is still working, even if it sends a text-only message not ending with colon.
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Help me implement both frontend and backend"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"I'll spawn two subagents to work on this in parallel."},{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Implement frontend","subagent_type":"general-purpose","prompt":"Create the React components..."}},{"type":"tool_use","id":"toolu_task_002","name":"Task","input":{"description":"Implement backend","subagent_type":"general-purpose","prompt":"Create the API endpoints..."}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:05.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_001","content":"Frontend completed successfully."}]},"timestamp":"2026-01-07T10:05:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"The frontend task is complete. I'm still waiting for the backend task to finish."}],"stop_reason":null},"timestamp":"2026-01-07T10:05:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      // Should be 'working' because toolu_task_002 is still running
      // NOT 'waiting' even though the text doesn't end with colon
      expect(result!.state).toBe('working')
      expect(result!.taskInvocations).toHaveLength(2)
      expect(result!.taskInvocations[0].status).toBe('completed')
      expect(result!.taskInvocations[1].status).toBe('running')
    })

    it('should return waiting state when all Task invocations are completed and text does not end with colon', () => {
      // When all tasks are done and super minion sends completion message, it SHOULD be waiting
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Help me implement both frontend and backend"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"I'll spawn two subagents."},{"type":"tool_use","id":"toolu_task_001","name":"Task","input":{"description":"Implement frontend","subagent_type":"general-purpose","prompt":"Create components..."}},{"type":"tool_use","id":"toolu_task_002","name":"Task","input":{"description":"Implement backend","subagent_type":"general-purpose","prompt":"Create API..."}}],"stop_reason":"tool_use"},"timestamp":"2026-01-07T10:00:05.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_001","content":"Frontend done."}]},"timestamp":"2026-01-07T10:05:00.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_task_002","content":"Backend done."}]},"timestamp":"2026-01-07T10:06:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Both tasks are now complete. Let me know if you need anything else."}],"stop_reason":null},"timestamp":"2026-01-07T10:06:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      // Should be 'waiting' because all tasks are complete and message doesn't end with colon
      expect(result!.state).toBe('waiting')
      expect(result!.taskInvocations).toHaveLength(2)
      expect(result!.taskInvocations[0].status).toBe('completed')
      expect(result!.taskInvocations[1].status).toBe('completed')
    })
  })

  describe('extractGitBranch', () => {
    it('extracts gitBranch from JSONL file', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now(), size: 100 } as any)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","gitBranch":"feature/my-branch","sessionId":"test-session","timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5"}}
      `.trim())

      const result = service.extractGitBranch('test-session', '/Users/test/project')

      expect(result).toBe('feature/my-branch')
    })

    it('strips refs/heads/ prefix from gitBranch', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now(), size: 100 } as any)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","gitBranch":"refs/heads/feature/my-branch","sessionId":"test-session"}
      `.trim())

      const result = service.extractGitBranch('test-session', '/Users/test/project')

      expect(result).toBe('feature/my-branch')
    })

    it('returns null when file is empty', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now(), size: 0 } as any)

      const result = service.extractGitBranch('test-session', '/Users/test/project')

      expect(result).toBeNull()
    })

    it('returns null when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = service.extractGitBranch('test-session', '/Users/test/project')

      expect(result).toBeNull()
    })

    it('returns null when no gitBranch field exists', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now(), size: 100 } as any)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","sessionId":"test-session","timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5"}}
      `.trim())

      const result = service.extractGitBranch('test-session', '/Users/test/project')

      expect(result).toBeNull()
    })

    it('handles malformed JSONL gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now(), size: 100 } as any)
      vi.mocked(readFileSync).mockReturnValue('{invalid json')

      const result = service.extractGitBranch('test-session', '/Users/test/project')

      expect(result).toBeNull()
    })
  })
})
