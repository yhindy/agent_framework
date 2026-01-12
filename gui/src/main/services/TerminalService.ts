import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join, resolve } from 'path'
import { existsSync, statSync } from 'fs'
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
  CODEX_WORKING_PATTERNS,
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
  chrome?: boolean            // Store for restart
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

  /**
   * Compute the worktree path for an agent.
   * Uses project name from config (not directory name) to ensure consistency
   * when running from a worktree vs the main repo.
   */
  private getWorktreePath(projectPath: string, agentId: string): string {
    // Base branch agents work in the main project directory
    if (agentId.endsWith('-base')) {
      return resolve(projectPath)
    }

    // Regular agents use worktrees
    // IMPORTANT: Must use project name from config to match AgentService
    const projectName = this.agentService?.getProjectName(projectPath) || projectPath.split('/').pop() || 'project'

    // New naming convention: ../<AGENT_ID> (where AGENT_ID is repo-N)
    // Use resolve() to get canonical absolute path (resolves .. components)
    let worktreePath: string
    if (agentId.startsWith(`${projectName}-`)) {
      worktreePath = resolve(join(projectPath, '..', agentId))
    } else {
      // Legacy: ../<PROJECT_NAME>-<AGENT_ID>
      worktreePath = resolve(join(projectPath, '..', `${projectName}-${agentId}`))
    }

    console.log('[TerminalService] getWorktreePath:', {
      projectPath,
      agentId,
      projectName,
      worktreePath
    })

    return worktreePath
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
  // Currently unused but kept for potential future use
  // private _isProcessWaitingForInput(pid: number): boolean {
  //   try {
  //     if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
  //       // Direct /proc read: ~0.1ms
  //       const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  //       const state = stat.split(' ')[2]
  //       return state === 'S' || state === 'I' // Sleeping (interruptible) or Idle
  //     } else {
  //       // macOS fallback: single ps call ~10ms
  //       const result = execSync(`ps -o state= -p ${pid}`, { encoding: 'utf8' }).trim()
  //       // On macOS, 'S' is sleeping, 'I' is idle. '+' means foreground.
  //       return result.includes('S') || result.includes('I')
  //     }
  //   } catch {
  //     return false
  //   }
  // }

  async startAgent(
    projectPath: string,
    agentId: string,
    tool: string,
    mode: string,
    prompt?: string,
    model?: string,
    yolo?: boolean,
    chrome?: boolean,
    teleportSessionId?: string
  ): Promise<void> {
    // Stop existing terminal if any (clean up orphaned sessions)
    const existingSession = this.terminals.get(agentId)
    if (existingSession) {
      console.log(`[TerminalService] Cleaning up existing terminal for ${agentId} before starting`)
      this.stopAgent(agentId)
    }

    // Determine worktree path (shared logic with startPlainTerminal)
    const worktreePath = this.getWorktreePath(projectPath, agentId)

    // Generate deterministic session ID
    const sessionId = this.generateSessionId(agentId, worktreePath)

    // For teleported sessions, use the cloud session ID for JSONL lookups
    // Claude CLI uses the teleport session ID for the JSONL file, not our generated UUID
    const effectiveSessionId = teleportSessionId || sessionId

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

        if (teleportSessionId) {
          // Teleporting from cloud - use --teleport flag with cloud session ID
          console.log(`[TerminalService] Teleporting cloud session ${teleportSessionId} for ${agentId}`)
          args = ['--teleport', teleportSessionId]

          // Add model if specified
          if (model) args.push('--model', model)

          // Add permission mode
          if (mode === 'planning') {
            args.push('--permission-mode', 'plan')

            // Add system prompt file for super minions
            const isSuperMinion = (agentInfo as any)?.isSuperMinion === true
            if (isSuperMinion && this.agentService) {
              const rulesPath = this.agentService.getSuperMinionRulesPath()
              args.push('--system-prompt-file', rulesPath)
            }
          } else if (mode === 'dev') {
            args.push('--permission-mode', 'acceptEdits')
          }

          // Always skip permissions for teleport to bypass interactive prompts
          // This handles: "Open Claude Code in X?" and "Trust this folder?" prompts
          args.push('--dangerously-skip-permissions')

          // Add chrome flag (default true)
          if (chrome !== false) {
            args.push('--chrome')
          }
        } else if (isResume) {
          // Resume existing session - use stored session ID (not freshly generated)
          // This is critical for teleported sessions where claudeSessionId differs from generated UUID
          args = ['--resume', agentInfo!.claudeSessionId!]

          // Preserve model
          if (model) args.push('--model', model)

          // Preserve permission mode
          if (mode === 'planning') {
            args.push('--permission-mode', 'plan')

            // Preserve system prompt file for super minions
            const isSuperMinion = (agentInfo as any)?.isSuperMinion === true
            if (isSuperMinion && this.agentService) {
              const rulesPath = this.agentService.getSuperMinionRulesPath()
              args.push('--system-prompt-file', rulesPath)
            }
          } else if (mode === 'dev') {
            args.push('--permission-mode', 'acceptEdits')
          }

          // Preserve yolo mode (dangerously-skip-permissions)
          if (yolo) {
            args.push('--dangerously-skip-permissions')
          }

          // Preserve chrome flag (default true)
          if (agentInfo?.chrome !== false) {
            args.push('--chrome')
          }
        } else {
          // Create new session with specific ID
          args = this.getClaudeArgs(mode, agentId, prompt, model, yolo, chrome, agentInfo)
          args.push('--session-id', sessionId)
        }
        break
      case 'codex':
        command = 'codex'
        args = this.getCodexArgs(mode, prompt)
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

    // Validate working directory before spawn
    const cwdExists = existsSync(worktreePath)
    let cwdIsDirectory = false
    let cwdStats: any = null
    if (cwdExists) {
      try {
        cwdStats = statSync(worktreePath)
        cwdIsDirectory = cwdStats.isDirectory()
      } catch (statError) {
        console.error('[TerminalService] Failed to stat worktree path:', statError)
      }
    }

    // Validate shell
    const shellExists = existsSync(shell)
    let shellIsExecutable = false
    if (shellExists) {
      try {
        const shellStats = statSync(shell)
        shellIsExecutable = (shellStats.mode & 0o111) !== 0 // Check execute bit
      } catch (statError) {
        console.error('[TerminalService] Failed to stat shell:', statError)
      }
    }

    // Debug logging for spawn issues
    console.log('[TerminalService] Spawning PTY:', {
      shell,
      shellExists,
      shellIsExecutable,
      cwd: worktreePath,
      cwdExists,
      cwdIsDirectory,
      agentId,
      projectPath,
      envVarCount: Object.keys(spawnEnv).length,
      platform: process.platform
    })

    // Pre-validation warnings (don't throw - let spawn handle actual errors)
    if (!cwdExists || !cwdIsDirectory) {
      console.warn('[TerminalService] WARNING: Working directory may not exist or is not a directory:', {
        worktreePath,
        cwdExists,
        cwdIsDirectory
      })
    }

    if (!shellExists || !shellIsExecutable) {
      console.warn('[TerminalService] WARNING: Shell may not exist or is not executable:', {
        shell,
        shellExists,
        shellIsExecutable
      })
    }

    let terminal: pty.IPty
    try {
      terminal = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: worktreePath,
        env: spawnEnv
      })
    } catch (error: any) {
      console.error('[TerminalService] PTY spawn failed:', {
        errorMessage: error?.message,
        errorCode: error?.code,
        errorStack: error?.stack,
        shell,
        cwd: worktreePath,
        cwdExists,
        cwdIsDirectory,
        shellExists,
        shellIsExecutable,
        platform: process.platform,
        nodeVersion: process.version
      })
      throw error
    }

    // State detection: JSONL for Claude, IdleDetector for other tools
    let idleDetector: IdleDetector | undefined
    let statePollingInterval: NodeJS.Timeout | undefined

    if (tool === 'claude' && this.claudeSessionInfoService) {
      // JSONL-based state detection for Claude (more reliable than pattern matching)
      let lastKnownState: 'working' | 'waiting' | 'unknown' = 'unknown'

      // Format display name as "project: branch_suffix" for cleaner notifications
      const projectName = projectPath.split('/').pop() || 'project'
      const branchSuffix = agentInfo?.branch?.split('/').pop() || agentId
      const displayName = `${projectName}: ${branchSuffix}`

      // Extract state check logic for reuse (immediate check + polling)
      const checkAndBroadcastState = () => {
        if (!effectiveSessionId) return

        const currentState = this.claudeSessionInfoService!.getSessionState(effectiveSessionId, worktreePath)

        // Detect state transitions
        if (currentState !== lastKnownState) {
          // Broadcast new state via IPC
          this.mainWindow.webContents.send('agent:stateChanged', agentId, currentState)

          if (currentState === 'waiting') {
            // Transitioned to waiting - send notification and event
            this.mainWindow.webContents.send('agent:waitingForInput', agentId, 'Claude is waiting for input')

            // Send desktop notification
            this.notificationService?.notify({
              title: 'Input Required',
              body: `${displayName} is waiting for your input`,
              agentId
            })

            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: true,
              claudeState: 'waiting',
              claudeLastSeen: new Date().toISOString()
            }).then(() => {
              this.mainWindow.webContents.send('agents:updated')
            }).catch(err => console.error('Failed to update agent info:', err))

          } else if (currentState === 'working') {
            // Transitioned to working - clear waiting state
            console.log(`[TerminalService] ${agentId} is working`)

            // Clear notification cooldown when user provides input
            if (lastKnownState === 'waiting') {
              this.notificationService?.clearCooldown(agentId)
            }

            // Send event for UI updates
            this.mainWindow.webContents.send('agent:resumedWork', agentId)

            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: false,
              claudeState: 'working',
              claudeLastSeen: new Date().toISOString()
            }).then(() => {
              this.mainWindow.webContents.send('agents:updated')
            }).catch(err => console.error('Failed to update agent info:', err))
          }

          lastKnownState = currentState
        }
      }

      // Check state IMMEDIATELY (no delay for fast Claude responses)
      console.log(`[TerminalService] Performing immediate state check for ${agentId}`)
      checkAndBroadcastState()

      // Then poll every 1 second (faster than 2s, still efficient with caching)
      console.log(`[TerminalService] Starting 1s polling for ${agentId} (session: ${effectiveSessionId})`)
      statePollingInterval = setInterval(() => {
        checkAndBroadcastState()
      }, 1000) // 1 second interval - mtime caching makes this efficient

    } else {
      // Pattern-based IdleDetector for non-Claude tools (cursor-cli, codex)
      // Format display name as "project: branch_suffix" for cleaner notifications
      const projectName = projectPath.split('/').pop() || 'project'
      const branchSuffix = agentInfo?.branch?.split('/').pop() || agentId
      const displayName = `${projectName}: ${branchSuffix}`

      // Determine patterns based on tool
      let workingPatterns: RegExp[]
      let idleIndicators: RegExp[]
      let requireStartSignal = false
      let startPattern: RegExp | undefined

      if (tool === 'cursor-cli') {
        // Cursor CLI uses Claude patterns and requires start signal
        workingPatterns = CLAUDE_WORKING_PATTERNS
        idleIndicators = CLAUDE_IDLE_INDICATORS
        requireStartSignal = true
        startPattern = CLAUDE_START_PATTERN
      } else if (tool === 'codex') {
        // Codex uses codex-specific working patterns to detect activity
        workingPatterns = CODEX_WORKING_PATTERNS
        idleIndicators = []
        requireStartSignal = false
      } else {
        // Other tools: no patterns
        workingPatterns = []
        idleIndicators = []
      }

      idleDetector = new IdleDetector(
        {
          workingPatterns,
          idleIndicators,
          idleThreshold: 2000,
          inputGracePeriod: 1000,
          requireStartSignal,
          startPattern
        },
        {
          onWaitingForInput: (_context: string) => {
            this.mainWindow.webContents.send('agent:waitingForInput', agentId, 'Waiting for input')
            // Send desktop notification
            this.notificationService?.notify({
              title: 'Input Required',
              body: `${displayName} is waiting for your input`,
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
      chrome,
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
      const agentInfoUpdate: Partial<AgentInfo> = {
        claudeSessionId: effectiveSessionId,
        claudeSessionActive: true,
        claudeLastSeen: new Date().toISOString(),
        yolo: yolo || false,
        chrome: chrome !== false,
        mode: mode as 'auto' | 'manual' | 'interactive' | 'planning' | 'dev' | 'idle',
        model,
        prompt
      }

      // Store cloud session ID when teleporting (for future teleport-out)
      if (teleportSessionId) {
        agentInfoUpdate.cloudSessionId = teleportSessionId
      }

      await this.updateAgentInfo(worktreePath, agentInfoUpdate)

      // Set up JSONL watcher for super minions to emit updates on task invocation changes
      if ((agentInfo as any)?.isSuperMinion && this.claudeSessionInfoService) {
        this.claudeSessionInfoService.watchSession(effectiveSessionId, worktreePath, () => {
          this.mainWindow.webContents.send('agents:updated')
        })
      }
    }

    // Handle output
    terminal.onData((data) => {
      this.handleOutput(agentId, data)
    })

    // Handle exit
    terminal.onExit((data) => {
      const exitInfo = data ? `exitCode: ${data.exitCode}, signal: ${data.signal}` : 'no exit data'
      console.log(`[TerminalService] Terminal exited for ${agentId} - ${exitInfo}`)

      // Clean up idle detector (legacy, for non-Claude tools)
      session.idleDetector?.dispose()

      // Clean up JSONL state polling (Claude sessions)
      if (session.statePollingInterval) {
        clearInterval(session.statePollingInterval)
      }

      // Clean up JSONL watcher for super minions
      if (tool === 'claude' && effectiveSessionId) {
        this.claudeSessionInfoService?.unwatchSession(effectiveSessionId)
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

  private getClaudeArgs(mode: string, _agentId: string, prompt?: string, model?: string, yolo?: boolean, chrome?: boolean, agentInfo?: any): string[] {
    const args: string[] = []

    // Add model if specified
    if (model) {
      args.push('--model', model)
    }

    // Add chrome flag (default true, only skip if explicitly false)
    if (chrome !== false) {
      args.push('--chrome')
    }

    if (mode === 'planning') {
      // Use Claude's plan permission mode - shows plan before executing
      args.push('--permission-mode', 'plan')

      // For super minions, load the rules file as system prompt
      const isSuperMinion = agentInfo?.isSuperMinion === true
      if (isSuperMinion && this.agentService) {
        // Use absolute path to the bundled rules file
        const rulesPath = this.agentService.getSuperMinionRulesPath()
        args.push('--system-prompt-file', rulesPath)
      }

      if (prompt) {
        let planPrompt: string
        if (isSuperMinion) {
          planPrompt = `BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.

You can spawn as many child agents as needed to complete the task quickly. Maximize parallelism by breaking work into independent subtasks that can run concurrently.`
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

  private getCodexArgs(mode: string, prompt?: string): string[] {
    const args: string[] = []

    // Hardcode model to gpt-5.2-codex as per requirements
    args.push('--model', 'gpt-5.2-codex')

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

    // Check for cloud session ID in output (for teleport support)
    // Pattern: https://claude.ai/code/session_xxx or --teleport session_xxx
    const stripped = stripAnsi(data)
    this.detectAndStoreCloudSessionId(session, stripped)
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

  /**
   * Detect cloud session ID from Claude CLI output and store it in agent info.
   * This enables the "Teleport to Cloud" feature by capturing the session ID
   * when Claude outputs messages like:
   *   - https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B
   *   - --teleport session_01CVbxtiJWp387FoCSvAiS2B
   */
  private detectAndStoreCloudSessionId(session: TerminalSession, strippedOutput: string): void {
    // Only check for cloud session IDs for Claude tool
    if (session.tool !== 'claude') return

    // Pattern to match cloud session ID from various contexts:
    // - URL: https://claude.ai/code/session_xxx
    // - CLI flag: --teleport session_xxx
    // - Plain mention: session_xxx
    const cloudSessionPattern = /session_[a-zA-Z0-9]+/g
    const matches = strippedOutput.match(cloudSessionPattern)

    if (!matches || matches.length === 0) return

    // Use the first match found
    const cloudSessionId = matches[0]

    // Read current agent info to check if we need to update
    this.readAgentInfo(session.worktreePath).then((agentInfo) => {
      // Only update if the cloud session ID is different from what's stored
      if (agentInfo?.cloudSessionId !== cloudSessionId) {
        console.log(`[TerminalService] Detected cloud session ID: ${cloudSessionId} for agent ${session.agentId}`)

        this.updateAgentInfo(session.worktreePath, {
          cloudSessionId
        }).then(() => {
          // Broadcast update so UI can refresh (enables Teleport to Cloud button)
          this.mainWindow.webContents.send('agents:updated')
        }).catch((err) => {
          console.error('Failed to store cloud session ID:', err)
        })
      }
    }).catch((err) => {
      console.error('Failed to read agent info for cloud session detection:', err)
    })
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

    // Determine worktree path (shared logic with startAgent)
    const worktreePath = this.getWorktreePath(projectPath, agentId)

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
