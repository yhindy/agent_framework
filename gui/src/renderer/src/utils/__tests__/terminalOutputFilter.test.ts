import { describe, it, expect } from 'vitest'
import { filterTerminalQueryResponses } from '../terminalOutputFilter'

describe('filterTerminalQueryResponses', () => {
  describe('DA1 Response filtering', () => {
    it('should filter DA1 response: \\x1b[?1;2c', () => {
      const input = '\x1b[?1;2c'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should filter DA1 response embedded in output', () => {
      const input = 'Hello\x1b[?1;2cWorld'
      expect(filterTerminalQueryResponses(input)).toBe('HelloWorld')
    })
  })

  describe('DA2 Response filtering', () => {
    it('should filter DA2 response: \\x1b[>0;276;0c', () => {
      const input = '\x1b[>0;276;0c'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })
  })

  describe('OSC Color Response filtering', () => {
    it('should filter OSC 10 foreground color response with ESC backslash', () => {
      const input = '\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should filter OSC 11 background color response with BEL', () => {
      const input = '\x1b]11;rgb:1e1e/1e1e/1e1e\x07'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should filter OSC 12 cursor color response', () => {
      const input = '\x1b]12;rgb:ffff/ffff/ffff\x1b\\'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })
  })

  describe('Mixed content', () => {
    it('should filter multiple responses while preserving normal output', () => {
      const input = 'Normal text\x1b[?1;2c\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\More text'
      expect(filterTerminalQueryResponses(input)).toBe('Normal textMore text')
    })

    it('should preserve normal ANSI escape sequences (colors, cursor)', () => {
      const input = '\x1b[32mGreen text\x1b[0m'
      expect(filterTerminalQueryResponses(input)).toBe('\x1b[32mGreen text\x1b[0m')
    })

    it('should preserve OSC title sequences', () => {
      const input = '\x1b]0;My Title\x07'
      expect(filterTerminalQueryResponses(input)).toBe('\x1b]0;My Title\x07')
    })
  })

  describe('Orphaned DA responses (PTY split sequences)', () => {
    it('should filter orphaned DA1 response at start of chunk: [?1;2c', () => {
      const input = '[?1;2c'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should filter orphaned DA1 response with different params: [?64;1;2;6;9;15;18;21;22c', () => {
      const input = '[?64;1;2;6;9;15;18;21;22c'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should filter orphaned DA2 response at start of chunk: [>0;276;0c', () => {
      const input = '[>0;276;0c'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should NOT filter bracket sequences that appear mid-text (not orphaned)', () => {
      const input = 'Some text [?1;2c more text'
      expect(filterTerminalQueryResponses(input)).toBe('Some text [?1;2c more text')
    })

    it('should filter orphaned response followed by normal output', () => {
      const input = '[?1;2cHello World'
      expect(filterTerminalQueryResponses(input)).toBe('Hello World')
    })

    it('should handle orphaned response that is just the minimal pattern', () => {
      const input = '[?c'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })
  })

  describe('Minion command script filtering', () => {
    it('should filter bash .minion-cmd.sh command', () => {
      const input = 'bash /Users/test/project/.minion-cmd.sh'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })

    it('should filter minion-cmd.sh embedded in output', () => {
      const input = 'Starting agent... bash /path/to/.minion-cmd.sh\nRunning...'
      expect(filterTerminalQueryResponses(input)).toBe('Starting agent... \nRunning...')
    })

    it('should filter minion-cmd.sh with various paths', () => {
      const input = 'bash   /Users/yhindy/code/agent_framework-30qijhy/.minion-cmd.sh'
      expect(filterTerminalQueryResponses(input)).toBe('')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(filterTerminalQueryResponses('')).toBe('')
    })

    it('should handle string with no escape sequences', () => {
      const input = 'Plain text without escapes'
      expect(filterTerminalQueryResponses(input)).toBe(input)
    })

    it('should preserve text with brackets that is not a DA response', () => {
      const input = '[INFO] Starting application'
      expect(filterTerminalQueryResponses(input)).toBe('[INFO] Starting application')
    })
  })
})
