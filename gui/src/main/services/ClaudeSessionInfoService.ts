import { readFileSync, existsSync, watch, FSWatcher } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * ClaudeSessionInfoService - Reads Claude's session JSONL files to extract
 * authoritative session information including model, cost, tokens, and state.
 *
 * This replaces pattern-based detection with direct reading of Claude's
 * internal session state.
 */

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface ModelHistoryEntry {
  model: string
  timestamp: string
}

export interface ClaudeSessionInfo {
  sessionId: string
  actualModel: string           // Full model name like "claude-haiku-4-5-20251001"
  requestedModel?: string       // Alias like "haiku" (if known)
  claudeCodeVersion?: string
  totalCostUsd?: number
  tokenUsage?: TokenUsage
  lastUpdated: string
  modelHistory: ModelHistoryEntry[]
  state: 'working' | 'waiting' | 'unknown'
}

interface SessionJSONLEntry {
  type: 'user' | 'assistant' | 'file-history-snapshot'
  sessionId?: string
  version?: string
  timestamp?: string
  message?: {
    model?: string
    role?: string
    content?: Array<{ type: string; [key: string]: any }>
    stop_reason?: string | null
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
    }
  }
  toolUseResult?: {
    status?: string
  }
}

export class ClaudeSessionInfoService {
  private claudeProjectsDir: string
  private watchers: Map<string, FSWatcher> = new Map()
  private cache: Map<string, { info: ClaudeSessionInfo; mtime: number }> = new Map()
  private callbacks: Map<string, (info: ClaudeSessionInfo) => void> = new Map()

  constructor() {
    // Claude stores projects in ~/.claude/projects/
    this.claudeProjectsDir = join(homedir(), '.claude', 'projects')
  }

  /**
   * Convert a worktree path to the Claude projects directory hash format.
   * Claude uses: -Users-username-code-project-name (replacing / with -)
   * Note: Claude KEEPS the leading dash from the path conversion
   */
  getClaudeProjectHash(worktreePath: string): string {
    // Replace all path separators with dashes (keeps leading dash)
    return worktreePath.replace(/\//g, '-')
  }

  /**
   * Find the full path to a Claude project directory.
   */
  getClaudeProjectPath(worktreePath: string): string | null {
    const hash = this.getClaudeProjectHash(worktreePath)
    const projectPath = join(this.claudeProjectsDir, hash)

    if (existsSync(projectPath)) {
      return projectPath
    }

    // Check if we need to normalize underscores to dashes (Claude converts them)
    if (hash.includes('_')) {
      const normalizedHash = hash.replace(/_/g, '-')
      const normalizedPath = join(this.claudeProjectsDir, normalizedHash)
      if (existsSync(normalizedPath)) {
        return normalizedPath
      }
    }

    return null
  }

  /**
   * Find the session JSONL file for a given session ID.
   */
  findSessionFile(sessionId: string, worktreePath: string): string | null {
    const projectPath = this.getClaudeProjectPath(worktreePath)
    if (!projectPath) return null

    const sessionFile = join(projectPath, `${sessionId}.jsonl`)
    if (existsSync(sessionFile)) {
      return sessionFile
    }

    return null
  }

  /**
   * Read the last N bytes of a file (tail-based reading for efficiency).
   */
  private readFileTail(filePath: string, bytes: number = 50000): string {
    try {
      const content = readFileSync(filePath, 'utf-8')
      // Return last N characters (approximating bytes for UTF-8)
      return content.slice(-bytes)
    } catch {
      return ''
    }
  }

  /**
   * Parse a session JSONL file and extract session info.
   * Uses tail-based reading for efficiency on large files.
   */
  parseSessionInfo(sessionId: string, worktreePath: string): ClaudeSessionInfo | null {
    const sessionFile = this.findSessionFile(sessionId, worktreePath)
    if (!sessionFile) return null

    try {
      // Read the whole file for now - can optimize to tail later if needed
      const content = readFileSync(sessionFile, 'utf-8')
      const lines = content.trim().split('\n')

      let actualModel = ''
      let claudeCodeVersion = ''
      let totalCostUsd = 0
      const tokenUsage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      }
      const modelHistory: ModelHistoryEntry[] = []
      let lastModel = ''
      let state: 'working' | 'waiting' | 'unknown' = 'unknown'
      let lastTimestamp = ''
      let lastEntry: SessionJSONLEntry | null = null

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const entry = JSON.parse(line) as SessionJSONLEntry

          // Track last meaningful entry for state detection (skip queue-operation, etc.)
          if (entry.type === 'assistant' || entry.type === 'user') {
            lastEntry = entry
          }

          // Extract timestamp
          if (entry.timestamp) {
            lastTimestamp = entry.timestamp
          }

          // Extract version
          if (entry.version && !claudeCodeVersion) {
            claudeCodeVersion = entry.version
          }

          // Process assistant messages for model and usage
          if (entry.type === 'assistant' && entry.message) {
            const msg = entry.message

            // Track model changes
            if (msg.model && msg.model !== lastModel) {
              if (lastModel) {
                // Record model change
                modelHistory.push({
                  model: msg.model,
                  timestamp: entry.timestamp || new Date().toISOString()
                })
              }
              lastModel = msg.model
              actualModel = msg.model
            }

            // Aggregate token usage
            if (msg.usage) {
              tokenUsage.inputTokens += msg.usage.input_tokens || 0
              tokenUsage.outputTokens += msg.usage.output_tokens || 0
              tokenUsage.cacheReadTokens += msg.usage.cache_read_input_tokens || 0
              tokenUsage.cacheCreationTokens += msg.usage.cache_creation_input_tokens || 0
            }
          }

        } catch (parseError) {
          // Skip malformed lines
          continue
        }
      }

