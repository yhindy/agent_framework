import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import * as readline from 'readline'
import { v5 as uuidv5 } from 'uuid'
import { createLogger } from './logger'
import { NotificationService } from './NotificationService'
import { SettingsService } from './SettingsService'
import {
  ClaudeJsonMessage,
  ClaudeAgentState,
  ClaudeWaitingReason,
  ConversationItem,
  ClaudeAssistantMessage,
  ClaudeUserMessage,
  ClaudeSystemMessage,
  ClaudeResultMessage,
  ClaudeStreamEvent,
  SessionStats,
  StreamingChunk,
  isWaitingTool,
  JsonClaudeStartOptions
} from '../../shared/types/claudeJson'

// Re-export for convenience
export type { JsonClaudeStartOptions }

const log = createLogger('JsonClaudeService')

// Memory limits
const DEFAULT_MAX_CONVERSATION_ITEMS = 500
const MAX_STREAMING_TEXT = 100_000 // 100KB
const MAX_TOOL_RESULT_SIZE = 50_000 // 50KB per tool result

/**
 * Session state for a JSON-mode Claude agent
 */
interface JsonClaudeSession {
  agentId: string
  process: ChildProcess
  sessionId?: string
  state: ClaudeAgentState
  conversation: ConversationItem[]
  currentStreamingText: string
  currentStreamingBlockIndex: number
  waitingReason?: ClaudeWaitingReason
  stats: SessionStats
  worktreePath: string
  projectPath: string
  displayName: string
  prompt: string
  model?: string
  mode?: string
  startedAt: Date
  maxConversationItems: number
}

/**
 * Service for managing Claude agents in JSON output mode.
 *
 * This service spawns Claude CLI with --output-format stream-json and parses
 * the NDJSON output to provide instant state detection and notifications.
 *
 * Benefits over terminal mode:
 * - Instant notifications (no 2s polling delay)
 * - Lower memory usage (no xterm.js buffers, no JSONL file parsing)
 * - Structured conversation data for rich UI rendering
 */
export class JsonClaudeService {
  private sessions: Map<string, JsonClaudeSession> = new Map()
  private mainWindow: BrowserWindow
  private notificationService?: NotificationService
  private settingsService?: SettingsService

  // Namespace UUID for agent sessions (same as TerminalService for consistency)
  private readonly AGENT_SESSION_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  setWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  setNotificationService(notificationService: NotificationService): void {
    this.notificationService = notificationService
  }

  setSettingsService(settingsService: SettingsService): void {
    this.settingsService = settingsService
  }

  /**
   * Start a Claude agent in JSON mode
   */
  async startAgent(options: JsonClaudeStartOptions): Promise<void> {
    const {
      agentId,
      worktreePath,
      projectPath,
      prompt,
      model,
      mode,
      yolo,
      chrome,
      sessionId,
      displayName
    } = options

    // Check if agent is already running
    if (this.sessions.has(agentId)) {
      log.warn(`Agent ${agentId} is already running in JSON mode`)
      return
    }

    log.info(`Starting JSON Claude agent: ${agentId}`, { worktreePath, model, mode })

    // Build command arguments
    const args = this.buildCommandArgs({
      agentId,
      worktreePath,
      prompt,
      model,
      mode,
      yolo,
      chrome,
      sessionId
    })

    log.debug(`Claude command args:`, args)

    // Spawn Claude process
    const proc = spawn('claude', args, {
      cwd: worktreePath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Get memory limit from settings
    const settings = this.settingsService?.getSettings()
    const maxItems = settings?.claudeUI?.maxConversationItems || DEFAULT_MAX_CONVERSATION_ITEMS

    // Create session
    const session: JsonClaudeSession = {
      agentId,
      process: proc,
      state: 'initializing',
      conversation: [],
      currentStreamingText: '',
      currentStreamingBlockIndex: -1,
      stats: {
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        numTurns: 0
      },
      worktreePath,
      projectPath,
      displayName,
      prompt,
      model,
      mode,
      startedAt: new Date(),
      maxConversationItems: maxItems
    }

    this.sessions.set(agentId, session)

    // Set up stdout parsing (NDJSON)
    this.setupStdoutParser(agentId, proc)

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      log.error(`Claude stderr for ${agentId}:`, text)
      this.safeSendIPC('claude:error', agentId, text)
    })

    // Handle process exit
    proc.on('exit', (code, signal) => {
      log.info(`Claude process exited for ${agentId}`, { code, signal })
      this.handleProcessExit(agentId, code, signal)
    })

    proc.on('error', (error) => {
      log.error(`Claude process error for ${agentId}:`, error)
      this.handleProcessError(agentId, error)
    })

    // Emit initial state (send directly since session was just created with this state)
    this.safeSendIPC('claude:stateChanged', agentId, 'initializing')
    this.safeSendIPC('claude:sessionStarted', agentId, {
      sessionId: session.sessionId,
      worktreePath,
      displayName
    })
  }

