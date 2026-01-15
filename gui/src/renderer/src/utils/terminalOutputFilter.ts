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

// DA1 Response: ESC [ ? Ps ; Ps ; ... c
const DA1_RESPONSE = /\x1b\[\?[\d;]*c/g

// DA2 Response: ESC [ > Ps ; Ps ; Ps c
const DA2_RESPONSE = /\x1b\[>[\d;]*c/g

// OSC 10/11/12 Color Responses: ESC ] 1x ; rgb:xxxx/xxxx/xxxx ST
// ST (String Terminator) can be ESC \ or BEL (\x07)
const OSC_COLOR_RESPONSE = /\x1b\]1[012];rgb:[0-9a-fA-F/]+(?:\x1b\\|\x07)/g

export function filterTerminalQueryResponses(data: string): string {
  if (!data) return data

  return data
    .replace(DA1_RESPONSE, '')
    .replace(DA2_RESPONSE, '')
    .replace(OSC_COLOR_RESPONSE, '')
}
