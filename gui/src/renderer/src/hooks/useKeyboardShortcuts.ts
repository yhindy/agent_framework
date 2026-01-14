import { useEffect, useCallback } from 'react'

export interface ShortcutModifiers {
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export interface ShortcutConfig {
  key: string
  modifiers?: ShortcutModifiers
  action: () => void
  description: string
  enabled?: boolean | (() => boolean)
}

export interface UseKeyboardShortcutsOptions {
  shortcuts: ShortcutConfig[]
  enabled?: boolean
  disableWhenInputFocused?: boolean
}

function isMacPlatform(): boolean {
  return navigator.platform.toUpperCase().includes('MAC')
}

function isInputElement(element: Element | null): boolean {
  if (!element) return false

  // Exclude xterm.js's internal hidden textarea - we want shortcuts to work in terminal views
  // The terminal uses this textarea to capture keyboard input, but we don't want it to
  // block our global shortcuts
  if (element.classList.contains('xterm-helper-textarea')) {
    return false
  }

  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true
  }

  return element.getAttribute('contenteditable') === 'true'
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { shortcuts, enabled = true, disableWhenInputFocused = true } = options

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return

      // Skip if focused on input element
      if (disableWhenInputFocused && isInputElement(document.activeElement)) {
        return
      }

      const isMac = isMacPlatform()

      for (const shortcut of shortcuts) {
        const shortcutEnabled =
          typeof shortcut.enabled === 'function' ? shortcut.enabled() : shortcut.enabled ?? true

        if (!shortcutEnabled) continue

        const modifiers = shortcut.modifiers ?? {}

        // On Mac: meta modifier maps to Cmd (metaKey)
        // On Windows/Linux: meta modifier maps to Ctrl (ctrlKey)
        const expectedMetaKey = isMac ? event.metaKey : event.ctrlKey
        const metaMatches = (modifiers.meta ?? false) === expectedMetaKey

        // Explicit ctrl modifier (separate from meta on Mac, overlaps with meta on Windows/Linux)
        const ctrlMatches =
          modifiers.ctrl === undefined ||
          (isMac ? modifiers.ctrl === event.ctrlKey : !modifiers.meta && modifiers.ctrl === event.ctrlKey)

        const shiftMatches = (modifiers.shift ?? false) === event.shiftKey
        const altMatches = (modifiers.alt ?? false) === event.altKey

        const keyMatches =
          event.key.toLowerCase() === shortcut.key.toLowerCase() ||
          event.code.toLowerCase() === shortcut.key.toLowerCase()

        // On Windows/Linux, reject if Windows key (metaKey) is pressed for meta-modified shortcuts
        const windowsKeyConflict = !isMac && modifiers.meta && event.metaKey

        if (keyMatches && metaMatches && ctrlMatches && shiftMatches && altMatches && !windowsKeyConflict) {
          event.preventDefault()
          event.stopPropagation()
          shortcut.action()
          return
        }
      }
    },
    [enabled, shortcuts, disableWhenInputFocused]
  )

  useEffect(() => {
    // Use capture phase to intercept events before they reach inputs
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [handleKeyDown])
}

export function getModifierSymbol(): string {
  return isMacPlatform() ? '\u2318' : 'Ctrl'
}

export function formatShortcut(key: string, modifiers?: { meta?: boolean; shift?: boolean }): string {
  const parts: string[] = []

  if (modifiers?.meta) parts.push(getModifierSymbol())
  if (modifiers?.shift) parts.push('Shift')
  parts.push(key.toUpperCase())

  return parts.join('+')
}