  /**
   * Build command line arguments for Claude CLI
   */
  private buildCommandArgs(options: {
    agentId: string
    worktreePath: string
    prompt: string
    model?: string
    mode?: string
    yolo?: boolean
    chrome?: boolean
    sessionId?: string
  }): string[] {
    const { agentId, worktreePath, prompt, model, mode, yolo, chrome, sessionId } = options

    const args = [
      '-p', // Print/headless mode (required for stream-json)
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--include-partial-messages' // Enable streaming text deltas
    ]

    // Session management
    if (sessionId) {
      args.push('--resume', sessionId)
    } else {
      // Generate deterministic session ID (same as TerminalService)
      const newSessionId = this.generateSessionId(agentId, worktreePath)
      args.push('--session-id', newSessionId)
    }

    // Model selection
    if (model) {
      args.push('--model', model)
    }

    // Permission mode
    if (mode === 'planning') {
      args.push('--permission-mode', 'plan')
    } else if (mode === 'dev') {
      args.push('--permission-mode', 'acceptEdits')
    }

    // YOLO mode (skip all permission prompts)
    if (yolo) {
      args.push('--dangerously-skip-permissions')
    }

    // Chrome/browser automation
    if (chrome) {
      args.push('--chrome')
    }

    // Add prompt at the end (for new sessions only)
    if (!sessionId) {
      args.push('--', prompt)
    }

    return args
  }

