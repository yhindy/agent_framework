import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { v5 as uuidv5 } from 'uuid'
import { AgentInfo } from './types/ProjectConfig'
import { AgentService } from './AgentService'
import { ClaudeSessionInfoService } from './ClaudeSessionInfoService'
import { NotificationService } from './NotificationService'
import {
  IdleDetector,
  CLAUDE_WORKING_PATTERNS,
  CLAUDE_IDLE_INDICATORS,
  CLAUDE_START_PATTERN,
  SHELL_WORKING_PATTERNS,
  SHELL_IDLE_INDICATORS
} from './IdleDetector'

// Simple ANSI strip function to avoid ESM issues
function stripAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

interface TerminalSession {
  pty: pty.IPty
  agentId: string
  tool: string
  mode: string
  worktreePath: string        // Store for persistence operations
  projectPath?: string        // Store for resume failure recovery
  prompt?: string             // Store for restart
  model?: string              // Store for restart
  yolo?: boolean              // Store for restart
  idleDetector?: IdleDetector // Shared idle detection module (legacy, for non-Claude tools)
  statePollingInterval?: NodeJS.Timeout // JSONL-based state polling for Claude
}

interface PlainTerminalSession {
  pty: pty.IPty
  terminalId: string
  idleDetector?: IdleDetector // Shared idle detection module
}

export class TerminalService {
  private terminals: Map<string, TerminalSession>
  private plainTerminals: Map<string, PlainTerminalSession>
  private mainWindow: BrowserWindow
  private agentService?: AgentService
  private claudeSessionInfoService?: ClaudeSessionInfoService
  private notificationService?: NotificationService

  // Namespace UUID for agent sessions
  private readonly AGENT_SESSION_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

  constructor(mainWindow: BrowserWindow, notificationService?: NotificationService) {
    this.terminals = new Map()
    this.plainTerminals = new Map()
    this.mainWindow = mainWindow
    this.notificationService = notificationService
  }

  setWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  setAgentService(agentService: AgentService): void {
    this.agentService = agentService
  }

