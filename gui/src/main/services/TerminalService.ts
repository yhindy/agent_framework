import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { existsSync, statSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs'
import { execSync, execFileSync } from 'child_process'
import { v5 as uuidv5 } from 'uuid'
import { AgentInfo, isSuperMinion } from './types/ProjectConfig'
import { AgentService } from './AgentService'
import { ClaudeSessionInfoService } from './ClaudeSessionInfoService'
import { NotificationService } from './NotificationService'
import { WorkflowService } from './WorkflowService'
import { SettingsService } from './SettingsService'
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

// Escape a string for use inside double quotes in bash
// Must escape: backslash, double quote, backtick, dollar sign
export function escapeForDoubleQuotes(str: string): string {
  return str
    .replace(/\\/g, '\\\\')  // Backslashes first (so we don't double-escape)
    .replace(/"/g, '\\"')    // Double quotes
    .replace(/`/g, '\\`')    // Backticks (command substitution)
    .replace(/\$/g, '\\$')   // Dollar signs (variable expansion)
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
  statePollingInterval?: NodeJS.Timeout // JSONL-based unified polling for Claude (state + tasks)
  tmuxSession?: string        // Tmux session name (if tmux mode is enabled)
  claudeSessionId?: string    // Claude session ID for cleanup
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
  private settingsService?: SettingsService
  private handoffApiPortGetter: (() => number) | null = null

  // Namespace UUID for agent sessions
  private readonly AGENT_SESSION_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

  // Cached tmux availability check result
  private tmuxAvailable: boolean | null = null

  // Throttle map for broadcast updates (prevents flooding agents:updated)
  private lastAgentBroadcastTime: Map<string, number> = new Map()

  // Guard against concurrent starts for the same agent (race condition prevention)
  private startingAgents: Set<string> = new Set()

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

  setSettingsService(service: SettingsService): void {
    this.settingsService = service
  }

  setHandoffApiPortGetter(getter: () => number): void {
    this.handoffApiPortGetter = getter
  }

  /**
   * Check if tmux is available on the system.
   * Result is cached after first check for performance.
   *
   * When tmux mode is enabled in settings but tmux is not installed,
   * the framework automatically falls back to tabs mode.
   *
   * @returns true if tmux is installed and accessible via PATH
   */
  isTmuxAvailable(): boolean {
    if (this.tmuxAvailable !== null) {
      return this.tmuxAvailable
    }

    try {
      execSync('which tmux', { encoding: 'utf8' })
      this.tmuxAvailable = true
      log.debug('tmux is available')
    } catch {
      this.tmuxAvailable = false
      log.debug('tmux is not available')
    }

    return this.tmuxAvailable
  }

  /**
   * Generate a sanitized tmux session name from an agentId.
   *
   * SECURITY: Only allows alphanumeric characters, hyphens, and underscores.
   * This prevents shell injection attacks when the session name is used in commands.
   *
   * Naming convention: minion-{sanitizedAgentId}
   *
   * @example
   * getTmuxSessionName('agent-1') // returns 'minion-agent-1'
   * getTmuxSessionName('myproject-5') // returns 'minion-myproject-5'
   * getTmuxSessionName('agent/with:special.chars') // returns 'minion-agent_with_special_chars'
   * getTmuxSessionName('evil;rm -rf /') // returns 'minion-evil_rm__rf__'
   */
  getTmuxSessionName(agentId: string): string {
    // SECURITY: Only allow alphanumeric, hyphens, and underscores to prevent shell injection
    const sanitized = agentId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return `minion-${sanitized}`
  }

  /**
   * Kill a tmux session if it exists.
   *
   * Called during agent stop, teardown, and app cleanup.
   * Silently ignores if the session doesn't exist or tmux is unavailable.
   */
  killTmuxSession(agentId: string): void {
    const sessionName = this.getTmuxSessionName(agentId)

    try {
      // SECURITY: Use execFileSync with argument array to prevent command injection
      execFileSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8', stdio: 'pipe' })
      log.debug(`Killed tmux session: ${sessionName}`)
    } catch {
      log.debug(`Tmux session ${sessionName} does not exist or already killed`)
    }
  }

  /**
   * Check if a tmux session exists and is already attached.
   * Prevents detaching sessions in other windows when using tmux mode.
   *
   * @param sessionName - The tmux session name to check
   * @returns true if the session exists and is attached, false otherwise
   */
  isTmuxSessionAttached(sessionName: string): boolean {
    if (!this.isTmuxAvailable()) {
      return false
    }

    try {
      const output = execSync(
        `tmux list-sessions -F "#{session_name}:#{session_attached}" 2>/dev/null`,
        { encoding: 'utf8' }
      )

      const lines = output.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        const [name, attached] = line.split(':')
        if (name === sessionName && attached === '1') {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Check if a tmux session exists (regardless of attachment status).
   */
  tmuxSessionExists(sessionName: string): boolean {
    if (!this.isTmuxAvailable()) {
      return false
    }

    try {
      // SECURITY: Use execFileSync with argument array to prevent command injection
      execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if Claude is running inside a tmux session.
   *
   * This is used to detect orphaned tmux sessions that exist but don't have
   * Claude running in them (e.g., from a crash, force-quit, or previous session).
   *
   * @param sessionName - The tmux session name to check
   * @returns true if a process containing "claude" is running in the session
   */
  isClaudeRunningInTmux(sessionName: string): boolean {
    if (!this.isTmuxAvailable()) {
      return false
    }

    try {
      // Get the pane PID from the tmux session
      const panePidOutput = execFileSync(
        'tmux',
        ['list-panes', '-t', sessionName, '-F', '#{pane_pid}'],
        { encoding: 'utf8', stdio: 'pipe' }
      )

      const panePids = panePidOutput.trim().split('\n').filter(Boolean)
      if (panePids.length === 0) {
        return false
      }

      // Get all processes with their PIDs, PPIDs, and commands
      // This approach works reliably on both macOS and Linux
      const psOutput = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,comm='], {
        encoding: 'utf8',
        stdio: 'pipe'
      })

      // Build a map of parent -> children for tree traversal
      const processes: Array<{ pid: number; ppid: number; comm: string }> = []
      for (const line of psOutput.trim().split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
        if (match) {
          processes.push({
            pid: parseInt(match[1], 10),
            ppid: parseInt(match[2], 10),
            comm: match[3].trim()
          })
        }
      }

      // Build parent -> children map
      const childrenMap = new Map<number, number[]>()
      for (const proc of processes) {
        const siblings = childrenMap.get(proc.ppid) || []
        siblings.push(proc.pid)
        childrenMap.set(proc.ppid, siblings)
      }

      // Create a map of pid -> command for quick lookup
      const commMap = new Map<number, string>()
      for (const proc of processes) {
        commMap.set(proc.pid, proc.comm)
      }

      // Check if any process in the subtree of each pane PID is claude
      const hasClaudeInSubtree = (pid: number, visited: Set<number>): boolean => {
        if (visited.has(pid)) return false
        visited.add(pid)

        const comm = commMap.get(pid) || ''
        if (comm.toLowerCase().includes('claude')) {
          return true
        }

        const children = childrenMap.get(pid) || []
        for (const childPid of children) {
          if (hasClaudeInSubtree(childPid, visited)) {
            return true
          }
        }
        return false
      }

      for (const panePid of panePids) {
        const pid = parseInt(panePid, 10)
        if (hasClaudeInSubtree(pid, new Set())) {
          return true
        }
      }

      return false
    } catch (error) {
      log.debug(`Failed to check if Claude is running in tmux session ${sessionName}`, error)
      return false
    }
  }

  /**
   * Kill orphaned minion-* tmux sessions.
   *
   * Called on app startup to clean up sessions left behind from crashes,
   * force-quits, or abnormal terminations.
   *
   * Only kills sessions that:
   * 1. Match our pattern (minion-*)
   * 2. Are NOT currently attached (another window may be using them)
   * 3. Do NOT have a corresponding active agent
   *
   * @param activeAgentIds - List of agent IDs that are currently active. Sessions
   *                         for these agents will be preserved.
   * @returns number of sessions killed
   */
  killOrphanedTmuxSessions(activeAgentIds: string[]): number {
    if (!this.isTmuxAvailable()) {
      return 0
    }

    try {
      const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' })
      const sessions = output.trim().split('\n').filter(Boolean).filter(s => s.startsWith('minion-'))

      if (sessions.length === 0) {
        log.debug('No minion tmux sessions found')
        return 0
      }

      log.info(`Found ${sessions.length} minion tmux sessions, checking for orphans`)

      // Build a set of expected session names from active agents
      const activeSessionNames = new Set(activeAgentIds.map(id => this.getTmuxSessionName(id)))

      let killed = 0
      let skipped = 0
      for (const sessionName of sessions) {
        // Skip sessions that belong to active agents
        if (activeSessionNames.has(sessionName)) {
          log.debug(`Skipping session for active agent: ${sessionName}`)
          skipped++
          continue
        }

        // Skip sessions that are currently attached (another window is using them)
        if (this.isTmuxSessionAttached(sessionName)) {
          log.debug(`Skipping attached session: ${sessionName}`)
          skipped++
          continue
        }

        try {
          log.debug(`Killing orphaned tmux session: ${sessionName}`)
          // SECURITY: Use execFileSync with argument array to prevent command injection
          execFileSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8', stdio: 'pipe' })
          killed++
        } catch {
          log.debug(`Failed to kill tmux session: ${sessionName}`)
        }
      }

      if (killed > 0) {
        log.info(`Cleaned up ${killed} orphaned minion tmux sessions (${skipped} sessions preserved)`)
      } else if (skipped > 0) {
        log.info(`No orphaned sessions to clean up (${skipped} sessions preserved)`)
      }
      return killed
    } catch {
      // tmux list-sessions fails if no server is running
      log.debug('No tmux server running or no sessions to clean up')
      return 0
    }
  }

  /**
   * Check if tmux mode should be used based on settings and availability.
   *
   * Tmux mode is used when BOTH conditions are met:
   * 1. Settings have terminal.terminalMode set to 'tmux'
   * 2. Tmux is installed and available on the system
   *
   * If either condition is not met, falls back to tabs mode.
   *
   * @returns true if tmux mode should be used for agent terminals
   */
  private shouldUseTmux(): boolean {
    const settings = this.settingsService?.getSettings()
    const terminalMode = settings?.terminal?.terminalMode ?? 'tabs'
    const tmuxAvailable = this.isTmuxAvailable()

    log.debug('shouldUseTmux check', {
      hasSettingsService: !!this.settingsService,
      terminalMode,
      tmuxAvailable,
      result: terminalMode === 'tmux' && tmuxAvailable
    })

    return terminalMode === 'tmux' && tmuxAvailable
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

    // Check if the agent has a workingDirectory set (non-git agents).
    // If so, use it directly instead of computing a git worktree path.
    if (this.agentService) {
      const agentInfo = this.agentService.readAgentInfo(projectPath, agentId, projectPath)
      if (agentInfo?.workingDirectory) {
        log.debug('getWorktreePath: using workingDirectory from agent info', {
          projectPath,
          agentId,
          workingDirectory: agentInfo.workingDirectory
        })
        return resolve(agentInfo.workingDirectory)
      }
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

  private async updateAgentInfo(worktreePath: string, updates: Partial<AgentInfo>, agentId?: string, projectPath?: string): Promise<void> {
    if (!this.agentService) {
      log.warn('AgentService not set, cannot persist state')
      return
    }

    try {
      this.agentService.updateAgentInfo(worktreePath, updates, agentId, projectPath)
    } catch (error) {
      log.error('Failed to update agent info', error)
      throw error
    }
  }

  /**
   * Safely dispose of a resource with error suppression.
   * Used for cleanup operations where failures should not propagate.
   */
  private safeDispose(disposeFn: () => void, resourceName: string, context: string): void {
    try {
      disposeFn()
    } catch (error) {
      log.debug(`Failed to dispose ${resourceName} for ${context}`, error)
    }
  }

  /**
   * Safely send IPC message with error suppression.
   * Used in cleanup paths where IPC failures should not propagate.
   */
  private safeSendIPC(channel: string, ...args: unknown[]): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args)
      }
    } catch (error) {
      log.debug(`Failed to send IPC on ${channel}`, error)
    }
  }

  /**
   * Check if an agents:updated broadcast should be allowed for this agent.
   * Throttles broadcasts to max once per 500ms per agent to prevent flooding.
   *
   * @param agentId - The agent ID to check throttle for
   * @returns true if broadcast is allowed, false if throttled
   */
  private shouldBroadcastUpdate(agentId: string): boolean {
    const now = Date.now()
    const lastTime = this.lastAgentBroadcastTime.get(agentId) || 0
    if (now - lastTime < 500) {
      return false
    }
    this.lastAgentBroadcastTime.set(agentId, now)
    return true
  }

  /**
   * Broadcast agents:updated with throttling.
   * Only broadcasts if 500ms has passed since last broadcast for this agent.
   */
  private throttledBroadcastUpdate(agentId: string): void {
    if (this.shouldBroadcastUpdate(agentId)) {
      this.safeSendIPC('agents:updated')
    }
  }

  /**
   * Update agent info and notify UI on success.
   * Uses throttled broadcast to prevent flooding agents:updated.
   * Logs error on failure without throwing.
   *
   * @param worktreePath - Path to the agent's worktree
   * @param updates - Partial agent info updates
   * @param agentId - Optional agent ID for throttling (if not provided, broadcasts immediately)
   */
  private async updateAgentInfoAndNotify(worktreePath: string, updates: Partial<AgentInfo>, agentId?: string, projectPath?: string): Promise<void> {
    try {
      await this.updateAgentInfo(worktreePath, updates, agentId, projectPath)
      if (agentId) {
        this.throttledBroadcastUpdate(agentId)
      } else {
        this.safeSendIPC('agents:updated')
      }
    } catch (error) {
      log.error('Failed to update agent info', error)
    }
  }

  /**
   * Clean up all resources for a terminal session.
   * Safely disposes idle detector, polling intervals, tmux sessions, and PTY.
   *
   * @param agentId - The agent ID
   * @param session - The terminal session to clean up
   * @param tool - The tool type (claude, cursor-cli, etc.)
   * @param effectiveSessionId - Optional session ID for Claude session cleanup
   * @param killTmuxSession - Whether to kill the tmux session (default: true).
   *                          Set to false on window close to preserve sessions for other windows.
   */
  private cleanupTerminalSession(
    agentId: string,
    session: TerminalSession,
    tool: string,
    effectiveSessionId?: string,
    killTmuxSession: boolean = true
  ): void {
    const { idleDetector, statePollingInterval, tmuxSession, pty } = session

    this.safeDispose(() => idleDetector?.dispose(), 'idle detector', agentId)
    this.safeDispose(() => statePollingInterval && clearInterval(statePollingInterval), 'polling interval', agentId)

    if (tool === 'claude' && effectiveSessionId) {
      this.safeDispose(
        () => this.claudeSessionInfoService?.unwatchSession(effectiveSessionId),
        'session watcher',
        agentId
      )
    }

    if (tmuxSession && killTmuxSession) {
      this.killTmuxSession(agentId)
    }

    this.safeDispose(() => pty.kill(), 'PTY', agentId)
  }

  /**
   * Clean up a plain terminal session.
   * Safely disposes idle detector and PTY.
   */
  private cleanupPlainTerminalSession(terminalId: string, session: PlainTerminalSession): void {
    this.safeDispose(() => session.idleDetector?.dispose(), 'idle detector', terminalId)
    this.safeDispose(() => session.pty.kill(), 'PTY', terminalId)
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
    // Prevent concurrent starts for the same agent (race condition guard)
    if (this.startingAgents.has(agentId)) {
      log.warn(`Agent ${agentId} is already being started, skipping duplicate start`)
      return
    }
    this.startingAgents.add(agentId)

    try {
      await this._startAgentInternal(projectPath, agentId, tool, mode, prompt, model, yolo, chrome, teleportSessionId)
    } finally {
      this.startingAgents.delete(agentId)
    }
  }

  private async _startAgentInternal(
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

    // Check if tmux session already exists - we'll attach to it instead of spawning new Claude
    // NEW: If Claude is NOT running but tmux exists, still attach (so user sees the shell)
    let attachToExistingTmux = false
    let attachToOrphanedTmux = false // Tmux exists but Claude crashed/exited
    const useTmux = this.shouldUseTmux()
    if (useTmux) {
      const tmuxSessionName = this.getTmuxSessionName(agentId)
      const sessionExists = this.tmuxSessionExists(tmuxSessionName)
      log.info(`[startAgent] agent=${agentId} tmuxSession=${tmuxSessionName} exists=${sessionExists}`)
      if (sessionExists) {
        const isClaudeRunning = this.isClaudeRunningInTmux(tmuxSessionName)
        if (isClaudeRunning) {
          log.info(`Attaching to existing tmux session ${tmuxSessionName} with running Claude`)
          attachToExistingTmux = true
        } else {
          log.warn(`Tmux session ${tmuxSessionName} exists but Claude not running - attaching to shell only`)
          attachToOrphanedTmux = true
          // Don't kill the session - attach to it so user can see what happened
          // Update agent state to reflect Claude is not running
          await this.updateAgentInfo(worktreePath, { claudeSessionActive: false }, agentId, projectPath)
        }
      }
    } else {
      log.info(`[startAgent] agent=${agentId} NOT using tmux mode`)
    }

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

            // Add system prompt file for super minions
            if (agentInfo && isSuperMinion(agentInfo)) {
              const rulesPath = this.getSuperMinionRulesPath(projectPath, worktreePath, agentId)
              args.push('--system-prompt-file', rulesPath)
            }
          } else if (mode === 'dev') {
            args.push('--permission-mode', 'acceptEdits')
          }

          // Always skip permissions for teleport to bypass interactive prompts
          args.push('--dangerously-skip-permissions')

          if (chrome !== false) {
            args.push('--chrome')
          }
        } else if (isResume) {
          // Resume existing session
          args = ['--resume', agentInfo!.claudeSessionId!]

          if (model) args.push('--model', model)

          if (mode === 'planning') {
            args.push('--permission-mode', 'plan')

            if (agentInfo && isSuperMinion(agentInfo)) {
              const rulesPath = this.getSuperMinionRulesPath(projectPath, worktreePath, agentId)
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
    if (this.handoffApiPortGetter) {
      spawnEnv.MINION_API_PORT = String(this.handoffApiPortGetter())
    }

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

    log.debug('Spawning PTY', { shell, cwd: worktreePath, agentId })

    if (!cwdExists || !cwdIsDirectory) {
      log.warn('Working directory may not exist or is not a directory', { worktreePath, cwdExists, cwdIsDirectory })
    }

    if (!shellExists || !shellIsExecutable) {
      log.warn('Shell may not exist or is not executable', { shell, shellExists, shellIsExecutable })
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
          void (async () => {
            try {
              const detectedBranch = await this.claudeSessionInfoService!.extractGitBranch(effectiveSessionId, worktreePath)
              if (!detectedBranch) return

              log.debug(`Late branch detection for ${agentId}: ${detectedBranch}`)
              branchDetectionComplete = true

              const projectName = projectPath.split('/').pop() || 'project'
              const branchSuffix = detectedBranch.split('/').pop() || detectedBranch
              displayName = `${projectName}: ${branchSuffix}`

              this.updateAgentInfoAndNotify(worktreePath, { displayBranchName: detectedBranch }, agentId, projectPath)
            } catch (err) {
              // Silently ignore errors - branch detection is optional
            }
          })()
        })
      }

      // Track state for change detection
      const isSuperMinionAgent = agentInfo && isSuperMinion(agentInfo)
      let lastTaskHash = ''

      // Handle state transition and persist updates
      const handleStateTransition = (newState: 'working' | 'waiting', previousState: 'working' | 'waiting' | 'unknown'): void => {
        this.safeSendIPC('agent:stateChanged', agentId, newState)

        if (newState === 'waiting') {
          this.safeSendIPC('agent:waitingForInput', agentId, 'Claude is waiting for input')
          this.notificationService?.notify({
            title: 'Input Required',
            body: `${displayName} is waiting for your input`,
            agentId
          })
          this.updateAgentInfoAndNotify(worktreePath, {
            isWaitingForInput: true,
            claudeState: 'waiting',
            claudeLastSeen: new Date().toISOString(),
            waitingSince: new Date().toISOString()
          }, agentId, projectPath)
        } else {
          log.debug(`${agentId} is working`)
          if (previousState === 'waiting') {
            this.notificationService?.clearCooldown(agentId)
          }
          this.safeSendIPC('agent:resumedWork', agentId)
          this.updateAgentInfoAndNotify(worktreePath, {
            isWaitingForInput: false,
            claudeState: 'working',
            claudeLastSeen: new Date().toISOString(),
            waitingSince: undefined
          }, agentId, projectPath)
        }
      }

      // State polling using lightweight tail-based method (reads only last 50KB, not entire file)
      // For super minions, we also check task invocations but only when file changes
      let lastTaskCheckMtime = 0

      const checkAndBroadcastState = async (): Promise<void> => {
        if (!effectiveSessionId) return

        // PERFORMANCE: Use lightweight getSessionState which only reads last 50KB of file
        // instead of parseSessionInfo which streams the entire file (can be 700MB+)
        // 50KB is enough to capture AskUserQuestion/ExitPlanMode entries followed by other entries
        const currentState = this.claudeSessionInfoService!.getSessionState(effectiveSessionId, worktreePath)

        tryDetectBranch()

        // Handle state transitions
        if (currentState !== lastKnownState && (currentState === 'working' || currentState === 'waiting')) {
          handleStateTransition(currentState, lastKnownState)
          lastKnownState = currentState
        }

        // For super minions: check task invocations only when file has changed
        // to avoid expensive full-file parsing on every poll
        if (isSuperMinionAgent) {
          const sessionFile = this.claudeSessionInfoService!.findSessionFile(effectiveSessionId, worktreePath)
          if (sessionFile) {
            try {
              const stat = statSync(sessionFile)
              if (stat.mtimeMs !== lastTaskCheckMtime) {
                lastTaskCheckMtime = stat.mtimeMs
                // File changed - parse full session for task invocations
                const sessionInfo = await this.claudeSessionInfoService!.parseSessionInfo(effectiveSessionId, worktreePath)
                if (sessionInfo) {
                  const currentHash = sessionInfo.taskInvocations
                    .map(t => `${t.toolUseId}:${t.status}`)
                    .join('|')
                  if (currentHash !== lastTaskHash) {
                    lastTaskHash = currentHash
                    // Use throttled broadcast to prevent flooding
                    this.throttledBroadcastUpdate(agentId)
                  }
                }
              }
            } catch {
              // Ignore stat errors
            }
          }
        }
      }

      // Immediate check for fast Claude responses, then poll every 2s
      log.debug(`Starting state polling for ${agentId} (session: ${effectiveSessionId})`)
      void checkAndBroadcastState()

      statePollingInterval = setInterval(() => void checkAndBroadcastState(), 2000)

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
            this.safeSendIPC('agent:waitingForInput', agentId, 'Waiting for input')
            this.notificationService?.notify({
              title: 'Input Required',
              body: `${displayName} is waiting for your input`,
              agentId
            })
            this.updateAgentInfo(worktreePath, { isWaitingForInput: true }, agentId, projectPath)
              .catch(err => log.error('Failed to update agent info', err))
          },
          onResumedWork: () => {
            this.safeSendIPC('agent:resumedWork', agentId)
            this.updateAgentInfo(worktreePath, { isWaitingForInput: false }, agentId, projectPath)
              .catch(err => log.error('Failed to update agent info', err))
          }
        }
      )
    }

    // Get tmux session name (useTmux is already determined above)
    let tmuxSessionName: string | undefined
    if (useTmux) {
      tmuxSessionName = this.getTmuxSessionName(agentId)
      log.debug(`Using tmux mode with session: ${tmuxSessionName}`)
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
      statePollingInterval,
      tmuxSession: tmuxSessionName,
      claudeSessionId: effectiveSessionId
    }

    // Mark if we're attempting to resume (for error detection)
    if (isResume) {
      (session as any)._attemptingResume = true
    }

    this.terminals.set(agentId, session)

    // Send the command to the terminal
    if (!useTmux || !tmuxSessionName) {
      terminal.write(`${command} ${args.join(' ')}\r`)
    } else if (attachToExistingTmux || attachToOrphanedTmux) {
      const reason = attachToOrphanedTmux ? '(orphaned - Claude not running)' : '(Claude running)'
      log.info(`Attaching to existing tmux session: ${tmuxSessionName} ${reason}`)
      setTimeout(() => {
        terminal.write(`tmux attach-session -t ${tmuxSessionName} || (echo "Failed to attach to tmux session ${tmuxSessionName}. Starting fallback shell..." && bash)\r`)
      }, 100)
    } else {
      // Create new tmux session and run the command
      const rawCommand = `${command} ${args.join(' ')}`
      const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9-_]/g, '_')
      const tempDir = mkdtempSync(join(tmpdir(), 'minion-'))
      const scriptPath = join(tempDir, `cmd-${sanitizedAgentId}.sh`)

      setTimeout(() => {
        try {
          writeFileSync(scriptPath, `#!/bin/bash\n${rawCommand}\n`, { mode: 0o700 })
          log.debug(`Wrote tmux command script to ${scriptPath}`)

          const tmuxCmd = `tmux new-session -A -s ${tmuxSessionName} \\; send-keys 'bash ${scriptPath}' Enter \\; new-window -d -n shell`
          terminal.write(`${tmuxCmd}\r`)
        } catch (err) {
          log.error('Failed to write command script, falling back to direct command', err)
          const escapedCommand = rawCommand.replace(/'/g, "'\\''").replace(/\n/g, ' ')
          const tmuxCmd = `tmux new-session -A -s ${tmuxSessionName} \\; send-keys '${escapedCommand}' Enter \\; new-window -d -n shell`
          terminal.write(`${tmuxCmd}\r`)
        }
      }, 100)
    }

    // Persist session ID and flags (skip if attaching to existing session)
    // For orphaned sessions, we already marked claudeSessionActive: false above
    if (tool === 'claude' && !attachToExistingTmux && !attachToOrphanedTmux) {
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

      if (teleportSessionId) {
        agentInfoUpdate.cloudSessionId = teleportSessionId
      }

      await this.updateAgentInfo(worktreePath, agentInfoUpdate, agentId, projectPath)

      // JSONL watcher for super minions
      if (agentInfo && isSuperMinion(agentInfo) && this.claudeSessionInfoService) {
        this.claudeSessionInfoService.watchSession(effectiveSessionId, worktreePath, () => {
          this.throttledBroadcastUpdate(agentId)
        })
      }
    }

    terminal.onData((data) => {
      this.handleOutput(agentId, data)
    })

    terminal.onExit((data) => {
      log.info(`Terminal exited for ${agentId} - ${data ? `exitCode: ${data.exitCode}, signal: ${data.signal}` : 'no exit data'}`)

      // Don't kill tmux session on PTY exit - user may have detached or session may be used by other windows
      this.cleanupTerminalSession(agentId, session, tool, effectiveSessionId, false)

      if (tool === 'claude') {
        this.updateAgentInfo(worktreePath, { claudeSessionActive: false }, agentId, projectPath)
          .catch(err => log.error('Failed to mark session inactive', err))
      }

      this.terminals.delete(agentId)
      // MEMORY FIX: Clean up broadcast throttling map entry
      this.lastAgentBroadcastTime.delete(agentId)
      this.safeSendIPC('agents:updated')
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

      const isSuperMinion = agentInfo?.isSuperMinion === true
      if (isSuperMinion && projectPath && worktreePath) {
        const rulesPath = this.getSuperMinionRulesPath(projectPath, worktreePath, agentId)
        args.push('--system-prompt-file', rulesPath)
      }

      if (prompt) {
        const planPrompt = (isSuperMinion && projectPath)
          ? this.generateWorkflowPrompt(projectPath, prompt)
          : `Create a plan for: ${prompt}`
        args.push(`"${escapeForDoubleQuotes(planPrompt)}"`)
      }
    } else if (mode === 'dev') {
      args.push('--permission-mode', 'acceptEdits')
      if (prompt) {
        args.push(`"${escapeForDoubleQuotes(prompt)}"`)
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

        args.push(`"${escapeForDoubleQuotes(planPrompt)}"`)
      } else {
        args.push(`"${escapeForDoubleQuotes(prompt)}"`)
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

        args.push(`"${escapeForDoubleQuotes(planPrompt)}"`)
      } else {
        args.push(`"${escapeForDoubleQuotes(prompt)}"`)
      }
    }

    return args
  }

  private handleOutput(agentId: string, data: string): void {
    const session = this.terminals.get(agentId)
    if (!session) return

    this.safeSendIPC('terminal:output', agentId, data)

    const stripped = stripAnsi(data)
    this.detectAndStoreCloudSessionId(session, stripped)

    if (this.handleResumeFailure(session, agentId, stripped)) return

    session.idleDetector?.processOutput(data)
  }

  /**
   * Handle resume failure detection and recovery.
   * Returns true if resume failure was detected and handled.
   */
  private handleResumeFailure(session: TerminalSession, agentId: string, strippedOutput: string): boolean {
    if (!(session as any)._attemptingResume) return false

    const resumeFailurePatterns = ['Session not found', 'Could not resume', 'Error resuming session']
    const hasFailure = resumeFailurePatterns.some(pattern => strippedOutput.includes(pattern))
    if (!hasFailure) return false

    log.warn(`Resume failed for ${agentId}, attempting fresh start...`)
    ;(session as any)._attemptingResume = false

    if (session.worktreePath) {
      this.updateAgentInfo(session.worktreePath, {
        claudeSessionActive: false,
        claudeSessionId: undefined
      }, agentId, session.projectPath).catch(err => log.error('Failed to clear session', err))
    }

    // Clean up all resources but preserve tmux session (killTmux=false).
    // User may restart the agent, and tmux sessions persist across restarts.
    this.cleanupTerminalSession(agentId, session, session.tool, session.claudeSessionId, false)
    this.terminals.delete(agentId)

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

    return true
  }

  /**
   * Detect cloud session ID from Claude CLI output and store it in agent info.
   * Enables "Teleport to Cloud" by capturing session_xxx from CLI output.
   */
  private detectAndStoreCloudSessionId(session: TerminalSession, strippedOutput: string): void {
    if (session.tool !== 'claude') return

    const matches = strippedOutput.match(/session_[a-zA-Z0-9]+/g)
    if (!matches?.length) return

    const cloudSessionId = matches[0]

    this.readAgentInfo(session.worktreePath)
      .then(async (agentInfo) => {
        if (agentInfo?.cloudSessionId) return

        log.debug(`Detected cloud session ID: ${cloudSessionId} for agent ${session.agentId}`)
        await this.updateAgentInfoAndNotify(session.worktreePath, { cloudSessionId }, session.agentId)
      })
      .catch(err => log.error('Failed to detect/store cloud session ID', err))
  }

  stopAgent(agentId: string): void {
    const session = this.terminals.get(agentId)
    if (!session) return

    this.cleanupTerminalSession(agentId, session, session.tool, session.claudeSessionId)
    this.terminals.delete(agentId)
    this.lastAgentBroadcastTime.delete(agentId)
    this.safeSendIPC('agents:updated')
  }

  sendInput(agentId: string, data: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      // Record input to idle detector (handles grace period and state clearing)
      session.idleDetector?.recordInput()
      session.pty.write(data)

      // For Claude agents: immediately signal "working" state when user sends input
      // This provides instant feedback before the JSONL poll detects the change
      // The data check filters out control sequences (resize, etc.) that aren't real user input
      if (session.tool === 'claude' && data.length > 0 && !data.startsWith('\x1b')) {
        this.safeSendIPC('agent:stateChanged', agentId, 'working')
      }
    }
  }

  resize(agentId: string, cols: number, rows: number): void {
    const session = this.terminals.get(agentId)
    if (!session) return

    session.pty.resize(cols, rows)

    if (session.tmuxSession) {
      this.resizeTmuxWindows(session.tmuxSession, cols, rows)
    }
  }

  /**
   * Refresh terminal output by sending Ctrl+L to clear and redraw the screen.
   * This is useful when attaching to an existing tmux session where the initial
   * screen content may not have been captured in the output cache.
   *
   * Only operates on tmux sessions to avoid unexpected behavior in non-tmux terminals.
   *
   * @param agentId - The agent ID whose terminal should be refreshed
   */
  refreshTerminal(agentId: string): void {
    const session = this.terminals.get(agentId)
    if (!session) {
      log.debug(`Cannot refresh terminal for ${agentId}: no active session`)
      return
    }

    if (!session.tmuxSession) {
      log.debug(`Skipping refresh for ${agentId}: not a tmux session`)
      return
    }

    log.debug(`Refreshing terminal for ${agentId}`)
    session.pty.write('\x0c')
  }

  private resizeTmuxWindows(sessionName: string, cols: number, rows: number): void {
    const adjustedRows = Math.max(1, rows - 1)
    // SECURITY: Use execFileSync with argument arrays to prevent command injection
    // Ignore errors (window may not exist yet)
    try {
      execFileSync('tmux', ['resize-window', '-t', `${sessionName}:0`, '-x', String(cols), '-y', String(adjustedRows)], { stdio: 'pipe' })
    } catch {
      // Window 0 may not exist yet
    }
    try {
      execFileSync('tmux', ['resize-window', '-t', `${sessionName}:1`, '-x', String(cols), '-y', String(adjustedRows)], { stdio: 'pipe' })
    } catch {
      // Window 1 may not exist yet
      log.debug(`Failed to resize tmux windows for ${sessionName}`)
    }
  }

  cleanup(): void {
    for (const [agentId, session] of this.terminals) {
      try {
        // Don't kill tmux sessions on app close - they may be attached to another window
        // or the user may want them to keep running in the background
        this.cleanupTerminalSession(agentId, session, session.tool, session.claudeSessionId, false)
        this.terminals.delete(agentId)
      } catch (error) {
        log.error(`Cleanup failed for agent ${agentId}`, error)
      }
    }

    for (const [terminalId, session] of this.plainTerminals) {
      try {
        this.cleanupPlainTerminalSession(terminalId, session)
        this.plainTerminals.delete(terminalId)
      } catch (error) {
        log.error(`Cleanup failed for plain terminal ${terminalId}`, error)
      }
    }

    this.lastAgentBroadcastTime.clear()
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

    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

    log.debug('Starting plain terminal', { fullTerminalId, shell, cwd: worktreePath })

    // Create clean environment for node-pty (filter to own string properties)
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
      log.error('Failed to spawn plain terminal', { shell, cwd: worktreePath, error })
      throw new Error(`Failed to spawn terminal shell "${shell}": ${error instanceof Error ? error.message : String(error)}`)
    }

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
          this.safeSendIPC('plainTerminal:waitingForInput', fullTerminalId, 'Terminal is waiting for input')
        },
        onResumedWork: () => {
          this.safeSendIPC('plainTerminal:resumedWork', fullTerminalId)
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

    terminal.onData((data) => {
      this.safeSendIPC('plainTerminal:output', fullTerminalId, data)
      idleDetector.processOutput(data)
    })

    terminal.onExit(() => {
      this.cleanupPlainTerminalSession(fullTerminalId, session)
      this.plainTerminals.delete(fullTerminalId)
    })
  }

  stopPlainTerminal(terminalId: string): void {
    const session = this.plainTerminals.get(terminalId)
    if (!session) return

    this.cleanupPlainTerminalSession(terminalId, session)
    this.plainTerminals.delete(terminalId)
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

    if (resumeAttempts >= this.MAX_RESUME_ATTEMPTS) {
      await this.handleMaxRetriesReached(worktreePath, agentId, projectPath, agentInfo)
      throw new Error(`Max retry attempts (${this.MAX_RESUME_ATTEMPTS}) reached`)
    }

    await this.attemptResumeWithBackoff(projectPath, agentId, worktreePath, agentInfo, resumeAttempts)
  }

  private async handleMaxRetriesReached(worktreePath: string, agentId: string, projectPath: string, agentInfo: AgentInfo): Promise<void> {
    const failureMessage = `Max retry attempts (${this.MAX_RESUME_ATTEMPTS}) reached. Session cannot be resumed.`
    log.error(failureMessage)

    await this.agentService?.markAgentAsFailed(worktreePath, failureMessage, agentId, projectPath)

    const displayName = this.formatDisplayName(projectPath, agentInfo, agentId)
    this.notificationService?.notifySessionResumeFailed(agentId, displayName, failureMessage)
    this.safeSendIPC('agent:retryFailed', agentId, {
      reason: failureMessage,
      attempts: this.MAX_RESUME_ATTEMPTS
    })
  }

  private async attemptResumeWithBackoff(projectPath: string, agentId: string, worktreePath: string, agentInfo: AgentInfo, resumeAttempts: number): Promise<void> {
    const currentAttempt = resumeAttempts + 1
    const delayMs = Math.pow(2, resumeAttempts) * 1000
    const displayName = this.formatDisplayName(projectPath, agentInfo, agentId)

    log.info(`Retrying resume for ${agentId}, attempt ${currentAttempt}/${this.MAX_RESUME_ATTEMPTS}, delay: ${delayMs}ms`)

    await this.updateAgentInfo(worktreePath, {
      resumeAttempts: currentAttempt,
      lastResumeAttempt: new Date().toISOString()
    })

    this.safeSendIPC('agent:retryingResume', agentId, {
      attempt: currentAttempt,
      maxAttempts: this.MAX_RESUME_ATTEMPTS,
      delayMs
    })
    this.notificationService?.notifySessionResumeRetrying(displayName, currentAttempt, this.MAX_RESUME_ATTEMPTS)

    await new Promise(resolve => setTimeout(resolve, delayMs))

    try {
      await this.startAgentFromInfo(projectPath, agentId, agentInfo)
      await this.handleResumeSuccess(worktreePath, agentId, displayName)
    } catch (error) {
      await this.handleResumeError(worktreePath, agentId, currentAttempt, error)
      throw error
    }
  }

  private async handleResumeSuccess(worktreePath: string, agentId: string, displayName: string): Promise<void> {
    await this.updateAgentInfo(worktreePath, {
      failureReason: undefined,
      resumeAttempts: 0,
      claudeSessionActive: true
    })

    this.notificationService?.notifySessionResumeSuccess(agentId, displayName)
    this.safeSendIPC('agent:retrySuccess', agentId)
    this.safeSendIPC('agents:updated')
  }

  private async handleResumeError(worktreePath: string, agentId: string, currentAttempt: number, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error(`Retry ${currentAttempt} failed for ${agentId}`, errorMessage)
    await this.updateAgentInfo(worktreePath, { failureReason: errorMessage })
  }

  /**
   * Start a fresh session in the same worktree, abandoning the old failed session.
   * Creates a new session ID and clears all failure state.
   */
  async startFreshSession(projectPath: string, agentId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(projectPath, agentId)
    const agentInfo = await this.getAgentInfoOrThrow(worktreePath)

    log.info(`Starting fresh session for ${agentId}`)

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

    this.safeSendIPC('agent:freshSessionStarted', agentId)
    this.safeSendIPC('agents:updated')
  }
}
