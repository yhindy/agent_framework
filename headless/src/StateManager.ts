import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'
import type { ServerState, HeadlessAgentState, ProjectState } from './types'

const log = createLogger('StateManager')

export class StateManager {
  private statePath: string
  private state: ServerState

  constructor(statePath?: string) {
    this.statePath = statePath || join(homedir(), '.agent-framework', 'state.json')
    const defaults: ServerState = { projects: [], agents: [], startedAt: new Date().toISOString() }
    try {
      if (existsSync(this.statePath)) {
        this.state = { ...defaults, ...JSON.parse(readFileSync(this.statePath, 'utf-8')), startedAt: new Date().toISOString() }
      } else {
        this.state = defaults
      }
    } catch {
      log.warn('Failed to load state, using defaults')
      this.state = defaults
    }
  }

  save(): void {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true })
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch (e) { log.error('Failed to save state', e) }
  }

  getState(): ServerState { return this.state }

  updateAgent(agent: HeadlessAgentState): void {
    const idx = this.state.agents.findIndex(a => a.agentId === agent.agentId)
    if (idx >= 0) this.state.agents[idx] = agent
    else this.state.agents.push(agent)
    this.save()
  }

  removeAgent(agentId: string): void {
    this.state.agents = this.state.agents.filter(a => a.agentId !== agentId)
    this.save()
  }

  getAgent(agentId: string): HeadlessAgentState | undefined {
    return this.state.agents.find(a => a.agentId === agentId)
  }

  updateProjects(projects: ProjectState[]): void {
    this.state.projects = projects
    this.save()
  }
}