  setClaudeSessionInfoService(claudeSessionInfoService: ClaudeSessionInfoService): void {
    this.claudeSessionInfoService = claudeSessionInfoService
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
    if (agentInfo?.claudeSessionId && tool === 'claude') {
      // Check if session actually exists in JSONL (more reliable than flag)
      const sessionState = this.claudeSessionInfoService?.getSessionState(
        agentInfo.claudeSessionId,
        worktreePath
      )
      if (sessionState && sessionState !== 'unknown') {
        isResume = true
        console.log(`[TerminalService] Resuming session ${agentInfo.claudeSessionId} (state: ${sessionState})`)
      } else {
        console.log(`[TerminalService] Session ${agentInfo.claudeSessionId} not found in JSONL, creating new`)
      }
    }

    // Determine command based on tool
    let command: string
    let args: string[]

    switch (tool) {
      case 'claude':
        command = 'claude'

        if (isResume) {
          // Resume existing session - preserve original flags
          args = ['--resume', sessionId]

          // Preserve model
          if (model) args.push('--model', model)

          // Preserve permission mode
          if (mode === 'planning') {
            args.push('--permission-mode', 'plan')

            // Preserve system prompt file for super minions
            const isSuperMinion = agentInfo?.isSuperMinion === true
            if (isSuperMinion && this.agentService) {
              args.push('--system-prompt-file', this.agentService.getSuperMinionRulesPath())
            }
          } else if (mode === 'dev') {
            args.push('--permission-mode', 'acceptEdits')
          }

          // Preserve yolo mode (dangerously-skip-permissions)
          if (yolo) {
            args.push('--dangerously-skip-permissions')
          }
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

    // State detection: JSONL for Claude, IdleDetector for other tools
    let idleDetector: IdleDetector | undefined
    let statePollingInterval: NodeJS.Timeout | undefined

    if (tool === 'claude' && this.claudeSessionInfoService) {
      // JSONL-based state detection for Claude (more reliable than pattern matching)
      let lastKnownState: 'working' | 'waiting' | 'unknown' = 'unknown'

      // Poll JSONL state every 2 seconds for notification triggers
      // Smart caching (mtime check) makes frequent polling efficient - cache hits are ~0.1ms
      console.log(`[TerminalService] Starting JSONL state polling for ${agentId} (session: ${sessionId})`)
      statePollingInterval = setInterval(() => {
        if (!sessionId) return

        const currentState = this.claudeSessionInfoService!.getSessionState(sessionId, worktreePath)

        // Detect state transitions
        if (currentState !== lastKnownState) {
          console.log(`[TerminalService] State transition for ${agentId}: ${lastKnownState} -> ${currentState} (session: ${sessionId})`)
          if (currentState === 'waiting' && lastKnownState !== 'waiting') {
            // Transitioned to waiting - emit notification
            console.log(`[TerminalService] ${agentId} now waiting for input - sending IPC event`)
            this.mainWindow.webContents.send('agent:waitingForInput', agentId, 'Claude is waiting for input')
            // Send desktop notification
            this.notificationService?.notify({
              title: 'Input Required',
              body: `Agent ${agentId} is waiting for your input`,
              agentId
            })
            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: true,
              claudeLastSeen: new Date().toISOString()
            }).then(() => {
              // Also emit agents:updated to ensure sidebar reloads from files
              this.mainWindow.webContents.send('agents:updated')
            }).catch(err => console.error('Failed to update agent info:', err))
          } else if (currentState === 'working' && lastKnownState === 'waiting') {
            // Transitioned to working - clear notification
            console.log(`[TerminalService] ${agentId} resumed work - sending IPC event`)
            this.mainWindow.webContents.send('agent:resumedWork', agentId)
            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: false,
              claudeLastSeen: new Date().toISOString()
            }).then(() => {
              // Also emit agents:updated to ensure sidebar reloads from files
              this.mainWindow.webContents.send('agents:updated')
            }).catch(err => console.error('Failed to update agent info:', err))
          }

          lastKnownState = currentState
        }
      }, 2000) // 2 second interval - mtime caching makes this efficient

