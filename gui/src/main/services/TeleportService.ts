/**
 * TeleportService - Handles teleport session ID parsing and URL generation
 *
 * Teleport enables sharing Claude Code sessions via a session ID that can be
 * accessed through a web URL or CLI command.
 */

/**
 * Information about a teleport session, including the session ID and
 * various ways to access it.
 */
export interface TeleportInfo {
  /** The raw session ID (e.g., "session_01CVbxtiJWp387FoCSvAiS2B") */
  sessionId: string
  /** The web URL to access this session (e.g., "https://claude.ai/code/session_xxx") */
  url: string
  /** The CLI command to connect to this session (e.g., "claude --teleport session_xxx") */
  command: string
}

/** Base URL for Claude Code teleport sessions */
const TELEPORT_BASE_URL = 'https://claude.ai/code'

/** Regular expression pattern for valid session IDs */
const SESSION_ID_PATTERN = /^session_[A-Za-z0-9]+$/

/**
 * Regular expression to extract session ID from various input formats:
 * - Full URL: https://claude.ai/code/session_xxx
 * - Full command: claude --teleport session_xxx
 * - Raw session ID: session_xxx
 */
const SESSION_ID_EXTRACTION_PATTERN = /session_[A-Za-z0-9]+/

export class TeleportService {
  /**
   * Parse any input format and extract the session ID.
   *
   * Supports the following input formats:
   * - Full URL: `https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B`
   * - Full command: `claude --teleport session_01CVbxtiJWp387FoCSvAiS2B`
   * - Raw session ID: `session_01CVbxtiJWp387FoCSvAiS2B`
   *
   * @param input - The input string containing a session ID in any supported format
   * @returns The extracted session ID, or null if no valid session ID is found
   *
   * @example
   * ```typescript
   * const service = new TeleportService()
   *
   * // From URL
   * service.parseSessionId('https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B')
   * // => 'session_01CVbxtiJWp387FoCSvAiS2B'
   *
   * // From command
   * service.parseSessionId('claude --teleport session_01CVbxtiJWp387FoCSvAiS2B')
   * // => 'session_01CVbxtiJWp387FoCSvAiS2B'
   *
   * // Raw session ID
   * service.parseSessionId('session_01CVbxtiJWp387FoCSvAiS2B')
   * // => 'session_01CVbxtiJWp387FoCSvAiS2B'
   *
   * // Invalid input
   * service.parseSessionId('not a session')
   * // => null
   * ```
   */
  parseSessionId(input: string): string | null {
    if (!input || typeof input !== 'string') {
      return null
    }

    const trimmed = input.trim()
    if (!trimmed) {
      return null
    }

    const match = trimmed.match(SESSION_ID_EXTRACTION_PATTERN)
    if (!match) {
      return null
    }

    const sessionId = match[0]
    return this.isValidSessionId(sessionId) ? sessionId : null
  }

  /**
   * Validate that a session ID matches the expected format.
   *
   * A valid session ID starts with "session_" followed by alphanumeric characters.
   *
   * @param sessionId - The session ID to validate
   * @returns True if the session ID is valid, false otherwise
   *
   * @example
   * ```typescript
   * const service = new TeleportService()
   *
   * service.isValidSessionId('session_01CVbxtiJWp387FoCSvAiS2B')
   * // => true
   *
   * service.isValidSessionId('invalid_session')
   * // => false
   *
   * service.isValidSessionId('')
   * // => false
   * ```
   */
  isValidSessionId(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
      return false
    }

    return SESSION_ID_PATTERN.test(sessionId)
  }

  /**
   * Generate complete teleport info from a session ID.
   *
   * @param sessionId - A valid session ID
   * @returns TeleportInfo object containing the session ID, URL, and command
   * @throws Error if the session ID is invalid
   *
   * @example
   * ```typescript
   * const service = new TeleportService()
   * const info = service.getTeleportInfo('session_01CVbxtiJWp387FoCSvAiS2B')
   * // => {
   * //   sessionId: 'session_01CVbxtiJWp387FoCSvAiS2B',
   * //   url: 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B',
   * //   command: 'claude --teleport session_01CVbxtiJWp387FoCSvAiS2B'
   * // }
   * ```
   */
  getTeleportInfo(sessionId: string): TeleportInfo {
    if (!this.isValidSessionId(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`)
    }

    return {
      sessionId,
      url: this.getTeleportUrl(sessionId),
      command: this.getTeleportCommand(sessionId)
    }
  }

  /**
   * Generate the web URL for a teleport session.
   *
   * @param sessionId - A valid session ID
   * @returns The full URL to access the session (e.g., "https://claude.ai/code/session_xxx")
   * @throws Error if the session ID is invalid
   *
   * @example
   * ```typescript
   * const service = new TeleportService()
   * service.getTeleportUrl('session_01CVbxtiJWp387FoCSvAiS2B')
   * // => 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B'
   * ```
   */
  getTeleportUrl(sessionId: string): string {
    if (!this.isValidSessionId(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`)
    }

    return `${TELEPORT_BASE_URL}/${sessionId}`
  }

  /**
   * Generate the CLI command for connecting to a teleport session.
   *
   * @param sessionId - A valid session ID
   * @returns The CLI command (e.g., "claude --teleport session_xxx")
   * @throws Error if the session ID is invalid
   *
   * @example
   * ```typescript
   * const service = new TeleportService()
   * service.getTeleportCommand('session_01CVbxtiJWp387FoCSvAiS2B')
   * // => 'claude --teleport session_01CVbxtiJWp387FoCSvAiS2B'
   * ```
   */
  getTeleportCommand(sessionId: string): string {
    if (!this.isValidSessionId(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`)
    }

    return `claude --teleport ${sessionId}`
  }

  /**
   * Suggest a project path for a teleport session based on available projects.
   *
   * This method is intended for future use when we can parse additional metadata
   * from the session (like cwd from session metadata) to better match projects.
   *
   * Currently, it returns the first available project as the default suggestion.
   *
   * @param sessionId - A valid session ID
   * @param availableProjects - List of available project paths to choose from
   * @returns The suggested project path, or null if no projects are available
   *
   * @example
   * ```typescript
   * const service = new TeleportService()
   * const projects = ['/Users/dev/project-a', '/Users/dev/project-b']
   *
   * service.suggestProjectPath('session_01CVbxtiJWp387FoCSvAiS2B', projects)
   * // => '/Users/dev/project-a' (first project as default)
   *
   * service.suggestProjectPath('session_xxx', [])
   * // => null (no projects available)
   * ```
   */
  suggestProjectPath(sessionId: string, availableProjects: string[]): string | null {
    // Validate session ID
    if (!this.isValidSessionId(sessionId)) {
      return null
    }

    // Return null if no projects available
    if (!availableProjects || availableProjects.length === 0) {
      return null
    }

    // TODO: In the future, we could:
    // 1. Parse session metadata to get the original cwd
    // 2. Match against available projects by path similarity
    // 3. Check if any project name matches part of the session context

    // For now, return the first available project as default
    return availableProjects[0]
  }
}
