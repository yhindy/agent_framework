import { describe, it, expect, beforeEach } from 'vitest'
import { TeleportService, TeleportInfo } from '../TeleportService'

describe('TeleportService', () => {
  let teleportService: TeleportService

  beforeEach(() => {
    teleportService = new TeleportService()
  })

  describe('parseSessionId', () => {
    describe('from full URL', () => {
      it('extracts session ID from claude.ai URL', () => {
        const input = 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })

      it('extracts session ID from URL with trailing slash', () => {
        const input = 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B/'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })

      it('extracts session ID from URL with query params', () => {
        const input = 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B?ref=share'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })
    })

    describe('from CLI command', () => {
      it('extracts session ID from full claude command', () => {
        const input = 'claude --teleport session_01CVbxtiJWp387FoCSvAiS2B'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })

      it('extracts session ID from command with extra flags', () => {
        const input = 'claude --teleport session_01CVbxtiJWp387FoCSvAiS2B --verbose'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })
    })

    describe('from raw session ID', () => {
      it('returns the session ID directly', () => {
        const input = 'session_01CVbxtiJWp387FoCSvAiS2B'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })

      it('handles session ID with whitespace', () => {
        const input = '  session_01CVbxtiJWp387FoCSvAiS2B  '
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_01CVbxtiJWp387FoCSvAiS2B')
      })

      it('handles session ID with various alphanumeric characters', () => {
        const input = 'session_ABC123xyz789'
        const result = teleportService.parseSessionId(input)
        expect(result).toBe('session_ABC123xyz789')
      })
    })

    describe('invalid inputs', () => {
      it('returns null for empty string', () => {
        expect(teleportService.parseSessionId('')).toBeNull()
      })

      it('returns null for whitespace only', () => {
        expect(teleportService.parseSessionId('   ')).toBeNull()
      })

      it('returns null for null input', () => {
        expect(teleportService.parseSessionId(null as unknown as string)).toBeNull()
      })

      it('returns null for undefined input', () => {
        expect(teleportService.parseSessionId(undefined as unknown as string)).toBeNull()
      })

      it('returns null for non-string input', () => {
        expect(teleportService.parseSessionId(123 as unknown as string)).toBeNull()
      })

      it('returns null for string without session ID', () => {
        expect(teleportService.parseSessionId('hello world')).toBeNull()
      })

      it('returns null for malformed session ID', () => {
        expect(teleportService.parseSessionId('session_')).toBeNull()
      })

      it('returns null for URL without session ID', () => {
        expect(teleportService.parseSessionId('https://claude.ai/code/')).toBeNull()
      })
    })
  })

  describe('isValidSessionId', () => {
    it('returns true for valid session ID', () => {
      expect(teleportService.isValidSessionId('session_01CVbxtiJWp387FoCSvAiS2B')).toBe(true)
    })

    it('returns true for session ID with only lowercase', () => {
      expect(teleportService.isValidSessionId('session_abcdef123')).toBe(true)
    })

    it('returns true for session ID with only uppercase', () => {
      expect(teleportService.isValidSessionId('session_ABCDEF123')).toBe(true)
    })

    it('returns true for session ID with only numbers', () => {
      expect(teleportService.isValidSessionId('session_123456789')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(teleportService.isValidSessionId('')).toBe(false)
    })

    it('returns false for null', () => {
      expect(teleportService.isValidSessionId(null as unknown as string)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(teleportService.isValidSessionId(undefined as unknown as string)).toBe(false)
    })

    it('returns false for session ID without prefix', () => {
      expect(teleportService.isValidSessionId('01CVbxtiJWp387FoCSvAiS2B')).toBe(false)
    })

    it('returns false for session ID with wrong prefix', () => {
      expect(teleportService.isValidSessionId('sess_01CVbxtiJWp387FoCSvAiS2B')).toBe(false)
    })

    it('returns false for session ID with special characters', () => {
      expect(teleportService.isValidSessionId('session_abc-def_123')).toBe(false)
    })

    it('returns false for session ID with only prefix', () => {
      expect(teleportService.isValidSessionId('session_')).toBe(false)
    })
  })

  describe('getTeleportInfo', () => {
    it('returns complete TeleportInfo for valid session ID', () => {
      const sessionId = 'session_01CVbxtiJWp387FoCSvAiS2B'
      const result = teleportService.getTeleportInfo(sessionId)

      expect(result).toEqual<TeleportInfo>({
        sessionId: 'session_01CVbxtiJWp387FoCSvAiS2B',
        url: 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B',
        command: 'claude --teleport session_01CVbxtiJWp387FoCSvAiS2B'
      })
    })

    it('throws error for invalid session ID', () => {
      expect(() => teleportService.getTeleportInfo('invalid')).toThrow('Invalid session ID: invalid')
    })

    it('throws error for empty session ID', () => {
      expect(() => teleportService.getTeleportInfo('')).toThrow('Invalid session ID: ')
    })
  })

  describe('getTeleportUrl', () => {
    it('generates correct URL for valid session ID', () => {
      const sessionId = 'session_01CVbxtiJWp387FoCSvAiS2B'
      const result = teleportService.getTeleportUrl(sessionId)
      expect(result).toBe('https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B')
    })

    it('generates correct URL for different session ID', () => {
      const sessionId = 'session_ABC123xyz789'
      const result = teleportService.getTeleportUrl(sessionId)
      expect(result).toBe('https://claude.ai/code/session_ABC123xyz789')
    })

    it('throws error for invalid session ID', () => {
      expect(() => teleportService.getTeleportUrl('invalid')).toThrow('Invalid session ID: invalid')
    })

    it('throws error for null session ID', () => {
      expect(() => teleportService.getTeleportUrl(null as unknown as string)).toThrow()
    })
  })

  describe('getTeleportCommand', () => {
    it('generates correct command for valid session ID', () => {
      const sessionId = 'session_01CVbxtiJWp387FoCSvAiS2B'
      const result = teleportService.getTeleportCommand(sessionId)
      expect(result).toBe('claude --teleport session_01CVbxtiJWp387FoCSvAiS2B')
    })

    it('generates correct command for different session ID', () => {
      const sessionId = 'session_ABC123xyz789'
      const result = teleportService.getTeleportCommand(sessionId)
      expect(result).toBe('claude --teleport session_ABC123xyz789')
    })

    it('throws error for invalid session ID', () => {
      expect(() => teleportService.getTeleportCommand('not_a_session')).toThrow(
        'Invalid session ID: not_a_session'
      )
    })

    it('throws error for empty session ID', () => {
      expect(() => teleportService.getTeleportCommand('')).toThrow('Invalid session ID: ')
    })
  })

  describe('suggestProjectPath', () => {
    it('returns first project when multiple projects available', () => {
      const projects = ['/Users/dev/project-a', '/Users/dev/project-b']
      const result = teleportService.suggestProjectPath('session_01CVbxtiJWp387FoCSvAiS2B', projects)
      expect(result).toBe('/Users/dev/project-a')
    })

    it('returns the only project when single project available', () => {
      const projects = ['/Users/dev/my-project']
      const result = teleportService.suggestProjectPath('session_01CVbxtiJWp387FoCSvAiS2B', projects)
      expect(result).toBe('/Users/dev/my-project')
    })

    it('returns null for empty projects array', () => {
      const result = teleportService.suggestProjectPath('session_01CVbxtiJWp387FoCSvAiS2B', [])
      expect(result).toBeNull()
    })

    it('returns null for invalid session ID', () => {
      const projects = ['/Users/dev/project-a']
      const result = teleportService.suggestProjectPath('invalid_session', projects)
      expect(result).toBeNull()
    })

    it('returns null for null projects array', () => {
      const result = teleportService.suggestProjectPath('session_01CVbxtiJWp387FoCSvAiS2B', null as unknown as string[])
      expect(result).toBeNull()
    })

    it('returns null for undefined projects array', () => {
      const result = teleportService.suggestProjectPath('session_01CVbxtiJWp387FoCSvAiS2B', undefined as unknown as string[])
      expect(result).toBeNull()
    })
  })

  describe('end-to-end workflow', () => {
    it('parses URL and generates info correctly', () => {
      const url = 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B'
      const sessionId = teleportService.parseSessionId(url)

      expect(sessionId).not.toBeNull()
      expect(teleportService.isValidSessionId(sessionId!)).toBe(true)

      const info = teleportService.getTeleportInfo(sessionId!)
      expect(info.url).toBe(url)
    })

    it('parses command and generates info correctly', () => {
      const command = 'claude --teleport session_01CVbxtiJWp387FoCSvAiS2B'
      const sessionId = teleportService.parseSessionId(command)

      expect(sessionId).not.toBeNull()
      expect(teleportService.isValidSessionId(sessionId!)).toBe(true)

      const info = teleportService.getTeleportInfo(sessionId!)
      expect(info.command).toBe(command)
    })
  })
})
