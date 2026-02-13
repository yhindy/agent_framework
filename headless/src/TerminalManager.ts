import { execSync, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { createLogger } from './logger'
import type { AgentManager } from './AgentManager'

const log = createLogger('TerminalManager')

function escapeForDoubleQuotes(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$')
}

export class TerminalManager {
  private agentManager: AgentManager | null = null
  private tmuxAvailable: boolean | null = null
  private runningAgents = new Set<string>()
  private apiPort = 19234

  setAgentManager(mgr: AgentManager): void { this.agentManager = mgr }
  setApiPort(port: number): void { this.apiPort = port }

  isTmuxAvailable(): boolean {
    if (this.tmuxAvailable !== null) return this.tmuxAvailable
    try { execSync('which tmux', { encoding: 'utf8', stdio: 'pipe' }); this.tmuxAvailable = true }
    catch { this.tmuxAvailable = false }
    return this.tmuxAvailable
  }

  getTmuxSessionName(agentId: string): string {
    return `minion-${agentId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  }

  tmuxSessionExists(sessionName: string): boolean {
    if (!this.isTmuxAvailable()) return false
    try { execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' }); return true }
    catch { return false }
  }

  killTmuxSession(agentId: string): void {
    const name = this.getTmuxSessionName(agentId)
    try { execFileSync('tmux', ['kill-session', '-t', name], { encoding: 'utf8', stdio: 'pipe' }) }
    catch { /* already dead */ }
  }

  async startAgent(
    projectPath: string, agentId: string, tool: string, mode: string,
    prompt?: string, model?: string, yolo?: boolean, chrome?: boolean
  ): Promise<void> {
    if (!this.isTmuxAvailable()) throw new Error('tmux is required for headless mode but is not installed')
    if (this.runningAgents.has(agentId)) { log.warn(`Agent ${agentId} already running`); return }
    if (!this.agentManager) throw new Error('AgentManager not set')

    const worktreePath = this.agentManager.getWorktreePath(projectPath, agentId)
    if (!existsSync(worktreePath)) throw new Error(`Worktree path does not exist: ${worktreePath}`)

    const sessionName = this.getTmuxSessionName(agentId)
    if (this.tmuxSessionExists(sessionName)) this.killTmuxSession(agentId)

    const cmd = this.buildCommand(tool, mode, prompt, model, yolo, chrome)
    const envSetup = `export TERM=xterm-256color && export COLORTERM=truecolor && export MINION_API_PORT=${this.apiPort}`

    log.info(`Starting agent ${agentId} in tmux session ${sessionName}`)
    execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', worktreePath, `${envSetup} && ${cmd}`], { encoding: 'utf8', stdio: 'pipe' })
    this.runningAgents.add(agentId)
    log.info(`Agent ${agentId} started`)
  }

  private buildCommand(tool: string, mode: string, prompt?: string, model?: string, yolo?: boolean, chrome?: boolean): string {
    const parts: string[] = []
    switch (tool) {
      case 'claude':
        parts.push('claude')
        if (mode === 'planning') parts.push('--permission-mode', 'plan')
        else if (mode === 'dev') parts.push('--permission-mode', 'acceptEdits')
        if (model) parts.push('--model', model)
        if (yolo) parts.push('--dangerously-skip-permissions')
        if (chrome !== false) parts.push('--chrome')
        if (prompt) parts.push('-p', `"${escapeForDoubleQuotes(prompt)}"`)
        break
      case 'codex':
        parts.push('codex')
        parts.push('--model', model || 'gpt-5.2-codex')
        if (prompt) parts.push(`"${escapeForDoubleQuotes(prompt)}"`)
        break
      case 'cursor-cli':
        parts.push('cursor')
        if (model) parts.push('--model', model)
        if (prompt) parts.push(`"${escapeForDoubleQuotes(prompt)}"`)
        break
      default:
        throw new Error(`Unknown tool: ${tool}`)
    }
    return parts.join(' ')
  }

  stopAgent(agentId: string): void {
    this.killTmuxSession(agentId)
    this.runningAgents.delete(agentId)
    log.info(`Agent ${agentId} stopped`)
  }

  isAgentRunning(agentId: string): boolean {
    return this.tmuxSessionExists(this.getTmuxSessionName(agentId))
  }

  getRunningAgents(): string[] { return Array.from(this.runningAgents) }

  cleanup(): void {
    for (const id of this.runningAgents) {
      try { this.killTmuxSession(id) } catch { /* continue */ }
    }
    this.runningAgents.clear()
  }
}