      // Initialize state if resuming - and emit current state to ensure sidebar is in sync
      if (isResume) {
        const initialState = this.claudeSessionInfoService.getSessionState(sessionId, worktreePath)
        lastKnownState = initialState
        console.log(`[TerminalService] Resume: initial JSONL state for ${agentId} is '${initialState}'`)

        // Emit initial state event so sidebar is immediately in sync
        if (initialState === 'waiting') {
          console.log(`[TerminalService] Resume: emitting initial waitingForInput for ${agentId}`)
          this.mainWindow.webContents.send('agent:waitingForInput', agentId, 'Claude is waiting for input')
        }
      }
    } else {
      // Pattern-based IdleDetector for non-Claude tools (cursor, etc.)
      idleDetector = new IdleDetector(
        {
          workingPatterns: tool === 'cursor-cli' ? CLAUDE_WORKING_PATTERNS : [],
          idleIndicators: tool === 'cursor-cli' ? CLAUDE_IDLE_INDICATORS : [],
          idleThreshold: 2000,
          inputGracePeriod: 1000,
          requireStartSignal: true,
          startPattern: CLAUDE_START_PATTERN
        },
        {
          onWaitingForInput: (_context: string) => {
            this.mainWindow.webContents.send('agent:waitingForInput', agentId, 'Waiting for input')
            // Send desktop notification
            this.notificationService?.notify({
              title: 'Input Required',
              body: `Agent ${agentId} is waiting for your input`,
              agentId
            })
            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: true
            }).catch(err => console.error('Failed to update agent info:', err))
          },
          onResumedWork: () => {
            this.mainWindow.webContents.send('agent:resumedWork', agentId)
            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: false
            }).catch(err => console.error('Failed to update agent info:', err))
          }
        }
      )
    }

    // Store terminal session
    const session: TerminalSession = {
      pty: terminal,
      agentId,
      tool,
      mode,
      worktreePath,
      projectPath,
      prompt,
      model,
      yolo,
      idleDetector,
      statePollingInterval
    }

    // Mark if we're attempting to resume (for error detection)
    if (isResume) {
      (session as any)._attemptingResume = true
    }

    this.terminals.set(agentId, session)

    // Send the command to the terminal
    terminal.write(`${command} ${args.join(' ')}\r`)

    // Persist session ID and flags immediately
    if (tool === 'claude') {
      await this.updateAgentInfo(worktreePath, {
        claudeSessionId: sessionId,
        claudeSessionActive: true,
        claudeLastSeen: new Date().toISOString(),
        yolo: yolo || false,
        mode,
        model,
        prompt
      })
    }

    // Handle output
    terminal.onData((data) => {
      this.handleOutput(agentId, data)
    })

    // Handle exit
    terminal.onExit(() => {
      // Clean up idle detector (legacy, for non-Claude tools)
      session.idleDetector?.dispose()

      // Clean up JSONL state polling (Claude sessions)
      if (session.statePollingInterval) {
        clearInterval(session.statePollingInterval)
      }

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
      if (isSuperMinion && this.agentService) {
        // Use absolute path to the bundled rules file
        args.push('--system-prompt-file', this.agentService.getSuperMinionRulesPath())
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
      session.idleDetector?.dispose()
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

    // Delegate idle detection to IdleDetector (if present)
    session.idleDetector?.processOutput(data)
  }

  stopAgent(agentId: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      // Clean up idle detector (legacy, for non-Claude tools)
      session.idleDetector?.dispose()

      // Clean up JSONL state polling (Claude sessions)
      if (session.statePollingInterval) {
        clearInterval(session.statePollingInterval)
      }

      session.pty.kill()
      this.terminals.delete(agentId)
      this.mainWindow.webContents.send('agents:updated')
    }
  }

  sendInput(agentId: string, data: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      // Record input to idle detector (handles grace period and state clearing)
      session.idleDetector?.recordInput()
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

    // Create IdleDetector for plain terminals (uses combined shell + Claude patterns)
    const idleDetector = new IdleDetector(
      {
        workingPatterns: SHELL_WORKING_PATTERNS,
        idleIndicators: SHELL_IDLE_INDICATORS,
        idleThreshold: 2000,
        inputGracePeriod: 1000,
        requireStartSignal: false // Plain terminals don't need a start signal
      },
      {
        onWaitingForInput: (_context: string) => {
          this.mainWindow.webContents.send('plainTerminal:waitingForInput', fullTerminalId, 'Terminal is waiting for input')
        },
        onResumedWork: () => {
          this.mainWindow.webContents.send('plainTerminal:resumedWork', fullTerminalId)
        }
      }
    )

    // Store terminal session
    const session: PlainTerminalSession = {
      pty: terminal,
      terminalId: fullTerminalId,
      idleDetector
    }
    this.plainTerminals.set(fullTerminalId, session)

    // Handle output
    terminal.onData((data) => {
      this.mainWindow.webContents.send('plainTerminal:output', fullTerminalId, data)
      // Delegate idle detection to IdleDetector
      idleDetector.processOutput(data)
    })

    // Handle exit
    terminal.onExit(() => {
      idleDetector.dispose()
      this.plainTerminals.delete(fullTerminalId)
    })
  }

  stopPlainTerminal(terminalId: string): void {
    const session = this.plainTerminals.get(terminalId)
    if (session) {
      session.idleDetector?.dispose()
      session.pty.kill()
      this.plainTerminals.delete(terminalId)
    }
  }

  sendPlainInput(terminalId: string, data: string): void {
    const session = this.plainTerminals.get(terminalId)
    if (session) {
      // Record input to idle detector (handles grace period and state clearing)
      session.idleDetector?.recordInput()
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
