import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  escapePathForShell,
  getDroppedFilePaths,
  setupShiftEnterHandler
} from '../terminalUtils'

describe('terminalUtils', () => {
  describe('escapePathForShell', () => {
    it('wraps simple paths in single quotes', () => {
      const result = escapePathForShell('/Users/test/file.txt')
      expect(result).toBe("'/Users/test/file.txt'")
    })

    it('handles paths with spaces', () => {
      const result = escapePathForShell('/Users/test/my file.txt')
      expect(result).toBe("'/Users/test/my file.txt'")
    })

    it('escapes single quotes in paths', () => {
      const result = escapePathForShell("/Users/test/it's a file.txt")
      expect(result).toBe("'/Users/test/it'\\''s a file.txt'")
    })

    it('handles paths with multiple single quotes', () => {
      const result = escapePathForShell("/Users/test/it's John's file.txt")
      expect(result).toBe("'/Users/test/it'\\''s John'\\''s file.txt'")
    })

    it('handles paths with special characters (no escaping needed)', () => {
      const result = escapePathForShell('/Users/test/file$with&special*chars.txt')
      expect(result).toBe("'/Users/test/file$with&special*chars.txt'")
    })

    it('handles paths with double quotes (no escaping needed)', () => {
      const result = escapePathForShell('/Users/test/"quoted".txt')
      expect(result).toBe("'/Users/test/\"quoted\".txt'")
    })

    it('handles empty path', () => {
      const result = escapePathForShell('')
      expect(result).toBe("''")
    })

    it('handles path with only single quote', () => {
      const result = escapePathForShell("'")
      expect(result).toBe("''\\'''")
    })

    it('handles paths with newlines', () => {
      const result = escapePathForShell('/Users/test/file\nwith\nnewlines.txt')
      expect(result).toBe("'/Users/test/file\nwith\nnewlines.txt'")
    })
  })

  describe('getDroppedFilePaths', () => {
    it('returns empty string when no files', () => {
      const event = {
        dataTransfer: {
          files: { length: 0 }
        }
      } as unknown as DragEvent
      expect(getDroppedFilePaths(event)).toBe('')
    })

    it('returns empty string when dataTransfer is null', () => {
      const event = {
        dataTransfer: null
      } as unknown as DragEvent
      expect(getDroppedFilePaths(event)).toBe('')
    })

    it('returns escaped path for single file', () => {
      const event = {
        dataTransfer: {
          files: {
            length: 1,
            0: { path: '/Users/test/file.txt' }
          }
        }
      } as unknown as DragEvent
      expect(getDroppedFilePaths(event)).toBe("'/Users/test/file.txt'")
    })

    it('returns space-separated escaped paths for multiple files', () => {
      const event = {
        dataTransfer: {
          files: {
            length: 3,
            0: { path: '/Users/test/file1.txt' },
            1: { path: '/Users/test/file2.txt' },
            2: { path: '/Users/test/file3.txt' }
          }
        }
      } as unknown as DragEvent
      expect(getDroppedFilePaths(event)).toBe(
        "'/Users/test/file1.txt' '/Users/test/file2.txt' '/Users/test/file3.txt'"
      )
    })

    it('handles files with special characters', () => {
      const event = {
        dataTransfer: {
          files: {
            length: 1,
            0: { path: "/Users/test/it's a file.txt" }
          }
        }
      } as unknown as DragEvent
      expect(getDroppedFilePaths(event)).toBe("'/Users/test/it'\\''s a file.txt'")
    })

    it('skips files without path property', () => {
      const event = {
        dataTransfer: {
          files: {
            length: 2,
            0: { name: 'file1.txt' }, // no path
            1: { path: '/Users/test/file2.txt' }
          }
        }
      } as unknown as DragEvent
      expect(getDroppedFilePaths(event)).toBe("'/Users/test/file2.txt'")
    })
  })

  describe('setupShiftEnterHandler', () => {
    let mockTerminal: {
      attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
    }
    let mockSendInput: ReturnType<typeof vi.fn>
    let isDisposedRef: { current: boolean }
    let capturedHandler: (event: KeyboardEvent) => boolean

    beforeEach(() => {
      mockTerminal = {
        attachCustomKeyEventHandler: vi.fn((handler) => {
          capturedHandler = handler
        })
      }
      mockSendInput = vi.fn()
      isDisposedRef = { current: false }
    })

    it('attaches a custom key event handler to the terminal', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)
      expect(mockTerminal.attachCustomKeyEventHandler).toHaveBeenCalledOnce()
    })

    it('sends newline on Shift+Enter keydown', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).toHaveBeenCalledWith('\n')
      expect(result).toBe(false) // prevent default handling
    })

    it('ignores Shift+Enter keyup events', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keyup',
        key: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true) // allow default handling
    })

    it('ignores regular Enter without Shift', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true) // allow default handling
    })

    it('ignores Shift+Enter with Ctrl modifier', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'Enter',
        shiftKey: true,
        ctrlKey: true,
        altKey: false,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('ignores Shift+Enter with Alt modifier', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        altKey: true,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('ignores Shift+Enter with Meta modifier', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: true
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('does nothing when terminal is disposed', () => {
      isDisposedRef.current = true
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('allows other keys to pass through', () => {
      setupShiftEnterHandler(mockTerminal as any, mockSendInput, isDisposedRef)

      const event = {
        type: 'keydown',
        key: 'a',
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      } as KeyboardEvent

      const result = capturedHandler(event)

      expect(mockSendInput).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })
  })
})
