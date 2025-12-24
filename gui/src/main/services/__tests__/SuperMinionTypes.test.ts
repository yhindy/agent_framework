import { describe, it, expect } from 'vitest'
import { isSuperMinion, AgentInfo, SuperAgentInfo } from '../types/ProjectConfig'

describe('Super Minion Types', () => {
  it('identifies a super minion correctly', () => {
    const superAgent: SuperAgentInfo = {
      id: 'super-1',
      agentId: 'super-1',
      branch: 'feature/super-1',
      project: 'test-project',
      feature: 'Master feature',
      status: 'active',
      tool: 'claude',
      mode: 'planning',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      isSuperMinion: true,
      minionBudget: 5,
      children: [],
      pendingPlans: []
    }

    expect(isSuperMinion(superAgent)).toBe(true)
  })

  it('identifies a regular minion correctly', () => {
    const regularAgent: AgentInfo = {
      id: 'agent-1',
      agentId: 'agent-1',
      branch: 'feature/agent-1',
      project: 'test-project',
      feature: 'Sub task',
      status: 'active',
      tool: 'claude',
      mode: 'dev',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    }

    expect(isSuperMinion(regularAgent)).toBe(false)
  })

  it('handles child minion with parentAgentId', () => {
    const childAgent: AgentInfo = {
      id: 'child-1',
      agentId: 'child-1',
      branch: 'feature/child-1',
      project: 'test-project',
      feature: 'Sub task',
      status: 'active',
      tool: 'claude',
      mode: 'dev',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      parentAgentId: 'super-1'
    }

    expect(childAgent.parentAgentId).toBe('super-1')
    expect(isSuperMinion(childAgent)).toBe(false)
  })
})

