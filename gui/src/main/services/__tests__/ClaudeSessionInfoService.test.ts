import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClaudeSessionInfoService } from '../ClaudeSessionInfoService'
import { readFileSync, existsSync, watch } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn()
}))

// Get fixture paths
const fixturesDir = join(__dirname, 'fixtures')

// Helper to load real fixture file content
function loadFixture(name: string): string {
  // Use the actual fs to read fixtures (unmocked)
  const { readFileSync: realReadFileSync } = jest.requireActual('fs') as typeof import('fs')
  return realReadFileSync(join(fixturesDir, name), 'utf-8')
}

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
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi!"}],"stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":25}},"timestamp":"2026-01-07T10:00:05.000Z"}
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
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi!"}],"stop_reason":"end_turn","usage":{"input_tokens":50,"output_tokens":10}},"timestamp":"2026-01-07T10:00:01.000Z"}
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
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Response"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-opus-4-5-20251101')
    })

    it('aggregates token usage across multiple turns', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"1"}],"stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":10,"cache_read_input_tokens":50}},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"More"},"timestamp":"2026-01-07T10:00:01.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"2"}],"stop_reason":"end_turn","usage":{"input_tokens":150,"output_tokens":20,"cache_read_input_tokens":100}},"timestamp":"2026-01-07T10:00:02.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.tokenUsage!.inputTokens).toBe(250)
      expect(result!.tokenUsage!.outputTokens).toBe(30)
      expect(result!.tokenUsage!.cacheReadTokens).toBe(150)
    })
  })

  describe('State Detection', () => {
    it('detects waiting state when assistant finished with stop_reason', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Question?"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Answer."}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('waiting')
    })

    it('detects working state when assistant has tool_use', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"user","message":{"role":"user","content":"Read file"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"tool_use","id":"toolu_123","name":"Read","input":{}}]},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects working state when last entry is user message', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"New question"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })

    it('detects working state when user sends tool_result', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"tool_use","id":"toolu_123","name":"Read","input":{}}]},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_123","content":"file contents"}]},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')
      expect(result!.state).toBe('working')
    })
  })

  describe('getSessionState', () => {
    it('returns waiting when last assistant has stop_reason', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('waiting')
    })

    it('returns working when last entry is user', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"content":"New question"},"timestamp":"2026-01-07T10:00:01.000Z"}
      `.trim())

      const state = service.getSessionState('test', '/Users/test/project')
      expect(state).toBe('working')
    })

    it('returns unknown when session file not found', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const state = service.getSessionState('nonexistent', '/Users/test/project')
      expect(state).toBe('unknown')
    })
  })

  describe('Model Change Detection', () => {
    it('detects model change and records history', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"Hi"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"user","message":{"content":"/model opus"},"timestamp":"2026-01-07T10:01:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Switched"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:01:05.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-opus-4-5-20251101')
      expect(result!.modelHistory).toHaveLength(1)
      expect(result!.modelHistory[0].model).toBe('claude-opus-4-5-20251101')
    })

    it('tracks multiple model changes', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(`
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"1"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"2"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:01:00.000Z"}
{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"3"}],"stop_reason":"end_turn"},"timestamp":"2026-01-07T10:02:00.000Z"}
      `.trim())

      const result = service.parseSessionInfo('test', '/Users/test/project')

      expect(result!.actualModel).toBe('claude-haiku-4-5-20251001')
      expect(result!.modelHistory).toHaveLength(2)
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
})