      // Determine state from the LAST entry only (not all entries)
      if (lastEntry) {
        if (lastEntry.type === 'assistant' && lastEntry.message) {
          const msg = lastEntry.message

          // If assistant finished with end_turn, it's waiting for user input
          if (msg.stop_reason === 'end_turn') {
            state = 'waiting'
          } else if (msg.content && Array.isArray(msg.content)) {
            // If assistant has tool_use, it's working (waiting for tool results)
            const hasToolUse = msg.content.some(c => c.type === 'tool_use')
            if (hasToolUse) {
              state = 'working'
            } else {
              // Assistant message with no tool_use and no end_turn (e.g., interrupted)
              // Default to waiting since there's no pending action
              state = 'waiting'
            }
          } else {
            // Assistant message with non-array content or no content
            // Likely interrupted or incomplete - default to waiting
            state = 'waiting'
          }
        } else if (lastEntry.type === 'user') {
          // If last entry is user message, Claude is working on processing it
          state = 'working'
        }
      }

      // Estimate cost based on token usage (rough estimate)
      // Using approximate pricing: $0.003 per 1K input, $0.015 per 1K output for Haiku
      // This is a rough estimate - actual pricing varies by model
      const inputCost = (tokenUsage.inputTokens / 1000) * 0.003
      const outputCost = (tokenUsage.outputTokens / 1000) * 0.015
      totalCostUsd = inputCost + outputCost

      // Debug state detection
      if (process.env.NODE_ENV === 'development') {
        console.log('[ClaudeSessionInfoService] Parsed session state:', state, {
          lastLine: lines[lines.length - 1]?.substring(0, 100),
          linesCount: lines.length
        })
      }

      return {
        sessionId,
        actualModel,
        claudeCodeVersion,
        totalCostUsd,
        tokenUsage,
        lastUpdated: lastTimestamp || new Date().toISOString(),
        modelHistory,
        state
      }
    } catch (error) {
      console.error(`Failed to parse session file ${sessionFile}:`, error)
      return null
    }
  }

  /**
   * Get session state from the JSONL file.
   * This is a lighter-weight operation that only reads the last few entries.
   */
  getSessionState(sessionId: string, worktreePath: string): 'working' | 'waiting' | 'unknown' {
    const sessionFile = this.findSessionFile(sessionId, worktreePath)
    if (!sessionFile) return 'unknown'

    try {
      // Read last ~10KB which should contain recent entries
      const tail = this.readFileTail(sessionFile, 10000)
      const lines = tail.split('\n').filter(l => l.trim())

      // Process lines from end to find latest state
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]) as SessionJSONLEntry

          if (entry.type === 'assistant' && entry.message) {
            const msg = entry.message
            if (msg.content && Array.isArray(msg.content)) {
              const hasToolUse = msg.content.some(c => c.type === 'tool_use')
              if (hasToolUse) {
                return 'working'
              } else if (msg.stop_reason) {
                return 'waiting'
              }
            }
          }

          if (entry.type === 'user') {
            return 'working'
          }

        } catch {
          continue
        }
      }

      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * Start watching a session file for changes.
   * Calls the callback whenever the session info updates.
   */
  watchSession(
    sessionId: string,
    worktreePath: string,
    callback: (info: ClaudeSessionInfo) => void
  ): void {
    const sessionFile = this.findSessionFile(sessionId, worktreePath)
    if (!sessionFile) return

    // Store callback
    this.callbacks.set(sessionId, callback)

    // Don't create duplicate watchers
    if (this.watchers.has(sessionId)) return

    try {
      const watcher = watch(sessionFile, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          // Debounce: only process if file was modified recently
          const info = this.parseSessionInfo(sessionId, worktreePath)
          if (info) {
            const cb = this.callbacks.get(sessionId)
            if (cb) cb(info)
          }
        }
      })

      this.watchers.set(sessionId, watcher)
    } catch (error) {
      console.error(`Failed to watch session ${sessionId}:`, error)
    }
  }

  /**
   * Stop watching a session file.
   */
  unwatchSession(sessionId: string): void {
    const watcher = this.watchers.get(sessionId)
    if (watcher) {
      watcher.close()
      this.watchers.delete(sessionId)
    }
    this.callbacks.delete(sessionId)
  }

  /**
   * Clean up all watchers.
   */
  dispose(): void {
    for (const [sessionId] of this.watchers) {
      this.unwatchSession(sessionId)
    }
  }

  /**
   * Format model name for display (remove timestamp suffix).
   * e.g., "claude-haiku-4-5-20251001" → "claude-haiku-4-5"
   */
  static formatModelName(model: string): string {
    // Remove date suffix like -20251001
    return model.replace(/-\d{8}$/, '')
  }

  /**
   * Format token count for display.
   * e.g., 1234 → "1.2K", 12345 → "12.3K"
   */
  static formatTokenCount(tokens: number): string {
    if (tokens < 1000) return tokens.toString()
    return `${(tokens / 1000).toFixed(1)}K`
  }

  /**
   * Format cost for display.
   * e.g., 0.0124 → "$0.01"
   */
  static formatCost(cost: number): string {
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
  }
}
