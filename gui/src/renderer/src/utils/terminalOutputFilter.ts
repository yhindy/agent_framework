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
 *
 * Also filters orphaned DA responses that occur when PTY splits escape sequences
 * across chunks (e.g., ESC in one chunk, [?1;2c in the next).
 */

// DA1 Response: ESC [ ? Ps ; Ps ; ... c
const DA1_RESPONSE = /\x1b\[\?[\d;]*c/g

// DA2 Response: ESC [ > Ps ; Ps ; Ps c
const DA2_RESPONSE = /\x1b\[>[\d;]*c/g

// OSC 10/11/12 Color Responses: ESC ] 1x ; rgb:xxxx/xxxx/xxxx ST
// ST (String Terminator) can be ESC \ or BEL (\x07)
const OSC_COLOR_RESPONSE = /\x1b\]1[012];rgb:[0-9a-fA-F/]+(?:\x1b\\|\x07)/g

// Orphaned DA1 Response: [ ? Ps ; Ps ; ... c (without ESC prefix)
// This occurs when PTY splits the escape sequence across chunks
const ORPHANED_DA1_RESPONSE = /^\[\?[\d;]*c/

// Orphaned DA2 Response: [ > Ps ; Ps ; Ps c (without ESC prefix)
const ORPHANED_DA2_RESPONSE = /^\[>[\d;]*c/

// Minion command script echo - filters the bash command that launches agents
// This appears when the shell echoes the command, and can appear as garbage on replay
const MINION_CMD_SCRIPT = /bash\s+[^\s]*\.minion-cmd\.sh/g

export function filterTerminalQueryResponses(data: string): string {
  if (!data) return data

  return data
    .replace(DA1_RESPONSE, '')
    .replace(DA2_RESPONSE, '')
    .replace(OSC_COLOR_RESPONSE, '')
    .replace(ORPHANED_DA1_RESPONSE, '')
    .replace(ORPHANED_DA2_RESPONSE, '')
    .replace(MINION_CMD_SCRIPT, '')
}
