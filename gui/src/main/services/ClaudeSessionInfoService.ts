import { readFileSync, existsSync, watch, FSWatcher, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'

const log = createLogger('ClaudeSessionInfoService')

/**
 * ClaudeSessionInfoService - Reads Claude's session JSONL files to extract
 * authoritative session information including model, cost, tokens, and state.
 *
 * This replaces pattern-based detection with direct reading of Claude's
 * internal session state.
 */

/**
 * Claude API stop_reason values
 * These indicate why Claude stopped generating (finished turn, tool use, etc.)
 * @see https://docs.anthropic.com/en/api/messages
 */
export const CLAUDE_STOP_REASONS = {
  /** Claude finished its turn and is ready for user input */
  END_TURN: 'end_turn',

  /** Claude wants to use a tool (waiting for tool results, NOT user input) */
  TOOL_USE: 'tool_use',

  /** Claude hit a stop sequence */
  STOP_SEQUENCE: 'stop_sequence',

  /** Maximum tokens reached */
  MAX_TOKENS: 'max_tokens',
} as const

type ClaudeStopReason = typeof CLAUDE_STOP_REASONS[keyof typeof CLAUDE_STOP_REASONS] | null

/**
 * Tools that wait for HUMAN input (not automatic tool results)
 * When these tools are used, Claude is waiting for the user to respond,
 * not waiting for tool execution to complete.
 */
const HUMAN_INPUT_TOOLS = ['ExitPlanMode', 'AskUserQuestion'] as const

/** Git refs prefix that needs to be stripped from branch names */
const REFS_HEADS_PREFIX = 'refs/heads/'

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

/**
 * Represents a Task tool invocation by Claude (subagent spawning).
 * Parsed from JSONL to track running and completed subagent tasks.
 */
export interface TaskInvocation {
  toolUseId: string
  description: string
  subagentType: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  resultSummary?: string
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
  taskInvocations: TaskInvocation[]  // Task tool subagent invocations
}

interface SessionJSONLEntry {
  type: 'user' | 'assistant' | 'file-history-snapshot'
  sessionId?: string
  version?: string
  timestamp?: string
  message?: {
    model?: string
    role?: string
    content?: string | Array<{ type: string; [key: string]: any }>
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

  // Track which sessions we've already logged "not found" for to avoid spam
  private loggedNotFound: Set<string> = new Set()

  /**
   * Find the session JSONL file for a given session ID.
   * Only logs "not found" once per session to avoid log spam during polling.
   *
   * For teleported sessions: Falls back to finding any JSONL file in the directory
   * since Claude CLI creates UUID filenames instead of using the session ID.
   */
  findSessionFile(sessionId: string, worktreePath: string): string | null {
    const projectPath = this.getClaudeProjectPath(worktreePath)
    if (!projectPath) {
      // Only log once per session
      if (!this.loggedNotFound.has(sessionId)) {
        log.warn(` Claude project directory not found for: ${worktreePath}`)
        this.loggedNotFound.add(sessionId)
      }
      return null
    }

    // Try exact filename first (works for non-teleport sessions)
    const exactFile = join(projectPath, `${sessionId}.jsonl`)
    if (existsSync(exactFile)) {
      this.loggedNotFound.delete(sessionId)
      return exactFile
    }

    // Fallback: scan directory for any JSONL file (for teleported sessions)
    // Teleported sessions create UUID filenames, not session_xxx.jsonl
    try {
      const files = readdirSync(projectPath)
      const jsonlFiles = files
        .filter(f => f.endsWith('.jsonl') && statSync(join(projectPath, f)).size > 0)
        .map(f => ({
          path: join(projectPath, f),
          mtime: statSync(join(projectPath, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime) // Most recent first

      if (jsonlFiles.length > 0) {
        this.loggedNotFound.delete(sessionId)
        return jsonlFiles[0].path
      }
    } catch {
      // Directory read failed
    }

    // Only log once per session to avoid spam during polling
    if (!this.loggedNotFound.has(sessionId)) {
      log.warn(` Session file not found: ${exactFile}`)
      this.loggedNotFound.add(sessionId)
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
   * Check if a session entry is a slash command (should be skipped for state detection).
   * Slash commands are not real user input and should not trigger "waiting for input" state.
   *
   * Detection criteria:
   * - <command-name> tags (e.g., /model, /commit)
   * - <local-command-stdout> tags (command output)
   * - <local-command-result> tags (command results)
   * - isMeta: true flag (meta messages)
   */
  private isSlashCommandEntry(entry: SessionJSONLEntry): boolean {
    if (entry.type !== 'user' || !entry.message) {
      return false
    }

    const content = entry.message.content

    // Check for command-related XML tags in string content
    if (typeof content === 'string') {
      const hasCommandTag = content.includes('<command-name>') ||
        content.includes('<local-command-stdout>') ||
        content.includes('<local-command-result>')
      if (hasCommandTag) {
        return true
      }
    }

    // Check for isMeta flag (can be on entry or message)
    const entryIsMeta = (entry as any).isMeta === true
    const messageIsMeta = (entry.message as any).isMeta === true

    if (entryIsMeta || messageIsMeta) {
      return true
    }

    return false
  }

  /**
   * Parse a session JSONL file and extract session info.
   * Uses smart caching to avoid re-parsing unchanged files.
   */
  parseSessionInfo(sessionId: string, worktreePath: string): ClaudeSessionInfo | null {
    const sessionFile = this.findSessionFile(sessionId, worktreePath)
    if (!sessionFile) {
      return null
    }

    try {
      // Check cache first - avoid re-parsing if file hasn't changed
      const stat = statSync(sessionFile)
      const mtime = stat.mtimeMs

      const cached = this.cache.get(sessionId)
      if (cached && cached.mtime === mtime) {
        // File hasn't changed, return cached info
        return cached.info
      }

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

      // Track Task tool invocations
      const taskInvocationsMap = new Map<string, TaskInvocation>()

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const entry = JSON.parse(line) as SessionJSONLEntry

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

            // Track Task tool invocations (excluding Bash which is just a tool call, not an LLM subagent)
            if (Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_use' && block.name === 'Task') {
                  const input = block.input || {}
                  const subagentType = input.subagent_type || 'general-purpose'

                  // Skip Bash - it's a tool call, not an LLM subagent
                  if (subagentType === 'Bash') {
                    continue
                  }

                  taskInvocationsMap.set(block.id, {
                    toolUseId: block.id,
                    description: input.description || '',
                    subagentType,
                    prompt: input.prompt || '',
                    status: 'running',
                    startedAt: entry.timestamp || new Date().toISOString()
                  })
                }
              }
            }
          }

          // Process user messages for tool_result (Task completion)
          if (entry.type === 'user' && entry.message) {
            const content = entry.message.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result' && block.tool_use_id) {
                  const task = taskInvocationsMap.get(block.tool_use_id)
                  if (task) {
                    // Check if it's an error result
                    const isError = block.is_error === true
                    task.status = isError ? 'failed' : 'completed'
                    task.completedAt = entry.timestamp || new Date().toISOString()
                    // Extract result summary (first 500 chars)
                    if (typeof block.content === 'string') {
                      task.resultSummary = block.content.slice(0, 500)
                    }
                  }
                }
              }
            }
          }

        } catch (parseError) {
          // Skip malformed lines
          continue
        }
      }

      // Determine state from the LAST REAL entry (skip slash commands)
      //
      // ACCEPTANCE CRITERIA: Only show "waiting" when Claude is expecting human input
      //
      // 3-state logic:
      // - waiting: Claude FINISHED turn and is ready for human input
      // - working: Claude is processing, using tools, or waiting for tool results
      // - unknown: any other case (safe default)

      // Scan backwards to find last REAL conversation entry (skip slash commands)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]) as SessionJSONLEntry

          // Skip non-conversation entries
          if (entry.type !== 'user' && entry.type !== 'assistant') {
            continue
          }

          // Skip slash command entries (not real user input)
          if (entry.type === 'user' && entry.message) {
            const isSlashCommand = this.isSlashCommandEntry(entry)

            if (isSlashCommand) {
              continue // Skip this, look for earlier entry
            }

            // Real user message/tool_result = Claude is processing
            state = 'working'
            break
          }

          if (entry.type === 'assistant' && entry.message) {
            const message = entry.message
            const content = message.content
            const stopReason = message.stop_reason as ClaudeStopReason

            if (Array.isArray(content)) {
              const hasToolUse = content.some(c => c.type === 'tool_use')
              const hasThinking = content.some(c => c.type === 'thinking')
              const hasText = content.some(c => c.type === 'text')

              // Check for tools that wait for HUMAN input (not automatic tool results)
              const humanInputTool = content.find(c =>
                c.type === 'tool_use' && HUMAN_INPUT_TOOLS.includes(c.name as any)
              )

              // CRITICAL: Some tools like ExitPlanMode and AskUserQuestion are waiting
              // for HUMAN input, not tool execution. Detect these first.
              if (humanInputTool) {
                // Waiting for human to approve plan or answer question
                state = 'waiting'

              } else if (stopReason === CLAUDE_STOP_REASONS.END_TURN) {
                // Claude explicitly finished its turn - ready for human input
                // NOTE: This only appears in sidechain agents, not main sessions
                state = 'waiting'

              } else if (stopReason === CLAUDE_STOP_REASONS.TOOL_USE || hasToolUse) {
                // Claude wants to use tools - waiting for TOOL results, not human
                state = 'working'

              } else if (hasThinking) {
                // Claude in extended thinking mode
                state = 'working'

              } else if (hasText && !hasToolUse && !hasThinking) {
                // Text-only message: Need to distinguish mid-work status updates from completion messages
                // Extract text content to check for colon heuristic
                const textContent = content.find(c => c.type === 'text')?.text || ''
                const trimmedText = textContent.trim()

                // CRITICAL: Check for running Task subagents BEFORE applying colon heuristic
                // Super minions may send text-only messages between Task invocations
                // that don't end with colon, but they're still working if tasks are running
                const hasRunningTasks = Array.from(taskInvocationsMap.values())
                  .some(task => task.status === 'running')

                if (hasRunningTasks) {
                  // Super minion still has running Task subagents - definitely working
                  state = 'working'
                } else if (trimmedText.endsWith(':')) {
                  // Messages ending with colon are ALWAYS status updates (100% accurate)
                  // e.g., "Let me search for that:", "Now I'll read the file:"
                  // These indicate more work is coming (tool_use follows)
                  state = 'working'
                } else {
                  // Text not ending with colon AND no running tasks - likely a completion message
                  // e.g., "Perfect! All bugs are fixed. Let me know if you need anything else."
                  state = 'waiting'
                }

              } else {
                // Any other case (streaming, unknown format, etc.)
                state = 'working'
              }
            } else {
              // No content array = unknown (unexpected format)
              state = 'unknown'
            }
            break
          }
        } catch {
          continue
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
        log.debug(' Parsed session state:', state, {
          lastLine: lines[lines.length - 1]?.substring(0, 100),
          linesCount: lines.length
        })
      }

      const taskInvocations = Array.from(taskInvocationsMap.values())

      const info: ClaudeSessionInfo = {
        sessionId,
        actualModel,
        claudeCodeVersion,
        totalCostUsd,
        tokenUsage,
        lastUpdated: lastTimestamp || new Date().toISOString(),
        modelHistory,
        state,
        taskInvocations
      }

      // Cache the result for future calls
      this.cache.set(sessionId, { info, mtime })

      return info
    } catch (error) {
      log.error(`Failed to parse session file ${sessionFile}`, error)
      return null
    }
  }

  /**
   * Get session state from the JSONL file with smart caching.
   * This is a lighter-weight operation that only reads the last few entries.
   *
   * LIMITATION: This method does NOT track Task tool invocations because it only
   * reads the tail of the file for performance. For super minions with running
   * Task subagents, use parseSessionInfo() which properly tracks running tasks
   * and avoids false "waiting" states between Task invocations.
   *
   * This is generally safe because:
   * 1. The caching mechanism means if parseSessionInfo() was called first (which
   *    it is during normal polling), this method returns the cached state.
   * 2. The main notification flow uses parseSessionInfo() which has the fix.
   */
  getSessionState(sessionId: string, worktreePath: string): 'working' | 'waiting' | 'unknown' {
    const sessionFile = this.findSessionFile(sessionId, worktreePath)
    if (!sessionFile) {
      return 'unknown'
    }

    try {
      // Check cache first - avoid reading file if it hasn't changed
      const stat = statSync(sessionFile)
      const mtime = stat.mtimeMs

      const cached = this.cache.get(sessionId)
      if (cached && cached.mtime === mtime) {
        // File hasn't changed, return cached state
        return cached.info.state
      }

      // Read last ~10KB which should contain recent entries
      const tail = this.readFileTail(sessionFile, 10000)
      const lines = tail.split('\n').filter(l => l.trim())

      // Process lines from end to find latest state
      // Same 3-state logic as parseSessionInfo (check stop_reason):
      // - waiting: Claude FINISHED turn and is ready for human input
      // - working: Claude is processing, using tools, or waiting for tool results
      // - unknown: any other case (safe default)
      let state: 'working' | 'waiting' | 'unknown' = 'unknown'

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]) as SessionJSONLEntry

          // Skip non-conversation entries (summary, file-history-snapshot, etc.)
          if (entry.type !== 'user' && entry.type !== 'assistant') {
            continue
          }

          // Skip slash command entries (not real user input)
          if (entry.type === 'user' && entry.message) {
            const isSlashCommand = this.isSlashCommandEntry(entry)

            if (isSlashCommand) {
              continue // Skip this, look for earlier entry
            }

            // Real user message/tool_result = Claude is processing
            state = 'working'
            break
          }

          if (entry.type === 'assistant' && entry.message) {
            const message = entry.message
            const content = message.content
            const stopReason = message.stop_reason as ClaudeStopReason

            if (Array.isArray(content)) {
              const hasToolUse = content.some(c => c.type === 'tool_use')
              const hasThinking = content.some(c => c.type === 'thinking')
              const hasText = content.some(c => c.type === 'text')

              // Check for tools that wait for HUMAN input (not automatic tool results)
              const humanInputTool = content.find(c =>
                c.type === 'tool_use' && HUMAN_INPUT_TOOLS.includes(c.name as any)
              )

              // CRITICAL: Some tools like ExitPlanMode and AskUserQuestion are waiting
              // for HUMAN input, not tool execution. Detect these first.
              if (humanInputTool) {
                // Waiting for human to approve plan or answer question
                state = 'waiting'

              } else if (stopReason === CLAUDE_STOP_REASONS.END_TURN) {
                // Claude explicitly finished its turn - ready for human input
                // NOTE: This only appears in sidechain agents, not main sessions
                state = 'waiting'

              } else if (stopReason === CLAUDE_STOP_REASONS.TOOL_USE || hasToolUse) {
                // Claude wants to use tools - waiting for TOOL results, not human
                state = 'working'

              } else if (hasThinking) {
                // Claude in extended thinking mode
                state = 'working'

              } else if (hasText && !hasToolUse && !hasThinking) {
                // Text-only message: Need to distinguish mid-work status updates from completion messages
                // Extract text content to check for colon heuristic
                const textContent = content.find(c => c.type === 'text')?.text || ''
                const trimmedText = textContent.trim()

                if (trimmedText.endsWith(':')) {
                  // Messages ending with colon are ALWAYS status updates (100% accurate)
                  // e.g., "Let me search for that:", "Now I'll read the file:"
                  // These indicate more work is coming (tool_use follows)
                  state = 'working'
                } else {
                  // Text not ending with colon - likely a completion message
                  // e.g., "Perfect! All bugs are fixed. Let me know if you need anything else."
                  state = 'waiting'
                }

              } else {
                // Any other case (streaming, unknown format, etc.)
                state = 'working'
              }
            } else {
              // No content array = unknown (unexpected format)
              state = 'unknown'
            }
            break
          }

        } catch {
          continue
        }
      }


      // Update cache with just the state (lightweight)
      if (cached) {
        cached.info.state = state
        cached.mtime = mtime
      }

      return state
    } catch (error) {
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
      log.error(`Failed to watch session ${sessionId}`, error)
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
   * Strip refs/heads/ prefix from git branch name if present.
   */
  private stripRefsHeadsPrefix(gitBranch: string): string {
    if (gitBranch.startsWith(REFS_HEADS_PREFIX)) {
      return gitBranch.substring(REFS_HEADS_PREFIX.length)
    }
    return gitBranch
  }

  /**
   * Extract gitBranch from a session's JSONL file.
   * Used for late detection of branch names (e.g., after teleport syncs).
   * Returns null if file doesn't exist, is empty, or has no gitBranch.
   */
  extractGitBranch(sessionId: string, worktreePath: string): string | null {
    const sessionFile = this.findSessionFile(sessionId, worktreePath)
    if (!sessionFile) {
      return null
    }

    try {
      const stat = statSync(sessionFile)
      if (stat.size === 0) {
        return null
      }

      const content = readFileSync(sessionFile, 'utf-8')

      for (const line of content.trim().split('\n')) {
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
    } catch {
      return null
    }

    return null
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
