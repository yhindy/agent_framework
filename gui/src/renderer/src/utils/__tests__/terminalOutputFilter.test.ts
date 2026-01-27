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

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(filterTerminalQueryResponses('')).toBe('')
    })

    it('should handle string with no escape sequences', () => {
      const input = 'Plain text without escapes'
      expect(filterTerminalQueryResponses(input)).toBe(input)
    })
  })
})
