import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useKeyboardShortcuts,
  getModifierSymbol,
  formatShortcut
} from '../useKeyboardShortcuts'

// Helper to create a keyboard event
function createKeyboardEvent(
  key: string,
  options: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    code?: string
  } = {}
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    code: options.code ?? `Key${key.toUpperCase()}`,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    bubbles: true,
    cancelable: true
  })
}

describe('useKeyboardShortcuts Hook', () => {
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    // Store original navigator.platform
    originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    // Default to Mac for most tests
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    })
  })

  afterEach(() => {
    // Restore navigator.platform
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    } else {
      // Reset to a default value if it wasn't defined
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true
      })
    }
  })

  describe('basic shortcut handling', () => {
    it('should call action when shortcut is pressed', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).toHaveBeenCalledTimes(1)
    })

    it('should not trigger action without correct modifier', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Press 'n' without meta key
      const event = createKeyboardEvent('n', { metaKey: false })
      document.dispatchEvent(event)

      expect(mockAction).not.toHaveBeenCalled()
    })

    it('should support shift modifier', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true, shift: true },
              action: mockAction,
              description: 'New super item'
            }
          ]
        })
      )

      // Should not trigger with just meta
      const eventWithoutShift = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(eventWithoutShift)
      expect(mockAction).not.toHaveBeenCalled()

      // Should trigger with meta + shift
      const eventWithShift = createKeyboardEvent('n', {
        metaKey: true,
        shiftKey: true
      })
      document.dispatchEvent(eventWithShift)
      expect(mockAction).toHaveBeenCalledTimes(1)
    })

    it('should support arrow keys', () => {
      const mockUpAction = vi.fn()
      const mockDownAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'ArrowUp',
              modifiers: { meta: true },
              action: mockUpAction,
              description: 'Previous'
            },
            {
              key: 'ArrowDown',
              modifiers: { meta: true },
              action: mockDownAction,
              description: 'Next'
            }
          ]
        })
      )

      const upEvent = createKeyboardEvent('ArrowUp', { metaKey: true })
      document.dispatchEvent(upEvent)
      expect(mockUpAction).toHaveBeenCalledTimes(1)

      const downEvent = createKeyboardEvent('ArrowDown', { metaKey: true })
      document.dispatchEvent(downEvent)
      expect(mockDownAction).toHaveBeenCalledTimes(1)
    })
  })

  describe('input focus behavior', () => {
    it('should not trigger when focused on input element', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Create and focus an input element
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).not.toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(input)
    })

    it('should not trigger when focused on textarea', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).not.toHaveBeenCalled()

      document.body.removeChild(textarea)
    })

    it('should not trigger when focused on select', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      const select = document.createElement('select')
      document.body.appendChild(select)
      select.focus()

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).not.toHaveBeenCalled()

      document.body.removeChild(select)
    })

    it('should not trigger when focused on contenteditable', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      const div = document.createElement('div')
      div.setAttribute('contenteditable', 'true')
      document.body.appendChild(div)
      div.focus()

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).not.toHaveBeenCalled()

      document.body.removeChild(div)
    })

    it('should allow Escape even when input is focused', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'Escape',
              action: mockAction,
              description: 'Close modal'
            }
          ]
        })
      )

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const event = createKeyboardEvent('Escape')
      document.dispatchEvent(event)

      expect(mockAction).toHaveBeenCalledTimes(1)

      document.body.removeChild(input)
    })

    it('should respect disableWhenInputFocused option when set to false', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ],
          disableWhenInputFocused: false
        })
      )

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).toHaveBeenCalledTimes(1)

      document.body.removeChild(input)
    })

    it('should trigger shortcuts when xterm helper textarea is focused', () => {
      // This tests that shortcuts work in AgentView when the terminal has focus
      // xterm.js uses a hidden textarea with class 'xterm-helper-textarea' for keyboard input
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Create a textarea with xterm's helper class
      const xtermTextarea = document.createElement('textarea')
      xtermTextarea.classList.add('xterm-helper-textarea')
      document.body.appendChild(xtermTextarea)
      xtermTextarea.focus()

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      // Should trigger because xterm-helper-textarea is excluded from input check
      expect(mockAction).toHaveBeenCalledTimes(1)

      document.body.removeChild(xtermTextarea)
    })
  })

  describe('enabled flag', () => {
    it('should respect global enabled flag', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ],
          enabled: false
        })
      )

      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)

      expect(mockAction).not.toHaveBeenCalled()
    })

    it('should respect per-shortcut enabled flag as boolean', () => {
      const enabledAction = vi.fn()
      const disabledAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: enabledAction,
              description: 'Enabled item',
              enabled: true
            },
            {
              key: 'o',
              modifiers: { meta: true },
              action: disabledAction,
              description: 'Disabled item',
              enabled: false
            }
          ]
        })
      )

      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      document.dispatchEvent(createKeyboardEvent('o', { metaKey: true }))

      expect(enabledAction).toHaveBeenCalledTimes(1)
      expect(disabledAction).not.toHaveBeenCalled()
    })

    it('should respect per-shortcut enabled flag as function', () => {
      const mockAction = vi.fn()
      let shouldEnable = false

      const { rerender } = renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'Conditional item',
              enabled: () => shouldEnable
            }
          ]
        })
      )

      // Should not trigger when function returns false
      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      expect(mockAction).not.toHaveBeenCalled()

      // Enable and re-render
      shouldEnable = true
      rerender()

      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      expect(mockAction).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    it('should cleanup event listener on unmount', () => {
      const mockAction = vi.fn()
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        true
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        true
      )

      // Shortcut should no longer work after unmount
      const event = createKeyboardEvent('n', { metaKey: true })
      document.dispatchEvent(event)
      expect(mockAction).not.toHaveBeenCalled()

      addEventListenerSpy.mockRestore()
      removeEventListenerSpy.mockRestore()
    })
  })

  describe('cross-platform support', () => {
    it('should use metaKey on macOS', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true
      })

      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Should work with metaKey (Cmd)
      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      expect(mockAction).toHaveBeenCalledTimes(1)

      mockAction.mockClear()

      // Should NOT work with ctrlKey on Mac
      document.dispatchEvent(createKeyboardEvent('n', { ctrlKey: true }))
      expect(mockAction).not.toHaveBeenCalled()
    })

    it('should use ctrlKey on Windows', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true
      })

      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Should work with ctrlKey on Windows
      document.dispatchEvent(createKeyboardEvent('n', { ctrlKey: true }))
      expect(mockAction).toHaveBeenCalledTimes(1)

      mockAction.mockClear()

      // Should NOT work with metaKey (Windows key) on Windows
      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      expect(mockAction).not.toHaveBeenCalled()
    })

    it('should use ctrlKey on Linux', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux x86_64',
        configurable: true
      })

      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Should work with ctrlKey on Linux
      document.dispatchEvent(createKeyboardEvent('n', { ctrlKey: true }))
      expect(mockAction).toHaveBeenCalledTimes(1)
    })
  })

  describe('event handling', () => {
    it('should prevent default behavior when shortcut matches', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      const event = createKeyboardEvent('n', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

      document.dispatchEvent(event)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('should handle multiple shortcuts', () => {
      const action1 = vi.fn()
      const action2 = vi.fn()
      const action3 = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'n',
              modifiers: { meta: true },
              action: action1,
              description: 'Action 1'
            },
            {
              key: 'o',
              modifiers: { meta: true },
              action: action2,
              description: 'Action 2'
            },
            {
              key: 't',
              modifiers: { meta: true },
              action: action3,
              description: 'Action 3'
            }
          ]
        })
      )

      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      document.dispatchEvent(createKeyboardEvent('o', { metaKey: true }))
      document.dispatchEvent(createKeyboardEvent('t', { metaKey: true }))

      expect(action1).toHaveBeenCalledTimes(1)
      expect(action2).toHaveBeenCalledTimes(1)
      expect(action3).toHaveBeenCalledTimes(1)
    })

    it('should match case-insensitively', () => {
      const mockAction = vi.fn()

      renderHook(() =>
        useKeyboardShortcuts({
          shortcuts: [
            {
              key: 'N',
              modifiers: { meta: true },
              action: mockAction,
              description: 'New item'
            }
          ]
        })
      )

      // Press lowercase 'n'
      document.dispatchEvent(createKeyboardEvent('n', { metaKey: true }))
      expect(mockAction).toHaveBeenCalledTimes(1)
    })
  })
})

describe('getModifierSymbol', () => {
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })

  it('should return command symbol on Mac', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    })

    expect(getModifierSymbol()).toBe('\u2318')
  })

  it('should return Ctrl on Windows', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true
    })

    expect(getModifierSymbol()).toBe('Ctrl')
  })

  it('should return Ctrl on Linux', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true
    })

    expect(getModifierSymbol()).toBe('Ctrl')
  })
})

describe('formatShortcut', () => {
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true
    })
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })

  it('should format shortcut with meta modifier', () => {
    expect(formatShortcut('n', { meta: true })).toBe('\u2318+N')
  })

  it('should format shortcut with meta and shift modifiers', () => {
    expect(formatShortcut('n', { meta: true, shift: true })).toBe(
      '\u2318+Shift+N'
    )
  })

  it('should format shortcut without modifiers', () => {
    expect(formatShortcut('Escape')).toBe('ESCAPE')
  })

  it('should uppercase the key', () => {
    expect(formatShortcut('a', { meta: true })).toBe('\u2318+A')
  })
})
