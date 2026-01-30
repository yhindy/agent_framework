/**
 * Filters terminal query responses that cause garbage display on replay.
 *
 * These responses are sent by the PTY in response to terminal capability queries.
 * They should be processed by xterm.js live, but when cached and replayed during
 * tab switching, they appear as visible garbage text.
 *
 * Filtered patterns:
 * - DA1 (Primary Device Attributes): ESC [ ? Ps ; Ps ; ... c
 * - DA2 (Secondary Device Attributes): ESC [ > Ps ; Ps ; Ps c
 * - OSC 10/11/12 Color Responses: ESC ] 1x ; rgb:xxxx/xxxx/xxxx ST
 */

/**
 * Matches DA1/DA2 response sequences from xterm.js onData.
 * When sent back to the PTY, the shell echoes them as visible garbage like [?1;2c.
 * Used in terminal onData handlers to block these from being sent to the PTY.
 */
export const DA_RESPONSE_INPUT = /^\x1b\[\??[\d;]*c$/

// DA1 Response: ESC [ ? Ps ; Ps ; ... c
const DA1_RESPONSE = /\x1b\[\?[\d;]*c/g

// DA2 Response: ESC [ > Ps ; Ps ; Ps c
const DA2_RESPONSE = /\x1b\[>[\d;]*c/g

// OSC 10/11/12 Color Responses: ESC ] 1x ; rgb:xxxx/xxxx/xxxx ST
// ST (String Terminator) can be ESC \ or BEL (\x07)
const OSC_COLOR_RESPONSE = /\x1b\]1[012];rgb:[0-9a-fA-F/]+(?:\x1b\\|\x07)/g

/**
 * Stateless filter for complete escape sequences.
 * Use this only when you know the data contains complete sequences.
 */
export function filterTerminalQueryResponses(data: string): string {
  if (!data) return data

  return data
    .replace(DA1_RESPONSE, '')
    .replace(DA2_RESPONSE, '')
    .replace(OSC_COLOR_RESPONSE, '')
}

/**
 * Checks if a string ends with a potentially incomplete escape sequence.
 * Returns the index where the incomplete sequence starts, or -1 if none.
 */
function findIncompleteSequenceStart(data: string): number {
  const lastEsc = data.lastIndexOf('\x1b')
  if (lastEsc === -1) return -1

  const suffix = data.slice(lastEsc)

  // Lone ESC could start any sequence - buffer it
  if (suffix === '\x1b') return lastEsc

  // Helper to check remainder after a complete sequence
  function checkRemainder(endIndex: number): number {
    if (endIndex >= suffix.length) return -1
    const remainder = data.slice(lastEsc + endIndex)
    const innerResult = findIncompleteSequenceStart(remainder)
    return innerResult !== -1 ? lastEsc + endIndex + innerResult : -1
  }

  // Check for CSI sequences (ESC [)
  if (suffix.length >= 2 && suffix[1] === '[') {
    if (suffix.length === 2) return lastEsc

    const thirdChar = suffix[2]
    if (thirdChar === '?' || thirdChar === '>') {
      // DA1/DA2 sequence: ESC [ ? <digits;> c  or  ESC [ > <digits;> c
      for (let i = 3; i < suffix.length; i++) {
        const char = suffix[i]
        if (char === 'c') {
          return checkRemainder(i + 1)
        }
        if (char !== ';' && (char < '0' || char > '9')) {
          return -1 // Unexpected character - not a DA sequence
        }
      }
      return lastEsc // Incomplete - no terminator found
    }
    return -1 // Other CSI sequence - not one we filter
  }

  // Check for OSC sequences (ESC ])
  if (suffix.length >= 2 && suffix[1] === ']') {
    if (suffix.length === 2) return lastEsc

    if (suffix[2] === '1') {
      if (suffix.length === 3) return lastEsc

      const fourthChar = suffix[3]
      if (fourthChar === '0' || fourthChar === '1' || fourthChar === '2' || fourthChar === ';') {
        // OSC 10/11/12 color response - ends with BEL or ST
        const belIndex = suffix.indexOf('\x07')
        if (belIndex !== -1) {
          return checkRemainder(belIndex + 1)
        }

        const stIndex = suffix.indexOf('\x1b\\')
        if (stIndex !== -1) {
          return checkRemainder(stIndex + 2)
        }

        return lastEsc // Incomplete - no terminator found
      }
    }
    return -1 // Other OSC sequence - not one we filter
  }

  return -1 // Not a filterable sequence
}

/**
 * Stateful filter that handles escape sequences split across multiple data chunks.
 */
export interface StatefulFilter {
  /** Process a chunk of terminal data, filtering query responses. */
  process(data: string): string

  /** Flush any buffered data and return it unfiltered. */
  flush(): string
}

export function createStatefulFilter(): StatefulFilter {
  let buffer = ''

  return {
    process(data: string): string {
      const combined = buffer + data
      buffer = ''

      if (!combined) return ''

      const incompleteStart = findIncompleteSequenceStart(combined)
      if (incompleteStart !== -1) {
        buffer = combined.slice(incompleteStart)
        return filterTerminalQueryResponses(combined.slice(0, incompleteStart))
      }

      return filterTerminalQueryResponses(combined)
    },

    flush(): string {
      const remaining = buffer
      buffer = ''
      return remaining
    }
  }
}
