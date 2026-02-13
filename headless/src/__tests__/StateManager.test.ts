import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StateManager } from '../StateManager'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { HeadlessAgentState } from '../types'

describe('StateManager', () => {
  let tmpDir: string
  let statePath: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `test-sm-${Date.now()}-${Math.random().toString(36).substring(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    statePath = join(tmpDir, 'state.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should initialize with default state', () => {
    const sm = new StateManager(statePath)
    const state = sm.getState()

    expect(state.projects).toEqual([])
    expect(state.agents).toEqual([])
    expect(state.startedAt).toBeTruthy()
  })

  it('should save and load state', () => {
    const sm = new StateManager(statePath)
    sm.updateProjects([{ path: '/test', name: 'test', lastOpened: '2024-01-01' }])
    sm.save()

    expect(existsSync(statePath)).toBe(true)

    const sm2 = new StateManager(statePath)
    expect(sm2.getState().projects).toHaveLength(1)
  })

  it('should manage agents', () => {
    const sm = new StateManager(statePath)

    const agent: HeadlessAgentState = {
      id: 'agent-1',
      agentId: 'agent-1',
      projectPath: '/test',
      status: 'running',
      branch: 'feature/test',
      tool: 'claude',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    }

    sm.updateAgent(agent)
    expect(sm.getAgent('agent-1')).toBeDefined()
    expect(sm.getState().agents).toHaveLength(1)

    sm.removeAgent('agent-1')
    expect(sm.getAgent('agent-1')).toBeUndefined()
    expect(sm.getState().agents).toHaveLength(0)
  })

  it('should update existing agent', () => {
    const sm = new StateManager(statePath)

    const agent: HeadlessAgentState = {
      id: 'agent-1',
      agentId: 'agent-1',
      projectPath: '/test',
      status: 'running',
      branch: 'feature/test',
      tool: 'claude',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    }

    sm.updateAgent(agent)
    sm.updateAgent({ ...agent, status: 'completed' })

    expect(sm.getState().agents).toHaveLength(1)
    expect(sm.getAgent('agent-1')!.status).toBe('completed')
  })
})
