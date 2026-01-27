import { describe, it, expect } from 'vitest'
import { filterTerminalQueryResponses, createStatefulFilter } from '../terminalOutputFilter'

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

  describe('Fragmented escape sequences (cross-chunk splitting)', () => {
    /**
     * These tests verify that the stateful filter handles escape sequences
     * split across multiple data chunks correctly.
     *
     * In real terminal output, the PTY may send data in arbitrary-sized chunks,
     * causing sequences like "\x1b[?1;2c" to be split as:
     *   Chunk 1: "Hello\x1b"
     *   Chunk 2: "[?1;2c World"
     *
     * The stateful filter buffers incomplete sequences and prepends them to the
     * next chunk before filtering.
     */

    describe('DA1 Response fragmentation', () => {
      it('should filter DA1 when ESC is in first chunk and rest in second chunk', () => {
        // Simulating: "Hello\x1b" then "[?1;2c World"
        // Expected combined output: "Hello World"
        const filter = createStatefulFilter()
        const chunk1 = 'Hello\x1b'
        const chunk2 = '[?1;2c World'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Hello World')
      })

      it('should filter DA1 when split after ESC[', () => {
        // Simulating: "Hello\x1b[" then "?1;2c World"
        const filter = createStatefulFilter()
        const chunk1 = 'Hello\x1b['
        const chunk2 = '?1;2c World'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Hello World')
      })

      it('should filter DA1 when split in the middle of parameters', () => {
        // Simulating: "Hello\x1b[?1;" then "2c World"
        const filter = createStatefulFilter()
        const chunk1 = 'Hello\x1b[?1;'
        const chunk2 = '2c World'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Hello World')
      })
    })

    describe('DA2 Response fragmentation', () => {
      it('should filter DA2 when ESC is in first chunk and rest in second chunk', () => {
        // Simulating: "Output\x1b" then "[>0;276;0c more"
        const filter = createStatefulFilter()
        const chunk1 = 'Output\x1b'
        const chunk2 = '[>0;276;0c more'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Output more')
      })

      it('should filter DA2 when split after ESC[>', () => {
        // Simulating: "Output\x1b[>" then "0;276;0c more"
        const filter = createStatefulFilter()
        const chunk1 = 'Output\x1b[>'
        const chunk2 = '0;276;0c more'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Output more')
      })
    })

    describe('OSC Color Response fragmentation', () => {
      it('should filter OSC 10 when split after ESC]', () => {
        // Simulating: "Text\x1b]" then "10;rgb:d4d4/d4d4/d4d4\x1b\\ more"
        const filter = createStatefulFilter()
        const chunk1 = 'Text\x1b]'
        const chunk2 = '10;rgb:d4d4/d4d4/d4d4\x1b\\ more'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Text more')
      })

      it('should filter OSC 11 when split in the middle of rgb value', () => {
        // Simulating: "Text\x1b]11;rgb:1e1e/" then "1e1e/1e1e\x07 more"
        const filter = createStatefulFilter()
        const chunk1 = 'Text\x1b]11;rgb:1e1e/'
        const chunk2 = '1e1e/1e1e\x07 more'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        expect(combined).toBe('Text more')
      })
    })

    describe('Multiple consecutive fragmented sequences', () => {
      it('should filter multiple DA1 responses split across chunks', () => {
        // Simulating a burst of responses split awkwardly:
        // Chunk 1: "Start\x1b[?1;2cMiddle\x1b"
        // Chunk 2: "[?64;1cEnd"
        const filter = createStatefulFilter()
        const chunk1 = 'Start\x1b[?1;2cMiddle\x1b'
        const chunk2 = '[?64;1cEnd'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        // The first DA1 in chunk1 should be filtered (it's complete)
        // The second DA1 split across chunks should also be filtered
        expect(combined).toBe('StartMiddleEnd')
      })

      it('should filter mixed DA1 and DA2 responses split across chunks', () => {
        // Chunk 1: "A\x1b[?1;2cB\x1b"
        // Chunk 2: "[>0;276;0cC"
        const filter = createStatefulFilter()
        const chunk1 = 'A\x1b[?1;2cB\x1b'
        const chunk2 = '[>0;276;0cC'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const combined = result1 + result2

        // First DA1 is complete and should be filtered
        // DA2 is split and should also be filtered
        expect(combined).toBe('ABC')
      })
    })

    describe('Edge cases for fragmentation', () => {
      it('should handle chunk ending with lone ESC byte', () => {
        // A chunk that ends with just ESC - could be start of any escape sequence
        const filter = createStatefulFilter()
        const chunk1 = 'Hello\x1b'
        const chunk2 = '[?1;2c'
        const chunk3 = ' World'

        const result1 = filter.process(chunk1)
        const result2 = filter.process(chunk2)
        const result3 = filter.process(chunk3)
        const combined = result1 + result2 + result3

        expect(combined).toBe('Hello World')
      })

      it('should handle sequence split into many small chunks', () => {
        // Extreme fragmentation: "\x1b[?1;2c" split character by character
        const filter = createStatefulFilter()
        const chunks = ['\x1b', '[', '?', '1', ';', '2', 'c']
        const results = chunks.map((c) => filter.process(c))
        const combined = results.join('')

        expect(combined).toBe('')
      })

      it('should not incorrectly filter partial sequences that are actually normal text', () => {
        // This is normal text that happens to look like fragments
        // but should NOT be filtered because it's not part of an actual escape sequence
        const input = '[?1;2c' // No ESC prefix - this is just text
        expect(filterTerminalQueryResponses(input)).toBe('[?1;2c')
      })
    })
  })
})
