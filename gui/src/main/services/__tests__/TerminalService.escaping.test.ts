import { describe, it, expect } from 'vitest'
import { escapeForDoubleQuotes } from '../TerminalService'

describe('escapeForDoubleQuotes', () => {
  it('should escape backticks to prevent command substitution', () => {
    // This test would have FAILED before the fix - backticks were not escaped
    const input = 'Hello `whoami` world'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('Hello \\`whoami\\` world')
    // Without escaping, `whoami` would execute as a shell command
  })

  it('should escape double quotes', () => {
    const input = 'Say "hello" to the world'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('Say \\"hello\\" to the world')
  })

  it('should escape dollar signs to prevent variable expansion', () => {
    const input = 'The price is $100 and $USER is set'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('The price is \\$100 and \\$USER is set')
  })

  it('should escape $() command substitution syntax', () => {
    // This is another form of command substitution that needed escaping
    const input = 'Hello $(whoami) world'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('Hello \\$(whoami) world')
  })

  it('should escape backslashes first to avoid double-escaping', () => {
    const input = 'Path is C:\\Users\\name'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('Path is C:\\\\Users\\\\name')
  })

  it('should handle complex prompts with multiple special characters', () => {
    // Real-world example that would have broken the super agent
    const input = 'Fix the bug in `src/utils.ts` where $count is undefined'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('Fix the bug in \\`src/utils.ts\\` where \\$count is undefined')
  })

  it('should handle code blocks with backticks', () => {
    // Common case: user includes code in their prompt
    const input = 'The function `getUserById` returns null when id is "invalid"'
    const result = escapeForDoubleQuotes(input)
    expect(result).toBe('The function \\`getUserById\\` returns null when id is \\"invalid\\"')
  })

  it('should return empty string for empty input', () => {
    expect(escapeForDoubleQuotes('')).toBe('')
  })

  it('should leave normal text unchanged', () => {
    const input = 'This is a normal prompt without special characters'
    expect(escapeForDoubleQuotes(input)).toBe(input)
  })

  it('should handle newlines (they pass through unchanged)', () => {
    const input = 'Line 1\nLine 2'
    expect(escapeForDoubleQuotes(input)).toBe('Line 1\nLine 2')
  })
})
