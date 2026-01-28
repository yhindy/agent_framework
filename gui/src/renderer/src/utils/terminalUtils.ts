import type { Terminal as XTerm } from 'xterm'

/**
 * Escape a file path for safe use in shell commands.
 * Uses single-quote escaping which handles all special characters except single quotes.
 * Single quotes within the path are escaped using the pattern: '\''
 */
export function escapePathForShell(path: string): string {
  return "'" + path.replace(/'/g, "'\\''") + "'"
}

/**
 * Extract file paths from a DragEvent and return them as a shell-safe string.
 * Multiple paths are space-separated.
 */
export function getDroppedFilePaths(event: DragEvent): string {
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return ''

  const paths: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i] as File & { path?: string }
    // Electron adds a `path` property to File objects from drag-drop
    if (file.path) {
      paths.push(escapePathForShell(file.path))
    }
  }
  return paths.join(' ')
}

/**
 * Set up a custom key event handler for Shift+Enter to insert a literal newline.
 * This allows users to type multi-line input in the terminal.
 *
 * @param terminal - The xterm.js Terminal instance
 * @param sendInput - Function to send input to the PTY
 * @param isDisposedRef - Reference to track if the terminal has been disposed
 */
export function setupShiftEnterHandler(
  terminal: XTerm,
  sendInput: (data: string) => void,
  isDisposedRef: { current: boolean }
): void {
  terminal.attachCustomKeyEventHandler((event) => {
    // Skip if terminal is disposed
    if (isDisposedRef.current) return true

    // Only handle keydown events, not keyup
    if (event.type !== 'keydown') return true

    // Check for Shift+Enter without other modifiers
    if (
      event.key === 'Enter' &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      // Send a literal newline character to the PTY
      sendInput('\n')
      // Return false to prevent xterm.js from processing this key
      return false
    }

    // Return true to let xterm.js handle all other keys normally
    return true
  })
}