  /**
   * Set up readline to parse NDJSON from stdout
   */
  private setupStdoutParser(agentId: string, proc: ChildProcess): void {
    if (!proc.stdout) {
      log.error(`No stdout available for ${agentId}`)
      return
    }

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity
    })

    rl.on('line', (line: string) => {
      if (!line.trim()) return

      try {
        const message = JSON.parse(line) as ClaudeJsonMessage
        this.handleMessage(agentId, message)
      } catch (err) {
        log.warn(`Failed to parse JSON line for ${agentId}:`, line.slice(0, 200))
      }
    })

    rl.on('close', () => {
      log.debug(`Stdout stream closed for ${agentId}`)
    })
  }

  /**
   * Handle a parsed JSON message from Claude
   */
  private handleMessage(agentId: string, message: ClaudeJsonMessage): void {
    const session = this.sessions.get(agentId)
    if (!session) {
      log.warn(`Received message for unknown session: ${agentId}`)
      return
    }

    switch (message.type) {
      case 'system':
        this.handleSystemMessage(agentId, session, message)
        break

      case 'assistant':
        this.handleAssistantMessage(agentId, session, message)
        break

      case 'user':
        this.handleUserMessage(agentId, session, message)
        break

      case 'stream_event':
        this.handleStreamEvent(agentId, session, message)
        break

      case 'result':
        this.handleResultMessage(agentId, session, message)
        break

      default:
        log.debug(`Unknown message type for ${agentId}:`, (message as any).type)
    }
  }

  /**
   * Handle system message (session initialization)
   */
  private handleSystemMessage(
    agentId: string,
    session: JsonClaudeSession,
    message: ClaudeSystemMessage
  ): void {
    session.sessionId = message.session_id
    log.info(`Session initialized for ${agentId}: ${message.session_id}`)

    this.emitStateChange(agentId, 'working')
    this.safeSendIPC('claude:systemMessage', agentId, {
      sessionId: message.session_id,
      model: message.model,
      tools: message.tools
    })
  }

  /**
   * Handle assistant message (Claude's response)
   */
  private handleAssistantMessage(
    agentId: string,
    session: JsonClaudeSession,
    message: ClaudeAssistantMessage
  ): void {
    const content = message.message.content
    const stopReason = message.message.stop_reason

    // Clear streaming text (message is finalized)
    session.currentStreamingText = ''
    session.currentStreamingBlockIndex = -1

    // Process each content block
    for (const block of content) {
      if (block.type === 'text' && 'text' in block && block.text) {
        const item = this.createConversationItem(agentId, 'assistant_text', block.text)
        this.addConversationItem(session, item)
      }

      if (block.type === 'thinking' && 'thinking' in block && block.thinking) {
        const item = this.createConversationItem(agentId, 'thinking', block.thinking)
        this.addConversationItem(session, item)
      }

      if (block.type === 'tool_use' && 'name' in block && 'id' in block) {
        const item = this.createConversationItem(
          agentId,
          'tool_use',
          JSON.stringify(block.input, null, 2),
          {
            toolName: block.name,
            toolInput: block.input,
            toolUseId: block.id
          }
        )
        this.addConversationItem(session, item)

        // Check for tools that require user input
        if (isWaitingTool(block.name)) {
          session.waitingReason = this.createWaitingReason(block.name, block.input, block.id)
        }
      }
    }

    // Update token usage
    if (message.message.usage) {
      session.stats.inputTokens += message.message.usage.input_tokens || 0
      session.stats.outputTokens += message.message.usage.output_tokens || 0
      this.safeSendIPC('claude:usageUpdated', agentId, {
        ...message.message.usage,
        totalInputTokens: session.stats.inputTokens,
        totalOutputTokens: session.stats.outputTokens
      })
    }

    // Determine state based on stop_reason
    this.updateStateFromStopReason(agentId, session, stopReason)
  }

  /**
   * Handle user message (tool results)
   */
  private handleUserMessage(
    agentId: string,
    session: JsonClaudeSession,
    message: ClaudeUserMessage
  ): void {
    for (const block of message.message.content) {
      if (block.type === 'tool_result' && 'tool_use_id' in block) {
        let content =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content)

        // Truncate large tool results to save memory
        let isTruncated = false
        if (content.length > MAX_TOOL_RESULT_SIZE) {
          content = content.slice(0, MAX_TOOL_RESULT_SIZE) + '\n... (truncated)'
          isTruncated = true
        }

        const item = this.createConversationItem(agentId, 'tool_result', content, {
          toolUseId: block.tool_use_id,
          isError: block.is_error,
          isTruncated
        })
        this.addConversationItem(session, item)
      }
    }

    // Tool results indicate Claude is processing - state is working
    session.waitingReason = undefined
    this.emitStateChange(agentId, 'working')
  }

  /**
   * Handle stream event (real-time text streaming)
   */
  private handleStreamEvent(
    agentId: string,
    session: JsonClaudeSession,
    message: ClaudeStreamEvent
  ): void {
    const event = message.event

    if (event.type === 'content_block_start') {
      session.currentStreamingBlockIndex = event.index ?? 0
      session.currentStreamingText = ''
    }

    if (event.type === 'content_block_delta' && event.delta?.text) {
      session.currentStreamingText += event.delta.text

      // Cap streaming text to prevent memory issues
      if (session.currentStreamingText.length > MAX_STREAMING_TEXT) {
        session.currentStreamingText = session.currentStreamingText.slice(-MAX_STREAMING_TEXT)
      }

      // Emit streaming chunk for real-time UI updates
      const chunk: StreamingChunk = {
        text: event.delta.text,
        fullText: session.currentStreamingText
      }
      this.safeSendIPC('claude:streamChunk', agentId, chunk)
    }

    if (event.type === 'content_block_stop') {
      // Block finished - clear streaming state
      session.currentStreamingBlockIndex = -1
    }

    // Any streaming activity means Claude is working
    if (session.state !== 'working') {
      this.emitStateChange(agentId, 'working')
    }
  }

  /**
   * Handle result message (session completion)
   */
  private handleResultMessage(
    agentId: string,
    session: JsonClaudeSession,
    message: ClaudeResultMessage
  ): void {
    session.stats.totalCostUsd = message.total_cost_usd || 0
    session.stats.numTurns = message.num_turns || 0
    session.stats.durationMs = message.duration_ms

    log.info(`Session completed for ${agentId}`, {
      isError: message.is_error,
      turns: message.num_turns,
      cost: message.total_cost_usd
    })

    this.emitStateChange(agentId, message.is_error ? 'error' : 'completed')
    this.safeSendIPC('claude:sessionEnded', agentId, {
      isError: message.is_error,
      stats: session.stats,
      permissionDenials: message.permission_denials
    })
  }

  /**
   * Update state based on stop_reason from assistant message
   */
  private updateStateFromStopReason(
    agentId: string,
    session: JsonClaudeSession,
    stopReason: ClaudeAssistantMessage['message']['stop_reason']
  ): void {
    if (stopReason === 'end_turn') {
      // Claude finished its turn - waiting for user input
      if (!session.waitingReason) {
        session.waitingReason = { type: 'end_turn' }
      }
      this.emitStateChange(agentId, 'waiting')
      this.triggerNotification(agentId, session)
    } else if (stopReason === 'tool_use') {
      // Claude is executing tools
      if (session.waitingReason) {
        // Waiting for user approval on a tool
        this.emitStateChange(agentId, 'waiting')
        this.triggerNotification(agentId, session)
      } else {
        // Normal tool execution - still working
        this.emitStateChange(agentId, 'working')
      }
    } else {
      // max_tokens or other - still working
      this.emitStateChange(agentId, 'working')
    }
  }

  /**
   * Create a waiting reason from tool info
   */
  private createWaitingReason(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string
  ): ClaudeWaitingReason {
    if (toolName === 'AskUserQuestion') {
      return {
        type: 'question',
        toolName,
        toolInput,
        toolUseId,
        question: (toolInput as any)?.question || 'Claude has a question'
      }
    } else if (toolName === 'ExitPlanMode') {
      return {
        type: 'plan_approval',
        toolName,
        toolInput,
        toolUseId
      }
    } else {
      return {
        type: 'permission_required',
        toolName,
        toolInput,
        toolUseId
      }
    }
  }

  /**
   * Trigger a notification that Claude is waiting
   */
  private triggerNotification(agentId: string, session: JsonClaudeSession): void {
    // INSTANT notification - no polling delay!
    this.notificationService?.notify({
      title: 'Input Required',
      body: `${session.displayName} is waiting for your input`,
      agentId
    })

    // Emit IPC event with waiting reason
    this.safeSendIPC('claude:waitingForInput', agentId, session.waitingReason)
  }

  /**
   * Emit state change and update IPC
   */
  private emitStateChange(agentId: string, state: ClaudeAgentState): void {
    const session = this.sessions.get(agentId)
    if (!session) return

    const previousState = session.state
    if (previousState === state) return // No change

    session.state = state
    log.debug(`State change for ${agentId}: ${previousState} -> ${state}`)

    // Clear notification cooldown when work resumes
    if (previousState === 'waiting' && state === 'working') {
      this.notificationService?.clearCooldown(agentId)
      this.safeSendIPC('claude:resumedWork', agentId)
    }

    this.safeSendIPC('claude:stateChanged', agentId, state)
  }

  /**
   * Create a conversation item with ID and timestamp
   */
  private createConversationItem(
    agentId: string,
    type: ConversationItem['type'],
    content: string,
    extra?: Partial<ConversationItem>
  ): ConversationItem {
    return {
      id: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      content,
      ...extra
    }
  }

  /**
   * Add a conversation item with memory management
   */
  private addConversationItem(session: JsonClaudeSession, item: ConversationItem): void {
    session.conversation.push(item)

    // Sliding window - drop old items to stay under memory limit
    while (session.conversation.length > session.maxConversationItems) {
      session.conversation.shift()
      log.debug(`Dropped old conversation item to stay under ${session.maxConversationItems} limit`)
    }

    // Emit to renderer
    this.safeSendIPC('claude:conversationItem', session.agentId, item)
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(agentId: string, code: number | null, signal: string | null): void {
    const session = this.sessions.get(agentId)
    if (!session) return

    const finalState: ClaudeAgentState = code === 0 ? 'completed' : 'error'
    this.emitStateChange(agentId, finalState)

    this.safeSendIPC('claude:sessionEnded', agentId, {
      exitCode: code,
      signal,
      stats: session.stats
    })
  }

  /**
   * Handle process error
   */
  private handleProcessError(agentId: string, error: Error): void {
    const session = this.sessions.get(agentId)
    if (!session) return

    this.emitStateChange(agentId, 'error')

    const item = this.createConversationItem(agentId, 'error', error.message, {
      isError: true
    })
    this.addConversationItem(session, item)

    this.safeSendIPC('claude:error', agentId, error.message)
  }

  /**
   * Send input to Claude via stdin
   */
  sendInput(agentId: string, input: string): void {
    const session = this.sessions.get(agentId)
    if (!session?.process.stdin) {
      log.error(`Cannot send input - no session or stdin for ${agentId}`)
      return
    }

    log.debug(`Sending input to ${agentId}:`, input.slice(0, 100))

    // Add user input to conversation
    const item = this.createConversationItem(agentId, 'user_prompt', input)
    this.addConversationItem(session, item)

    // Build message based on whether we're responding to a tool
    let message: any

    if (session.waitingReason?.toolUseId) {
      // Respond to tool_use with tool_result
      message = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: session.waitingReason.toolUseId,
              content: input,
              is_error: false
            }
          ]
        }
      }
    } else {
      // Regular text input (follow-up prompt)
      message = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: input }]
        }
      }
    }

    try {
      session.process.stdin.write(JSON.stringify(message) + '\n')
      session.waitingReason = undefined
      this.emitStateChange(agentId, 'working')
    } catch (err) {
      log.error(`Failed to send input to ${agentId}:`, err)
      this.safeSendIPC('claude:error', agentId, `Failed to send input: ${err}`)
    }
  }

  /**
   * Stop an agent
   */
  stopAgent(agentId: string): void {
    const session = this.sessions.get(agentId)
    if (!session) {
      log.warn(`Cannot stop - no session for ${agentId}`)
      return
    }

    log.info(`Stopping JSON Claude agent: ${agentId}`)

    try {
      // Send SIGTERM for graceful shutdown
      session.process.kill('SIGTERM')

      // Give it 5 seconds, then force kill
      setTimeout(() => {
        if (this.sessions.has(agentId)) {
          try {
            session.process.kill('SIGKILL')
          } catch {
            // Process may already be dead
          }
        }
      }, 5000)
    } catch (err) {
      log.warn(`Error stopping agent ${agentId}:`, err)
    }

    // Clean up session
    this.sessions.delete(agentId)
    this.safeSendIPC('claude:sessionEnded', agentId, { stopped: true })
  }

  /**
   * Check if an agent is running in JSON mode
   */
  hasAgent(agentId: string): boolean {
    return this.sessions.has(agentId)
  }

  /**
   * Get the conversation history for an agent
   */
  getConversation(agentId: string): ConversationItem[] {
    return this.sessions.get(agentId)?.conversation || []
  }

  /**
   * Get the current state of an agent
   */
  getState(agentId: string): ClaudeAgentState | undefined {
    return this.sessions.get(agentId)?.state
  }

  /**
   * Get session stats
   */
  getStats(agentId: string): SessionStats | undefined {
    return this.sessions.get(agentId)?.stats
  }

  /**
   * Get waiting reason (if agent is waiting)
   */
  getWaitingReason(agentId: string): ClaudeWaitingReason | undefined {
    return this.sessions.get(agentId)?.waitingReason
  }

  /**
   * Generate deterministic session ID (same as TerminalService)
   */
  private generateSessionId(agentId: string, worktreePath: string): string {
    return uuidv5(`${agentId}:${worktreePath}`, this.AGENT_SESSION_NAMESPACE)
  }

  /**
   * Safely send IPC message to renderer
   */
  private safeSendIPC(channel: string, ...args: unknown[]): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args)
      }
    } catch (err) {
      log.warn(`Failed to send IPC on channel ${channel}:`, err)
    }
  }

  /**
   * Clean up all sessions (called on app exit)
   */
  cleanup(): void {
    log.info(`Cleaning up ${this.sessions.size} JSON Claude sessions`)

    for (const [, session] of this.sessions) {
      try {
        session.process.kill('SIGTERM')
      } catch {
        // Process may already be dead
      }
    }

    this.sessions.clear()
  }

  /**
   * Get list of active agent IDs
   */
  getActiveAgentIds(): string[] {
    return Array.from(this.sessions.keys())
  }
}
