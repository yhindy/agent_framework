import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TeleportMetadataService } from '../TeleportMetadataService'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn()
}))

describe('TeleportMetadataService', () => {
  let service: TeleportMetadataService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TeleportMetadataService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Helper to set up mocks for a successful JSONL file find.
   * The service now scans directories for any .jsonl file, not specific filenames.
   */
  const mockSuccessfulJsonlFind = (jsonlContent: string, fileSize: number = 100) => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue(['uuid-session-123.jsonl'] as any)
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: Date.now(),
      size: fileSize,
      isFile: () => true
    } as any)
    vi.mocked(readFileSync).mockReturnValue(jsonlContent)
  }

  describe('extractBranchFromTeleportedSession', () => {
    it('should extract branch name from JSONL gitBranch field', async () => {
      const sessionId = 'session_01CVbxti' // Cloud session ID (not used for lookup)
      const worktreePath = '/Users/test/project-abc'

      const mockJSONL = `{"type":"user","gitBranch":"feature/my-awesome-feature","timestamp":"2026-01-11T18:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5"}}`

      mockSuccessfulJsonlFind(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBe('feature/my-awesome-feature')
    })

    it('should extract short branch name from full path (strips refs/heads/)', async () => {
      const sessionId = 'session_456'
      const worktreePath = '/Users/test/project-xyz'

      const mockJSONL = `{"type":"user","gitBranch":"refs/heads/feature/bugfix-123"}`

      mockSuccessfulJsonlFind(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBe('feature/bugfix-123')
    })

    it('should return null when project directory does not exist', async () => {
      const sessionId = 'missing-session'
      const worktreePath = '/Users/test/project-missing'

      vi.mocked(existsSync).mockReturnValue(false)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBeNull()
    }, 15000)

    it('should return null when gitBranch field is missing', async () => {
      const sessionId = 'no-branch-session'
      const worktreePath = '/Users/test/project-nobranch'

      // JSONL without gitBranch field
      const mockJSONL = `{"type":"user","timestamp":"2026-01-11T18:00:00.000Z"}
{"type":"assistant","message":{"model":"claude-opus-4-5"}}`

      mockSuccessfulJsonlFind(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBeNull()
    })

    it('should wait up to 10 seconds for JSONL to sync (timeout scenario)', async () => {
      const sessionId = 'slow-sync-session'
      const worktreePath = '/Users/test/project-slow'

      // Mock project directory exists but no jsonl files
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([] as any) // No JSONL files

      const start = Date.now()
      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)
      const elapsed = Date.now() - start

      expect(result).toBeNull()
      // Should timeout after max 10 seconds (with some tolerance)
      expect(elapsed).toBeGreaterThanOrEqual(9000)
      expect(elapsed).toBeLessThan(12000)
    }, 15000)

    it('should detect branch when file appears during wait period', async () => {
      const sessionId = 'delayed-sync-session'
      const worktreePath = '/Users/test/project-delayed'

      const mockJSONL = `{"type":"user","gitBranch":"feature/delayed-branch"}`

      vi.mocked(existsSync).mockReturnValue(true)

      let callCount = 0
      vi.mocked(readdirSync).mockImplementation(() => {
        callCount++
        // File appears after 2 checks (simulating 2 second delay)
        return callCount >= 2 ? ['uuid-delayed.jsonl'] as any : [] as any
      })

      vi.mocked(statSync).mockReturnValue({
        mtimeMs: Date.now(),
        size: 100, // Non-empty file
        isFile: () => true
      } as any)
      vi.mocked(readFileSync).mockReturnValue(mockJSONL)

      const start = Date.now()
      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)
      const elapsed = Date.now() - start

      expect(result).toBe('feature/delayed-branch')
      // Should return as soon as file is found (around 2 seconds)
      expect(elapsed).toBeLessThan(5000)
    })

    it('should skip empty files and wait for content', async () => {
      const sessionId = 'empty-file-session'
      const worktreePath = '/Users/test/project-empty'

      const mockJSONL = `{"type":"user","gitBranch":"feature/eventually-has-content"}`

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue(['uuid-session.jsonl'] as any)

      let callCount = 0
      vi.mocked(statSync).mockImplementation(() => {
        callCount++
        return {
          mtimeMs: Date.now(),
          size: callCount >= 3 ? 100 : 0, // Empty at first, then has content
          isFile: () => true
        } as any
      })
      vi.mocked(readFileSync).mockReturnValue(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBe('feature/eventually-has-content')
    })

    it('should handle malformed JSONL gracefully', async () => {
      const sessionId = 'malformed-session'
      const worktreePath = '/Users/test/project-malformed'

      // Invalid JSON
      const mockJSONL = `{invalid json here`

      mockSuccessfulJsonlFind(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBeNull()
    })

    it('should extract from first valid entry in multi-line JSONL', async () => {
      const sessionId = 'multi-line-session'
      const worktreePath = '/Users/test/project-multi'

      const mockJSONL = `{"type":"file-history-snapshot","timestamp":"2026-01-11T18:00:00.000Z"}
{"type":"user","gitBranch":"feature/multi-line-test"}
{"type":"assistant","message":{"model":"claude-opus-4-5"}}`

      mockSuccessfulJsonlFind(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBe('feature/multi-line-test')
    })

    it('should handle main/master branch names correctly', async () => {
      const sessionId = 'main-branch-session'
      const worktreePath = '/Users/test/project-main'

      const mockJSONL = `{"type":"user","gitBranch":"main"}`

      mockSuccessfulJsonlFind(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBe('main')
    })

    it('should use most recently modified JSONL when multiple exist', async () => {
      const sessionId = 'multi-session'
      const worktreePath = '/Users/test/project-multi-files'

      const mockJSONL = `{"type":"user","gitBranch":"feature/most-recent"}`

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        'old-session.jsonl',
        'newest-session.jsonl',
        'middle-session.jsonl'
      ] as any)

      // Return different mtimes to simulate different ages
      const now = Date.now()
      vi.mocked(statSync).mockImplementation((path: any) => {
        const mtime = path.includes('newest') ? now : path.includes('middle') ? now - 1000 : now - 2000
        return { mtimeMs: mtime, size: 100, isFile: () => true } as any
      })
      vi.mocked(readFileSync).mockReturnValue(mockJSONL)

      const result = await service.extractBranchFromTeleportedSession(sessionId, worktreePath)

      expect(result).toBe('feature/most-recent')
      // Should have read the newest file
      expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('newest-session.jsonl'),
        'utf-8'
      )
    })
  })

  describe('getClaudeProjectPath', () => {
    it('should convert worktree path to Claude project hash format', () => {
      const worktreePath = '/Users/yhindy/code/agent_framework-abc123'

      // Mock both the original path check and the normalized path check
      let callCount = 0
      vi.mocked(existsSync).mockImplementation(() => {
        callCount++
        // First call checks the original path (with underscore), second checks normalized (all dashes)
        return callCount === 2 // Return true on second call (normalized path)
      })

      const result = service['getClaudeProjectPath'](worktreePath)

      // Result should be the full path to the Claude project directory with normalized hash
      expect(result).not.toBeNull()
      expect(result).toContain('.claude/projects')
      // The result will have underscores converted to dashes per Claude's normalization
      expect(result).toContain('-Users-yhindy-code-agent-framework-abc123')
    })

    it('should return null when project directory does not exist', () => {
      const worktreePath = '/Users/test/nonexistent-project'

      vi.mocked(existsSync).mockReturnValue(false)

      const result = service['getClaudeProjectPath'](worktreePath)

      expect(result).toBeNull()
    })
  })
})
