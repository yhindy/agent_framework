import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { v5 as uuidv5 } from 'uuid'
import { AgentInfo } from './types/ProjectConfig'
import { AgentService } from './AgentService'

// Simple ANSI strip function to avoid ESM issues
function stripAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

interface TerminalSession {
  pty: pty.IPty
  agentId: string
  tool: string
  mode: string
  worktreePath: string        // NEW: Store for persistence operations
  projectPath?: string        // NEW: Store for resume failure recovery
  prompt?: string             // NEW: Store for restart
  model?: string              // NEW: Store for restart
  yolo?: boolean              // NEW: Store for restart
  idleTimer?: NodeJS.Timeout
  isWaiting?: boolean
  lastInputTime: number
  outputBuffer: string        // Buffer recent output for pattern detection
  claudeStarted: boolean      // Track if Claude UI has been seen
  lastWorkingTime: number     // When we last saw working indicators
}

interface PlainTerminalSession {
  pty: pty.IPty
  terminalId: string
}

const SIGNAL_PATTERNS = [
  { pattern: '===SIGNAL:PLANS_READY===', signal: 'PLANS_READY' },
  { pattern: '===SIGNAL:DEV_COMPLETED===', signal: 'DEV_COMPLETED' },
  { pattern: '===SIGNAL:BLOCKER===', signal: 'BLOCKER' },
  { pattern: '===SIGNAL:QUESTION===', signal: 'QUESTION' },
  { pattern: '===SIGNAL:WORKING===', signal: 'WORKING' }
]

const PROMPT_PATTERNS = [
  /\?\s*$/,                    // Ends with question mark
  /\[Y\/n\]/i,                 // [Y/n] or [y/N]
  /\(yes\/no\)/i,              // (yes/no)
  /Press Enter/i,              // Press Enter to continue
  /Allow .+ to/i,              // Permission prompts
  /Do you want to/i,           // Confirmation prompts
  /Approve\?/i,
  /Continue\?/i,
  /Overwrite\?/i,
  /Claude is waiting for your input/i,  // Explicit Claude notification
]

// Claude Code specific: detect when spinner stops and input prompt is shown
const CLAUDE_IDLE_INDICATORS = [
  /^>\s*$/m,                   // Just ">" on a line (empty input prompt)
  /⏵⏵\s*bypass/i,             // Permission bypass prompt
  /shift\+tab to cycle/i,     // Permission selector UI
  /-- INSERT --/,              // Vim-like insert mode indicator
]

// Patterns that indicate Claude is still working (spinner active)
const CLAUDE_WORKING_PATTERNS = [
  /Sussing…/,                  // Claude's spinner text
  /Booping…/,                  // Another spinner text
  /Puttering…/,                // Another spinner text
  /Thinking…/,                 // Thinking indicator
  /Inferring…/,                // Inference indicator
  /Working…/,                  // Generic working indicator
  /Running…/,                  // Running a command
  /Waiting…/,                  // Waiting for something (tool execution)
  /esc to interrupt/,          // Still processing
]

export class TerminalService {
  private terminals: Map<string, TerminalSession>
  private plainTerminals: Map<string, PlainTerminalSession>
  private mainWindow: BrowserWindow
  private agentService?: AgentService

  // Namespace UUID for agent sessions
  private readonly AGENT_SESSION_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

  constructor(mainWindow: BrowserWindow) {
    this.terminals = new Map()
    this.plainTerminals = new Map()
    this.mainWindow = mainWindow
  }

  setWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  setAgentService(agentService: AgentService): void {
    this.agentService = agentService
  }

  private generateSessionId(agentId: string, worktreePath: string): string {
    // Create deterministic UUID from agentId + path
    // This ensures same agent always gets same session ID
    const input = `${agentId}:${worktreePath}`
    return uuidv5(input, this.AGENT_SESSION_NAMESPACE)
  }

  private async readAgentInfo(worktreePath: string): Promise<AgentInfo | null> {
    if (!this.agentService) return null
    return this.agentService.readAgentInfo(worktreePath)
  }

