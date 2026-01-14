import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join, resolve } from 'path'
import { existsSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { v5 as uuidv5 } from 'uuid'
import { AgentInfo } from './types/ProjectConfig'
import { AgentService } from './AgentService'
import { ClaudeSessionInfoService } from './ClaudeSessionInfoService'
import { NotificationService } from './NotificationService'
import { WorkflowService } from './WorkflowService'
import {
  IdleDetector,
  CLAUDE_WORKING_PATTERNS,
  CLAUDE_IDLE_INDICATORS,
  CLAUDE_START_PATTERN,
  CODEX_WORKING_PATTERNS,
  SHELL_WORKING_PATTERNS,
  SHELL_IDLE_INDICATORS
} from './IdleDetector'
import { createLogger } from './logger'

const log = createLogger('TerminalService')

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
  private workflowService: WorkflowService | null = null

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

  setWorkflowService(service: WorkflowService): void {
    this.workflowService = service
  }

  private generateSessionId(agentId: string, worktreePath: string): string {
    // Create deterministic UUID from agentId + path
    // This ensures same agent always gets same session ID
    const input = `${agentId}:${worktreePath}`
    return uuidv5(input, this.AGENT_SESSION_NAMESPACE)
  }

  /**
   * Get the rules path for a super minion.
   * Uses dynamic rules from WorkflowService if available, falling back to static rules.
   * Dynamic rules are written to the worktree's minions directory.
   */
  private getSuperMinionRulesPath(projectPath: string, worktreePath: string, agentId: string): string {
    // Try to generate dynamic rules from workflow config
    if (this.workflowService) {
      try {
        const activeWorkflow = this.workflowService.getActiveWorkflow(projectPath)
        const rulesContent = this.workflowService.generateRulesMarkdown(activeWorkflow)

        // Write rules to worktree's minions directory
        const minionsDir = join(worktreePath, 'minions')
        if (!existsSync(minionsDir)) {
          mkdirSync(minionsDir, { recursive: true })
        }

        const rulesPath = join(minionsDir, 'dynamic-rules.md')
        writeFileSync(rulesPath, rulesContent, 'utf-8')

        log.info('Generated dynamic rules for super minion', {
          agentId,
          workflowId: activeWorkflow.id,
          workflowName: activeWorkflow.name,
          rulesPath
        })

        return rulesPath
      } catch (error) {
        log.warn('Failed to generate dynamic rules, falling back to static', error)
      }
    }

    // Fall back to static rules
    if (this.agentService) {
      return this.agentService.getSuperMinionRulesPath()
    }

    throw new Error('Cannot get super minion rules: no AgentService or WorkflowService available')
  }

  /**
   * Generate a concise prompt for a super minion based on its workflow.
   * Preserves the original super minion format but with dynamic workflow phases.
   */
  private generateWorkflowPrompt(projectPath: string, userGoal: string): string {
    if (!this.workflowService) {
      return `Create a plan for: ${userGoal}`
    }

    try {
      const workflow = this.workflowService.getActiveWorkflow(projectPath)
      const subagentTypes = this.workflowService.getSubagentTypes()

      // Debug: log workflow steps to verify custom prompts
      log.info('Generating super minion prompt with workflow:', {
        workflowId: workflow.id,
        workflowName: workflow.name,
        steps: workflow.steps.map(s => ({
          name: s.name,
          agents: s.agents.map(a => ({ typeId: a.typeId, customPrompt: a.customPrompt }))
        }))
      })

      // Build numbered step list
      const phases: string[] = []

      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i]
        const isParallel = step.agents.length > 1

        if (isParallel) {
          // Multiple agents run in parallel - show each with custom prompt if available
          const agentDescriptions = step.agents.map(agent => {
            const type = subagentTypes.find(t => t.id === agent.typeId)
            const name = type?.name || agent.typeId
            if (agent.customPrompt) {
              return `${name}: "${agent.customPrompt}"`
            }
            return name
          }).join(', ')
          phases.push(`${i + 1}. **${step.name}** (PARALLEL: ${agentDescriptions})`)
        } else {
          // Single agent - show custom prompt if available
          const agent = step.agents[0]
          const type = subagentTypes.find(t => t.id === agent.typeId)
          const agentName = type?.name || agent.typeId
          if (agent.customPrompt) {
            phases.push(`${i + 1}. **${step.name}** using ${agentName}: "${agent.customPrompt}"`)
          } else {
            phases.push(`${i + 1}. **${step.name}** using ${agentName} agent`)
          }
        }
      }

      const phaseSummary = phases.join('\n')
      const phaseCount = phases.length

      return `You are a **Super Minion** - an autonomous orchestrator that delivers complex features using Claude Code's Task tool to spawn subagents. You follow a structured ${phaseCount}-phase workflow to ensure quality and alignment with requirements.

## Your Mission

${phaseSummary}

## Core Rules

1. **Delegate to subagents** - Do NOT modify files directly; use Task tool to spawn workers
2. **Agree on criteria first** - Get explicit human approval BEFORE any other work
3. **Use AskUserQuestion** for human input when needed
4. **Maximize parallelism** - Spawn multiple agents in one message when tasks are independent

**CRITICAL: You MUST execute phases in order (1→2→...→${phaseCount}). NEVER skip phases.**

## Your Goal

${userGoal}

Follow the detailed workflow phases defined in your system prompt. Use the Task tool to spawn subagents for each phase.`
    } catch (error) {
      log.warn('Failed to generate workflow prompt, using fallback', error)
      return `Create a plan for: ${userGoal}`
    }
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

    log.debug('getWorktreePath', {
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
      log.warn('AgentService not set, cannot persist state')
      return
    }

    try {
      this.agentService.updateAgentInfo(worktreePath, updates)
    } catch (error) {
      log.error('Failed to update agent info', error)
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
      log.debug(`Cleaning up existing terminal for ${agentId} before starting`)
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
        log.info(`Resuming session ${agentInfo.claudeSessionId} (state: ${sessionState})`)
      } else {
        log.info(`Session ${agentInfo.claudeSessionId} not found in JSONL, creating new`)
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
          log.info(`Teleporting cloud session ${teleportSessionId} for ${agentId}`)
          args = ['--teleport', teleportSessionId]

          // Add model if specified
          if (model) args.push('--model', model)

          // Add permission mode
          if (mode === 'planning') {
            args.push('--permission-mode', 'plan')

            // Add system prompt file for super minions (dynamic rules)
            const isSuperMinion = (agentInfo as any)?.isSuperMinion === true
            if (isSuperMinion) {
              const rulesPath = this.getSuperMinionRulesPath(projectPath, worktreePath, agentId)
              args.push('--system-prompt-file', rulesPath)

              // Lock workflow while super minion is running
              if (this.workflowService) {
                // Workflow locking removed in simplification
              }
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

            // Preserve system prompt file for super minions (dynamic rules)
            const isSuperMinion = (agentInfo as any)?.isSuperMinion === true
            if (isSuperMinion) {
              const rulesPath = this.getSuperMinionRulesPath(projectPath, worktreePath, agentId)
              args.push('--system-prompt-file', rulesPath)

              // Lock workflow while super minion is running
              if (this.workflowService) {
                // Workflow locking removed in simplification
              }
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
          args = this.getClaudeArgs(mode, agentId, prompt, model, yolo, chrome, agentInfo, projectPath, worktreePath)
          args.push('--session-id', sessionId)
        }
        break
      case 'codex':
        command = 'codex'
        args = this.getCodexArgs(mode, prompt, agentInfo, projectPath)
        break
      case 'cursor-cli':
        command = 'cursor'
        args = this.getCursorArgs(mode, agentId, prompt, model, agentInfo, projectPath)
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
        log.error('Failed to stat worktree path', statError)
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
        log.error('Failed to stat shell', statError)
      }
    }

    // Debug logging for spawn issues
    log.debug('Spawning PTY', {
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
      log.warn('Working directory may not exist or is not a directory', {
        worktreePath,
        cwdExists,
        cwdIsDirectory
      })
    }

    if (!shellExists || !shellIsExecutable) {
      log.warn('Shell may not exist or is not executable', {
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
      log.error('PTY spawn failed', {
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
      let displayName = this.formatDisplayName(projectPath, agentInfo, agentId)

      // Late branch detection for teleported sessions
      // Only check if displayBranchName is missing or has fallback format
      let branchDetectionComplete = !!(agentInfo?.displayBranchName && !agentInfo.displayBranchName.startsWith('teleport-'))

      // Try to detect branch from JSONL - runs asynchronously to avoid blocking
      const tryDetectBranch = (): void => {
        if (branchDetectionComplete) return

        // Run detection in next tick to avoid blocking the polling loop
        setImmediate(() => {
          try {
            const detectedBranch = this.claudeSessionInfoService!.extractGitBranch(effectiveSessionId, worktreePath)
            if (!detectedBranch) return

            log.debug(`Late branch detection for ${agentId}: ${detectedBranch}`)
            branchDetectionComplete = true

            const projectName = projectPath.split('/').pop() || 'project'
            const branchSuffix = detectedBranch.split('/').pop() || detectedBranch
            displayName = `${projectName}: ${branchSuffix}`

            this.updateAgentInfo(worktreePath, { displayBranchName: detectedBranch })
              .then(() => this.mainWindow.webContents.send('agents:updated'))
              .catch(err => log.error('Failed to update branch name', err))
          } catch (err) {
            // Silently ignore errors - branch detection is optional
          }
        })
      }

      // Check session state and broadcast changes
      const checkAndBroadcastState = (): void => {
        if (!effectiveSessionId) return

        const currentState = this.claudeSessionInfoService!.getSessionState(effectiveSessionId, worktreePath)

        tryDetectBranch()

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
              claudeLastSeen: new Date().toISOString(),
              waitingSince: new Date().toISOString()
            }).then(() => {
              this.mainWindow.webContents.send('agents:updated')
            }).catch(err => log.error('Failed to update agent info', err))

          } else if (currentState === 'working') {
            // Transitioned to working - clear waiting state
            log.debug(`${agentId} is working`)

            // Clear notification cooldown when user provides input
            if (lastKnownState === 'waiting') {
              this.notificationService?.clearCooldown(agentId)
            }

            // Send event for UI updates
            this.mainWindow.webContents.send('agent:resumedWork', agentId)

            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: false,
              claudeState: 'working',
              claudeLastSeen: new Date().toISOString(),
              waitingSince: undefined
            }).then(() => {
              this.mainWindow.webContents.send('agents:updated')
            }).catch(err => log.error('Failed to update agent info', err))
          }

          lastKnownState = currentState
        }
      }

      // Check state IMMEDIATELY (no delay for fast Claude responses)
      log.debug(`Performing immediate state check for ${agentId}`)
      checkAndBroadcastState()

      // Then poll every 1 second (faster than 2s, still efficient with caching)
      log.debug(`Starting 1s polling for ${agentId} (session: ${effectiveSessionId})`)
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
            }).catch(err => log.error('Failed to update agent info', err))
          },
          onResumedWork: () => {
            this.mainWindow.webContents.send('agent:resumedWork', agentId)
            this.updateAgentInfo(worktreePath, {
              isWaitingForInput: false
            }).catch(err => log.error('Failed to update agent info', err))
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
      log.info(`Terminal exited for ${agentId} - ${exitInfo}`)

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

      // Unlock workflow if this was a super minion
      const isSuperMinion = (agentInfo as any)?.isSuperMinion === true
      if (isSuperMinion && this.workflowService && projectPath) {
        // Workflow unlocking removed in simplification
        log.debug('Unlocked workflow on exit for super minion', { agentId, projectPath })
      }

      // Mark session as inactive on exit
      if (tool === 'claude' && worktreePath) {
        this.updateAgentInfo(worktreePath, { claudeSessionActive: false })
          .catch(err => log.error('Failed to mark session inactive', err))
      }
      this.terminals.delete(agentId)
      this.mainWindow.webContents.send('agents:updated')
    })
  }

  private getClaudeArgs(mode: string, agentId: string, prompt?: string, model?: string, yolo?: boolean, chrome?: boolean, agentInfo?: any, projectPath?: string, worktreePath?: string): string[] {
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

      // For super minions, load the rules file as system prompt (dynamic rules)
      const isSuperMinion = agentInfo?.isSuperMinion === true
      if (isSuperMinion && projectPath && worktreePath) {
        const rulesPath = this.getSuperMinionRulesPath(projectPath, worktreePath, agentId)
        args.push('--system-prompt-file', rulesPath)

        // Lock workflow while super minion is running
        if (this.workflowService) {
          // Workflow locking removed in simplification
        }
      }

      if (prompt) {
        // For super minions, generate workflow-aware prompt
        let planPrompt: string

        if (isSuperMinion && projectPath) {
          planPrompt = this.generateWorkflowPrompt(projectPath, prompt)
        } else {
          planPrompt = `Create a plan for: ${prompt}`
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

  private getCursorArgs(
    mode: string,
    _agentId: string,
    prompt?: string,
    model?: string,
    agentInfo?: any,
    projectPath?: string
  ): string[] {
    // Use 'cursor agent' subcommand
    const args: string[] = ['agent']

    // Add model if specified
    if (model) {
      args.push('--model', model)
    }

    // Add prompt if provided
    if (prompt) {
      if (mode === 'planning') {
        // For super minions, generate workflow-aware prompt
        const isSuperMinion = agentInfo?.isSuperMinion === true
        let planPrompt: string

        if (isSuperMinion && projectPath) {
          planPrompt = this.generateWorkflowPrompt(projectPath, prompt)
        } else {
          planPrompt = `Create a plan for: ${prompt}`
        }

        args.push(`"${planPrompt.replace(/"/g, '\\"')}"`)
      } else {
        args.push(`"${prompt.replace(/"/g, '\\"')}"`)
      }
    }

    return args
  }

  private getCodexArgs(
    mode: string,
    prompt?: string,
    agentInfo?: any,
    projectPath?: string
  ): string[] {
    const args: string[] = []

    // Hardcode model to gpt-5.2-codex as per requirements
    args.push('--model', 'gpt-5.2-codex')

    // Add prompt if provided
    if (prompt) {
      if (mode === 'planning') {
        // For super minions, generate workflow-aware prompt
        const isSuperMinion = agentInfo?.isSuperMinion === true
        let planPrompt: string

        if (isSuperMinion && projectPath) {
          planPrompt = this.generateWorkflowPrompt(projectPath, prompt)
        } else {
          planPrompt = `Create a plan for: ${prompt}`
        }

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
      log.warn(`Resume failed for ${agentId}, attempting fresh start...`)

      // Mark that we're not resuming anymore
      ;(session as any)._attemptingResume = false

      // Clear session state
      if (session.worktreePath) {
        this.updateAgentInfo(session.worktreePath, {
          claudeSessionActive: false,
          claudeSessionId: undefined
        }).catch(err => log.error('Failed to clear session', err))
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
        ).catch(err => log.error(`Failed to restart agent ${agentId}`, err))
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
      // Don't overwrite if cloudSessionId is already set (e.g., from teleport)
      // This prevents conversation history mentioning other session IDs from overwriting the correct one
      if (agentInfo?.cloudSessionId) {
        return // Already has a cloud session ID, don't overwrite
      }

      log.debug(`Detected cloud session ID: ${cloudSessionId} for agent ${session.agentId}`)

      this.updateAgentInfo(session.worktreePath, {
        cloudSessionId
      }).then(() => {
        // Broadcast update so UI can refresh (enables Teleport to Cloud button)
        this.mainWindow.webContents.send('agents:updated')
      }).catch((err) => {
        log.error('Failed to store cloud session ID', err)
      })
    }).catch((err) => {
      log.error('Failed to read agent info for cloud session detection', err)
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

      // Unlock workflow if this was a super minion
      if (this.workflowService && session.projectPath) {
        // Check if agent is a super minion and unlock the workflow
        this.readAgentInfo(session.worktreePath).then((agentInfo) => {
          if ((agentInfo as any)?.isSuperMinion) {
            // Workflow unlocking removed in simplification
            log.debug('Unlocked workflow for super minion', { agentId, projectPath: session.projectPath })
          }
        }).catch(err => {
          log.warn('Failed to check agent info for workflow unlock', err)
        })
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
    log.debug('Starting plain terminal', {
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
      log.error('Failed to spawn plain terminal', {
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

  private readonly MAX_RESUME_ATTEMPTS = 3

  /**
   * Format display name as "project: branch_suffix" for notifications.
   */
  private formatDisplayName(projectPath: string, agentInfo: AgentInfo | null, agentId: string): string {
    const projectName = projectPath.split('/').pop() || 'project'
    const branchSuffix = agentInfo?.branch?.split('/').pop() || agentId
    return `${projectName}: ${branchSuffix}`
  }

  /**
   * Get agent info or throw if not found.
   */
  private async getAgentInfoOrThrow(worktreePath: string): Promise<AgentInfo> {
    const agentInfo = await this.readAgentInfo(worktreePath)
    if (!agentInfo) {
      throw new Error('Agent info not found')
    }
    return agentInfo
  }

  /**
   * Start an agent with standard parameters from agent info.
   */
  private async startAgentFromInfo(projectPath: string, agentId: string, agentInfo: AgentInfo): Promise<void> {
    await this.startAgent(
      projectPath,
      agentId,
      agentInfo.tool || 'claude',
      agentInfo.mode || 'dev',
      agentInfo.prompt,
      agentInfo.model,
      agentInfo.yolo || false,
      agentInfo.chrome !== false
    )
  }

  /**
   * Retry resuming a failed teleport session with exponential backoff.
   * Attempts up to 3 times with delays: 1s, 2s, 4s.
   * Marks session as failed after max attempts.
   */
  async retryResumeSession(projectPath: string, agentId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(projectPath, agentId)
    const agentInfo = await this.getAgentInfoOrThrow(worktreePath)

    const resumeAttempts = agentInfo.resumeAttempts || 0
    const displayName = this.formatDisplayName(projectPath, agentInfo, agentId)

    // Check if max attempts reached
    if (resumeAttempts >= this.MAX_RESUME_ATTEMPTS) {
      const failureMessage = `Max retry attempts (${this.MAX_RESUME_ATTEMPTS}) reached. Session cannot be resumed.`
      log.error(failureMessage)

      if (this.agentService) {
        await this.agentService.markAgentAsFailed(worktreePath, failureMessage)
      }

      this.notificationService?.notifySessionResumeFailed(agentId, displayName, failureMessage)
      this.mainWindow.webContents.send('agent:retryFailed', agentId, {
        reason: failureMessage,
        attempts: resumeAttempts
      })

      throw new Error(failureMessage)
    }

    // Calculate exponential backoff delay: 2^attempt * 1000ms
    const currentAttempt = resumeAttempts + 1
    const delayMs = Math.pow(2, resumeAttempts) * 1000

    log.info(`Retrying resume for ${agentId}, attempt ${currentAttempt}/${this.MAX_RESUME_ATTEMPTS}, delay: ${delayMs}ms`)

    // Update agent info with new attempt count
    await this.updateAgentInfo(worktreePath, {
      resumeAttempts: currentAttempt,
      lastResumeAttempt: new Date().toISOString()
    })

    // Notify UI and desktop
    this.mainWindow.webContents.send('agent:retryingResume', agentId, {
      attempt: currentAttempt,
      maxAttempts: this.MAX_RESUME_ATTEMPTS,
      delayMs
    })
    this.notificationService?.notifySessionResumeRetrying(displayName, currentAttempt, this.MAX_RESUME_ATTEMPTS)

    // Wait for backoff delay
    await new Promise(resolve => setTimeout(resolve, delayMs))

    try {
      await this.startAgentFromInfo(projectPath, agentId, agentInfo)

      // Success - clear failure state
      await this.updateAgentInfo(worktreePath, {
        failureReason: undefined,
        resumeAttempts: 0,
        claudeSessionActive: true
      })

      this.notificationService?.notifySessionResumeSuccess(agentId, displayName)
      this.mainWindow.webContents.send('agent:retrySuccess', agentId)
      this.mainWindow.webContents.send('agents:updated')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`Retry ${currentAttempt} failed for ${agentId}`, errorMessage)

      await this.updateAgentInfo(worktreePath, { failureReason: errorMessage })
      throw error
    }
  }

  /**
   * Start a fresh session in the same worktree, abandoning the old failed session.
   * Creates a new session ID and clears all failure state.
   */
  async startFreshSession(projectPath: string, agentId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(projectPath, agentId)
    const agentInfo = await this.getAgentInfoOrThrow(worktreePath)

    log.info(`Starting fresh session for ${agentId}`)

    // Clear all session-related state
    await this.updateAgentInfo(worktreePath, {
      claudeSessionId: undefined,
      cloudSessionId: undefined,
      claudeSessionActive: false,
      failureReason: undefined,
      resumeAttempts: 0,
      lastResumeAttempt: undefined,
      isTeleportedSession: false
    })

    await this.startAgentFromInfo(projectPath, agentId, agentInfo)

    this.mainWindow.webContents.send('agent:freshSessionStarted', agentId)
    this.mainWindow.webContents.send('agents:updated')
  }
}
