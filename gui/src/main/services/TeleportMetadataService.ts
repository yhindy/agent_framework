import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'

const log = createLogger('TeleportMetadataService')
const REFS_HEADS_PREFIX = 'refs/heads/'
const POLL_INTERVAL_MS = 1000
const DEFAULT_MAX_WAIT_SECONDS = 10

/**
 * TeleportMetadataService - Extracts branch name from teleported cloud sessions
 * by reading Claude's JSONL session files that sync after teleport starts.
 *
 * NOTE: When teleporting, Claude CLI creates a NEW local session with a UUID,
 * not using the cloud session_xxx ID. So we find JSONL files by scanning the
 * project directory, not by looking for a specific filename.
 */
export class TeleportMetadataService {
  private claudeProjectsDir: string

  constructor() {
    this.claudeProjectsDir = join(homedir(), '.claude', 'projects')
  }

  /**
   * Convert a worktree path to the Claude projects directory hash format.
   * Claude uses: -Users-username-code-project-name (replacing / with -)
   */
  private getClaudeProjectHash(worktreePath: string): string {
    return worktreePath.replace(/\//g, '-')
  }

  /**
   * Find the full path to a Claude project directory for a given worktree.
   * Claude normalizes underscores to dashes in directory names.
   */
  private getClaudeProjectPath(worktreePath: string): string | null {
    const hash = this.getClaudeProjectHash(worktreePath)
    const projectPath = join(this.claudeProjectsDir, hash)

    if (existsSync(projectPath)) {
      return projectPath
    }

    // Try normalized path (Claude converts underscores to dashes)
    if (!hash.includes('_')) {
      return null
    }

    const normalizedHash = hash.replace(/_/g, '-')
    const normalizedPath = join(this.claudeProjectsDir, normalizedHash)
    return existsSync(normalizedPath) ? normalizedPath : null
  }

  /**
   * Find any JSONL file in the Claude project directory.
   * When teleporting, Claude creates a new local session with a UUID filename,
   * not the cloud session_xxx ID. So we find the most recent JSONL file.
   */
  private findAnySessionFile(worktreePath: string): string | null {
    const projectPath = this.getClaudeProjectPath(worktreePath)
    if (!projectPath) {
      return null
    }

    try {
      const files = readdirSync(projectPath)
      const jsonlFiles = files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          path: join(projectPath, f),
          mtime: statSync(join(projectPath, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime) // Most recent first

      return jsonlFiles.length > 0 ? jsonlFiles[0].path : null
    } catch {
      return null
    }
  }

  /**
   * Check if a session file has content (non-empty).
   */
  private hasFileContent(filePath: string): boolean {
    try {
      return statSync(filePath).size > 0
    } catch {
      return false
    }
  }

  /**
   * Wait for any JSONL file to appear in the project directory.
   * Polls every second for up to maxWaitSeconds.
   */
  private async waitForSessionFile(
    worktreePath: string,
    maxWaitSeconds: number = DEFAULT_MAX_WAIT_SECONDS
  ): Promise<string | null> {
    const projectPath = this.getClaudeProjectPath(worktreePath)
    log.debug(` Looking in Claude project dir: ${projectPath || 'NOT FOUND'}`)

    let lastFoundFile: string | null = null

    for (let attempt = 0; attempt < maxWaitSeconds; attempt++) {
      const sessionFile = this.findAnySessionFile(worktreePath)

      if (sessionFile && this.hasFileContent(sessionFile)) {
        log.debug(` Session file found after ${attempt}s: ${sessionFile}`)
        return sessionFile
      }

      // Log progress every 3 seconds to reduce noise
      const shouldLog = attempt > 0 && attempt % 3 === 0
      if (shouldLog) {
        if (sessionFile) {
          log.debug(` Found file but empty (0 bytes): ${sessionFile}`)
        } else {
          log.debug(` Waiting for session file... (${attempt}s/${maxWaitSeconds}s)`)
        }
      }

      lastFoundFile = sessionFile
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    // Log final outcome
    if (lastFoundFile) {
      log.warn(` JSONL file exists but is empty - Claude CLI may not sync session history for teleported sessions`)
    } else {
      log.warn(` No JSONL file found after ${maxWaitSeconds}s`)
    }
    return null
  }

  /**
   * Strip refs/heads/ prefix from git branch name if present.
   */
  private stripRefsHeadsPrefix(gitBranch: string): string {
    return gitBranch.startsWith(REFS_HEADS_PREFIX)
      ? gitBranch.substring(REFS_HEADS_PREFIX.length)
      : gitBranch
  }

  /**
   * Parse JSONL content and find the first gitBranch field.
   */
  private findGitBranchInJsonl(content: string): string | null {
    const lines = content.trim().split('\n')

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const entry = JSON.parse(line)
        if (entry.gitBranch && typeof entry.gitBranch === 'string') {
          return this.stripRefsHeadsPrefix(entry.gitBranch)
        }
      } catch {
        // Skip malformed JSON lines
      }
    }

    return null
  }

  /**
   * Extract branch name from a teleported session's JSONL metadata.
   *
   * NOTE: The sessionId parameter is kept for API compatibility but not used
   * for file lookup. When teleporting, Claude creates a new local session with
   * a UUID, so we find the JSONL file by scanning the project directory.
   *
   * @param sessionId - Cloud session ID (for logging only)
   * @param worktreePath - Path to the agent's worktree
   * @returns Detected branch name or null if unavailable
   */
  async extractBranchFromTeleportedSession(
    _sessionId: string, // Kept for API compatibility, not used for lookup
    worktreePath: string
  ): Promise<string | null> {
    log.debug(` Extracting branch for teleported session (worktree: ${worktreePath})`)

    try {
      const sessionFile = await this.waitForSessionFile(worktreePath)
      if (!sessionFile) {
        return null
      }

      const content = readFileSync(sessionFile, 'utf-8')
      const branchName = this.findGitBranchInJsonl(content)

      if (branchName) {
        log.debug(` Detected branch: ${branchName}`)
      } else {
        log.debug(` No gitBranch field found in JSONL`)
      }

      return branchName
    } catch (error) {
      log.error(` Failed to extract branch:`, error)
      return null
    }
  }
}