  private async updateAgentInfo(worktreePath: string, updates: Partial<AgentInfo>): Promise<void> {
    if (!this.agentService) {
      console.warn('AgentService not set, cannot persist state')
      return
    }

    try {
      this.agentService.updateAgentInfo(worktreePath, updates)
    } catch (error) {
      console.error('Failed to update agent info:', error)
    }
  }

  // Fast process state check - reads /proc directly on Linux, falls back to ps on macOS
  private isProcessWaitingForInput(pid: number): boolean {
    try {
      if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
        // Direct /proc read: ~0.1ms
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        const state = stat.split(' ')[2]
        return state === 'S' || state === 'I' // Sleeping (interruptible) or Idle
      } else {
        // macOS fallback: single ps call ~10ms
        const result = execSync(`ps -o state= -p ${pid}`, { encoding: 'utf8' }).trim()
        // On macOS, 'S' is sleeping, 'I' is idle. '+' means foreground.
        return result.includes('S') || result.includes('I')
      }
    } catch {
      return false
    }
  }

  private looksLikePrompt(text: string): boolean {
    const stripped = stripAnsi(text)
    return PROMPT_PATTERNS.some(pattern => pattern.test(stripped))
  }

  private isClaudeWorking(text: string): boolean {
    const stripped = stripAnsi(text)
    return CLAUDE_WORKING_PATTERNS.some(pattern => pattern.test(stripped))
  }

  private isClaudeIdle(text: string): boolean {
    const stripped = stripAnsi(text)
    return CLAUDE_IDLE_INDICATORS.some(pattern => pattern.test(stripped))
  }

  async startAgent(
    projectPath: string,
    agentId: string,
    tool: string,
    mode: string,
    prompt?: string,
    model?: string,
    yolo?: boolean
  ): Promise<void> {
    // Stop existing terminal if any
    this.stopAgent(agentId)

    // Determine worktree path
    let worktreePath: string

    // Base branch agents work in the main project directory
    if (agentId.endsWith('-base')) {
      worktreePath = projectPath
    } else {
      // Regular agents use worktrees
      const projectName = projectPath.split('/').pop() || 'project'

      // New naming convention: ../<AGENT_ID> (where AGENT_ID is repo-N)
      if (agentId.startsWith(`${projectName}-`)) {
        worktreePath = join(projectPath, '..', agentId)
      } else {
        // Legacy: ../<PROJECT_NAME>-<AGENT_ID>
        worktreePath = join(projectPath, '..', `${projectName}-${agentId}`)
      }
    }

    // Generate deterministic session ID
    const sessionId = this.generateSessionId(agentId, worktreePath)

    // Read agent info to check for existing session
    const agentInfo = await this.readAgentInfo(worktreePath)

    let isResume = false
    if (agentInfo?.claudeSessionActive && agentInfo?.claudeSessionId && tool === 'claude') {
      isResume = true
    }

    // Determine command based on tool
    let command: string
    let args: string[]

    switch (tool) {
      case 'claude':
        command = 'claude'

        if (isResume) {
          // Resume existing session
          args = ['--resume', sessionId]
          if (model) args.push('--model', model)
        } else {
          // Create new session with specific ID
          args = this.getClaudeArgs(mode, agentId, prompt, model, yolo, agentInfo)
          args.push('--session-id', sessionId)
        }
        break
      case 'cursor-cli':
        command = 'cursor'
        args = this.getCursorArgs(mode, agentId, prompt, model)
        break
      case 'cursor':
        // For regular cursor, we don't spawn a terminal
        // The user will use "Open in Cursor" button instead
        throw new Error('Use openInCursor for cursor tool')
      default:
        throw new Error(`Unknown tool: ${tool}`)
    }

    // Spawn PTY
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

    // Create a clean environment object for node-pty
    // node-pty/posix_spawn can fail if env has non-string values or special properties
    const spawnEnv: Record<string, string> = {}
    for (const key in process.env) {
      if (process.env.hasOwnProperty(key) && typeof process.env[key] === 'string') {
        spawnEnv[key] = process.env[key]!
      }
    }
    spawnEnv.TERM = 'xterm-256color'
    spawnEnv.COLORTERM = 'truecolor'

    const terminal = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: worktreePath,
      env: spawnEnv
    })

    // Store terminal session
    const session: TerminalSession = {
      pty: terminal,
      agentId,
      tool,
      mode,
      worktreePath,  // NEW: Store for persistence operations
      projectPath,   // NEW: Store for resume failure recovery
      prompt,        // NEW: Store for restart
      model,         // NEW: Store for restart
      yolo,          // NEW: Store for restart
      lastInputTime: 0,
      outputBuffer: '',
      claudeStarted: isResume,  // Already started if resuming
      lastWorkingTime: 0,
      isWaiting: agentInfo?.isWaitingForInput ?? false  // Restore persisted waiting state
    }

    // Mark if we're attempting to resume (for error detection)
    if (isResume) {
      (session as any)._attemptingResume = true
    }

    this.terminals.set(agentId, session)

    // Send the command to the terminal
    terminal.write(`${command} ${args.join(' ')}\r`)

    // Persist session ID immediately
    if (tool === 'claude') {
      await this.updateAgentInfo(worktreePath, {
        claudeSessionId: sessionId,
        claudeSessionActive: true,
        claudeLastSeen: new Date().toISOString()
      })
    }

    // Handle output
    terminal.onData((data) => {
      this.handleOutput(agentId, data)
    })

    // Handle exit
    terminal.onExit(() => {
      // Mark session as inactive on exit
      if (tool === 'claude' && worktreePath) {
        this.updateAgentInfo(worktreePath, { claudeSessionActive: false })
          .catch(err => console.error('Failed to mark session inactive:', err))
      }
      this.terminals.delete(agentId)
      this.mainWindow.webContents.send('agents:updated')
    })
  }

  private getClaudeArgs(mode: string, _agentId: string, prompt?: string, model?: string, yolo?: boolean, agentInfo?: any): string[] {
    const args: string[] = []

    // Add model if specified
    if (model) {
      args.push('--model', model)
    }

    if (mode === 'planning') {
      // Use Claude's plan permission mode - shows plan before executing
      args.push('--permission-mode', 'plan')

      // For super minions, load the rules file as system prompt
      const isSuperMinion = agentInfo?.isSuperMinion === true
      if (isSuperMinion) {
        // The super-minion-rules.md file is copied to the worktree during setup
        // Path is relative to the working directory where claude command will be run
        args.push('--system-prompt-file', 'super-minion-rules.md')
      }

      if (prompt) {
        // Include budget info in the planning prompt
        const minionBudget = agentInfo?.minionBudget || 5

        let planPrompt: string
        if (isSuperMinion) {
          planPrompt = `You have a budget of ${minionBudget} child minions. Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
        } else {
          planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
        }
        args.push(`"${planPrompt.replace(/"/g, '\\"')}"`)
      }
    } else if (mode === 'dev') {
      // Use acceptEdits mode - auto-approves file changes for faster development
      args.push('--permission-mode', 'acceptEdits')

      if (prompt) {
        args.push(`"${prompt.replace(/"/g, '\\"')}"`)
      }
    }

    // Add dangerously-skip-permissions flag if yolo mode enabled
    if (yolo) {
      args.push('--dangerously-skip-permissions')
    }

    return args
  }

  private getCursorArgs(mode: string, _agentId: string, prompt?: string, model?: string): string[] {
    // Use 'cursor agent' subcommand
    const args: string[] = ['agent']

    // Add model if specified
    if (model) {
      args.push('--model', model)
    }

    // Add prompt if provided
    if (prompt) {
      if (mode === 'planning') {
        const planPrompt = `Create a plan for: ${prompt}`
        args.push(`"${planPrompt.replace(/"/g, '\\"')}"`)
      } else {
        args.push(`"${prompt.replace(/"/g, '\\"')}"`)
      }
    }

    return args
  }

  private handleOutput(agentId: string, data: string): void {
    const session = this.terminals.get(agentId)
    if (!session) return

    // Send raw data to renderer for terminal display
    this.mainWindow.webContents.send('terminal:output', agentId, data)

    // Update output buffer (keep last 2000 chars for pattern detection across chunks)
    session.outputBuffer = (session.outputBuffer + data).slice(-2000)

    // Check for resume failures and fall back to fresh start
    const stripped = stripAnsi(data)
    if ((session as any)._attemptingResume && (
      stripped.includes('Session not found') ||
      stripped.includes('Could not resume') ||
      stripped.includes('Error resuming session')
    )) {
      console.warn(`Resume failed for ${agentId}, attempting fresh start...`)

      // Mark that we're not resuming anymore
      ;(session as any)._attemptingResume = false

      // Clear session state
      if (session.worktreePath) {
        this.updateAgentInfo(session.worktreePath, {
          claudeSessionActive: false,
          claudeSessionId: undefined
        }).catch(err => console.error('Failed to clear session:', err))
      }

      // Kill current PTY and restart fresh
      session.pty.kill()
      this.terminals.delete(agentId)

      // Restart without resume (use stored values)
      if (session.projectPath) {
        this.startAgent(
          session.projectPath,
          agentId,
          session.tool,
          session.mode,
          session.prompt,
          session.model,
          session.yolo
        ).catch(err => console.error(`Failed to restart agent ${agentId}:`, err))
      }

      return
    }

    // Check if Claude UI has started (look for Claude Code header)
    if (!session.claudeStarted && session.outputBuffer.includes('Claude Code')) {
      session.claudeStarted = true
    }

    // Check for working patterns in the CURRENT CHUNK only (not buffer - buffer retains old patterns)
    const isWorkingNow = this.isClaudeWorking(stripped)

    // If Claude is actively working (spinner visible in CURRENT output), cancel idle timer and clear waiting state
    if (isWorkingNow) {
      session.lastWorkingTime = Date.now()
      if (session.idleTimer) {
        clearTimeout(session.idleTimer)
        session.idleTimer = undefined
      }
      if (session.isWaiting) {
        session.isWaiting = false
        this.mainWindow.webContents.send('agent:resumedWork', agentId)

        // Persist resumed state
        if (session.worktreePath) {
          this.updateAgentInfo(session.worktreePath, {
            isWaitingForInput: false,
            claudeLastSeen: new Date().toISOString()
          })
        }
      }
      return // Don't process further - Claude is working
    }

    // Check for signals
    for (const { pattern, signal } of SIGNAL_PATTERNS) {
      if (stripped.includes(pattern)) {
        this.mainWindow.webContents.send('agent:signal', agentId, signal)
        break
      }
    }

    // Only start idle detection if Claude has started
    if (!session.claudeStarted) {
      return
    }

    // Claude is NOT showing working indicators - start idle timer
    // Only start timer if not already running and not already waiting
    if (!session.idleTimer && !session.isWaiting) {
      session.idleTimer = setTimeout(() => {
        session.idleTimer = undefined
        
        // Grace period check: if input was sent VERY recently (< 1s), don't trigger waiting state
        // This prevents flicker when user is actively typing, but doesn't block after sending a message
        const timeSinceLastInput = Date.now() - session.lastInputTime
        if (timeSinceLastInput < 1000) {
          return 
        }

        // Double-check we haven't seen working indicators recently (within timer delay)
        const timeSinceLastWorking = Date.now() - session.lastWorkingTime
        if (timeSinceLastWorking < 2000) {
          return
        }

        // Claude is idle - emit waiting event
        session.isWaiting = true
        this.mainWindow.webContents.send('agent:waitingForInput', agentId, 'Claude is waiting for input')

        // Persist waiting state
        if (session.worktreePath) {
          this.updateAgentInfo(session.worktreePath, {
            isWaitingForInput: true,
            lastOutputSnapshot: session.outputBuffer.slice(-500),
            claudeLastSeen: new Date().toISOString()
          })
        }
      }, 2000) // 2 seconds of no working indicators
    }
  }

  stopAgent(agentId: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      if (session.idleTimer) {
        clearTimeout(session.idleTimer)
      }
      session.pty.kill()
      this.terminals.delete(agentId)
      this.mainWindow.webContents.send('agents:updated')
    }
  }

  sendInput(agentId: string, data: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      session.lastInputTime = Date.now()
      
      // If was waiting, clear that state immediately on input
      if (session.isWaiting) {
        session.isWaiting = false
        this.mainWindow.webContents.send('agent:resumedWork', agentId)
      }
      
      session.pty.write(data)
    }
  }

  resize(agentId: string, cols: number, rows: number): void {
    const session = this.terminals.get(agentId)
    if (session) {
      session.pty.resize(cols, rows)
    }
  }

  cleanup(): void {
    for (const [agentId, _session] of this.terminals) {
      this.stopAgent(agentId)
    }
    for (const [terminalId, _session] of this.plainTerminals) {
      this.stopPlainTerminal(terminalId)
    }
  }

  // Check if an agent has an active terminal
  hasActiveTerminal(agentId: string): boolean {
    return this.terminals.has(agentId)
  }

  // Get the PID of an agent's terminal (if running)
  getTerminalPid(agentId: string): number | null {
    const session = this.terminals.get(agentId)
    return session ? session.pty.pid : null
  }

  // Get all active agent terminal info
  getActiveTerminals(): Map<string, number> {
    const result = new Map<string, number>()
    for (const [agentId, session] of this.terminals) {
      result.set(agentId, session.pty.pid)
    }
    return result
  }

  // Plain terminal methods (for user shells, not agent tools)
  async startPlainTerminal(projectPath: string, agentId: string, terminalId: string): Promise<void> {
    const fullTerminalId = `${agentId}-${terminalId}`
    
    // Check if terminal already exists
    if (this.plainTerminals.has(fullTerminalId)) {
      return
    }

    // Determine worktree path
    let worktreePath: string

    // Base branch agents work in the main project directory
    if (agentId.endsWith('-base')) {
      worktreePath = projectPath
    } else {
      // Regular agents use worktrees
      const projectName = projectPath.split('/').pop() || 'project'

      if (agentId.startsWith(`${projectName}-`)) {
        worktreePath = join(projectPath, '..', agentId)
      } else {
        worktreePath = join(projectPath, '..', `${projectName}-${agentId}`)
      }
    }

    // Spawn PTY with a plain shell
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

    // Debug logging to understand spawn failures
    console.log('[TerminalService] Starting plain terminal:', {
      fullTerminalId,
      shell,
      shellExists: existsSync(shell),
      cwd: worktreePath,
      cwdExists: existsSync(worktreePath),
      platform: process.platform,
      SHELL: process.env.SHELL,
      hasProcessEnv: !!process.env,
      envKeys: Object.keys(process.env).length
    })

    // Create a clean environment object for node-pty
    // node-pty/posix_spawn can fail if env has non-string values or special properties
    // Filter to only include own string properties
    const spawnEnv: Record<string, string> = {}
    for (const key in process.env) {
      if (process.env.hasOwnProperty(key) && typeof process.env[key] === 'string') {
        spawnEnv[key] = process.env[key]!
      }
    }
    // Ensure critical terminal variables are set
    spawnEnv.TERM = 'xterm-256color'
    spawnEnv.COLORTERM = 'truecolor'

    let terminal: pty.IPty
    try {
      terminal = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: worktreePath,
        env: spawnEnv
      })
    } catch (error) {
      console.error('[TerminalService] Failed to spawn plain terminal:', {
        error,
        shell,
        cwd: worktreePath,
        platform: process.platform,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      })
      throw new Error(`Failed to spawn terminal shell "${shell}": ${error instanceof Error ? error.message : String(error)}`)
    }

    // Store terminal session
    const session: PlainTerminalSession = {
      pty: terminal,
      terminalId: fullTerminalId
    }
    this.plainTerminals.set(fullTerminalId, session)

    // Handle output
    terminal.onData((data) => {
      this.mainWindow.webContents.send('plainTerminal:output', fullTerminalId, data)
    })

    // Handle exit
    terminal.onExit(() => {
      this.plainTerminals.delete(fullTerminalId)
    })
  }

  stopPlainTerminal(terminalId: string): void {
    const session = this.plainTerminals.get(terminalId)
    if (session) {
      session.pty.kill()
      this.plainTerminals.delete(terminalId)
    }
  }

  sendPlainInput(terminalId: string, data: string): void {
    const session = this.plainTerminals.get(terminalId)
    if (session) {
      session.pty.write(data)
    }
  }

  resizePlain(terminalId: string, cols: number, rows: number): void {
    const session = this.plainTerminals.get(terminalId)
    if (session) {
      session.pty.resize(cols, rows)
    }
  }
}
