import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnalyticsService } from '../AnalyticsService'
import { AgentService } from '../AgentService'
import { ClaudeSessionInfoService, ClaudeSessionInfo } from '../ClaudeSessionInfoService'
import { AgentInfo } from '../types/ProjectConfig'

// Mock dependencies
vi.mock('../AgentService')
vi.mock('../ClaudeSessionInfoService')

/**
 * Create a mock AgentInfo object with sensible defaults.
 * Override specific properties as needed for each test.
 */
function createMockAgentInfo(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'test-1',
    agentId: 'test-agent-1',
    branch: 'feature/test',
    project: 'test-project',
    feature: 'Test feature',
    status: 'active',
    tool: 'claude',
    mode: 'dev',
    createdAt: '2026-01-10T10:00:00.000Z',
    lastActivity: '2026-01-10T12:00:00.000Z',
    ...overrides
  }
}

/**
 * Create a mock ClaudeSessionInfo object.
 */
function createMockSessionInfo(overrides: Partial<ClaudeSessionInfo> = {}): ClaudeSessionInfo {
  return {
    sessionId: 'session-123',
    actualModel: 'claude-sonnet-4-20251001',
    claudeCodeVersion: '2.0.76',
    totalCostUsd: 0.50,
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100
    },
    lastUpdated: '2026-01-10T12:00:00.000Z',
    modelHistory: [],
    state: 'working',
    taskInvocations: [],
    ...overrides
  }
}

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService
  let mockAgentService: AgentService
  let mockClaudeSessionInfoService: ClaudeSessionInfoService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T10:00:00.000Z'))

    mockAgentService = new AgentService() as any
    mockClaudeSessionInfoService = new ClaudeSessionInfoService() as any

    // Default mock implementations
    vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [] })
    vi.mocked(mockAgentService.listAgents).mockResolvedValue([])
    vi.mocked(mockClaudeSessionInfoService.parseSessionInfo).mockReturnValue(null)

    analyticsService = new AnalyticsService(
      mockAgentService,
      mockClaudeSessionInfoService
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getAnalytics', () => {
    it('aggregates metrics from multiple projects', async () => {
      const agent1 = createMockAgentInfo({
        agentId: 'agent-1',
        tool: 'claude',
        status: 'completed',
        createdAt: '2026-01-10T10:00:00.000Z'
      })
      const agent2 = createMockAgentInfo({
        agentId: 'agent-2',
        tool: 'cursor-cli',
        status: 'active',
        createdAt: '2026-01-11T10:00:00.000Z'
      })
      const agent3 = createMockAgentInfo({
        agentId: 'agent-3',
        tool: 'codex',
        status: 'completed',
        createdAt: '2026-01-11T14:00:00.000Z'
      })

      vi.mocked(mockAgentService.getAssignments)
        .mockResolvedValueOnce({ assignments: [agent1, agent2] })
        .mockResolvedValueOnce({ assignments: [agent3] })

      vi.mocked(mockAgentService.listAgents)
        .mockResolvedValueOnce([{ id: 'agent-1', worktreePath: '/path/1' }] as any)
        .mockResolvedValueOnce([{ id: 'agent-3', worktreePath: '/path/3' }] as any)

      const metrics = await analyticsService.getAnalytics(['/project1', '/project2'])

      expect(metrics.totalAgents).toBe(3)
      expect(metrics.toolDistribution.claude).toBe(1)
      expect(metrics.toolDistribution['cursor-cli']).toBe(1)
      expect(metrics.toolDistribution.codex).toBe(1)
    })

    it('returns cached results when valid', async () => {
      const agent = createMockAgentInfo()

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      // First call - should compute
      const metrics1 = await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      const metrics2 = await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(1)

      expect(metrics1).toEqual(metrics2)
    })

    it('recomputes when cache expired', async () => {
      const agent = createMockAgentInfo()

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      // First call
      await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(1)

      // Advance time past cache TTL (1 minute)
      vi.advanceTimersByTime(61000)

      // Second call - should recompute
      await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(2)
    })

    it('recomputes when force option is true', async () => {
      const agent = createMockAgentInfo()

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      // First call
      await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(1)

      // Second call with force
      await analyticsService.getAnalytics(['/project'], { force: true })
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(2)
    })

    it('handles empty project list', async () => {
      const metrics = await analyticsService.getAnalytics([])

      expect(metrics.totalAgents).toBe(0)
      expect(metrics.totalSessions).toBe(0)
      expect(metrics.totalCostUsd).toBe(0)
      expect(metrics.tokens.total).toBe(0)
      expect(metrics.funFacts).toEqual([])
    })

    it('handles projects with no agents', async () => {
      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [] })

      const metrics = await analyticsService.getAnalytics(['/empty-project'])

      expect(metrics.totalAgents).toBe(0)
      expect(metrics.totalSessions).toBe(0)
      expect(metrics.toolDistribution).toEqual({})
      expect(metrics.modelDistribution).toEqual({})
    })

    it('recomputes when project paths change', async () => {
      const agent = createMockAgentInfo()

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      // First call with project1
      await analyticsService.getAnalytics(['/project1'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(1)

      // Second call with different project
      await analyticsService.getAnalytics(['/project2'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(2)
    })
  })

  describe('aggregateMetrics', () => {
    it('computes correct total counts', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', claudeSessionId: 'session-1' }),
        createMockAgentInfo({ agentId: 'a2', claudeSessionId: 'session-2' }),
        createMockAgentInfo({ agentId: 'a3' }) // No session
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.totalAgents).toBe(3)
      expect(metrics.totalSessions).toBe(2)
    })

    it('aggregates tokens correctly', async () => {
      const agent1 = createMockAgentInfo({
        agentId: 'a1',
        claudeSessionId: 'session-1',
        tool: 'claude',
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheCreationTokens: 50
        }
      })
      const agent2 = createMockAgentInfo({
        agentId: 'a2',
        claudeSessionId: 'session-2',
        tool: 'claude',
        tokenUsage: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 400,
          cacheCreationTokens: 100
        }
      })

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent1, agent2] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([
        { id: 'a1', worktreePath: '/path/1' },
        { id: 'a2', worktreePath: '/path/2' }
      ] as any)

      // Mock session info to return null so we use agent info tokens
      vi.mocked(mockClaudeSessionInfoService.parseSessionInfo).mockReturnValue(null)

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.tokens.input).toBe(3000)
      expect(metrics.tokens.output).toBe(1500)
      expect(metrics.tokens.cached).toBe(600)
      expect(metrics.tokens.total).toBe(4500)
    })

    it('prefers session info tokens over agent info', async () => {
      const agent = createMockAgentInfo({
        agentId: 'a1',
        claudeSessionId: 'session-1',
        tool: 'claude',
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 20,
          cacheCreationTokens: 10
        }
      })

      const sessionInfo = createMockSessionInfo({
        tokenUsage: {
          inputTokens: 5000,
          outputTokens: 2500,
          cacheReadTokens: 1000,
          cacheCreationTokens: 500
        }
      })

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([
        { id: 'a1', worktreePath: '/path/1' }
      ] as any)
      vi.mocked(mockClaudeSessionInfoService.parseSessionInfo).mockReturnValue(sessionInfo)

      const metrics = await analyticsService.getAnalytics(['/project'])

      // Should use session info values, not agent info
      expect(metrics.tokens.input).toBe(5000)
      expect(metrics.tokens.output).toBe(2500)
      expect(metrics.tokens.cached).toBe(1000)
    })

    it('computes tool distribution', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', tool: 'claude' }),
        createMockAgentInfo({ agentId: 'a2', tool: 'claude' }),
        createMockAgentInfo({ agentId: 'a3', tool: 'cursor-cli' }),
        createMockAgentInfo({ agentId: 'a4', tool: 'codex' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.toolDistribution).toEqual({
        claude: 2,
        'cursor-cli': 1,
        codex: 1
      })
    })

    it('computes model distribution', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', model: 'opus', actualModel: 'claude-opus-4-20251001' }),
        createMockAgentInfo({ agentId: 'a2', model: 'sonnet' }),
        createMockAgentInfo({ agentId: 'a3', model: 'sonnet' }),
        createMockAgentInfo({ agentId: 'a4' }) // No model
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.modelDistribution['claude-opus-4']).toBe(1)
      expect(metrics.modelDistribution['sonnet']).toBe(2)
      expect(metrics.modelDistribution['unknown']).toBe(1)
    })

    it('normalizes model names (removes date suffix)', async () => {
      const agents = [
        createMockAgentInfo({
          agentId: 'a1',
          actualModel: 'claude-sonnet-4-20251001'
        }),
        createMockAgentInfo({
          agentId: 'a2',
          actualModel: 'claude-sonnet-4-20251001'
        }),
        createMockAgentInfo({
          agentId: 'a3',
          actualModel: 'claude-haiku-4-5-20251001'
        })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      // Date suffixes should be stripped
      expect(metrics.modelDistribution['claude-sonnet-4']).toBe(2)
      expect(metrics.modelDistribution['claude-haiku-4-5']).toBe(1)
      // No entries with date suffix
      expect(metrics.modelDistribution['claude-sonnet-4-20251001']).toBeUndefined()
    })

    it('computes status distribution', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', status: 'completed' }),
        createMockAgentInfo({ agentId: 'a2', status: 'completed' }),
        createMockAgentInfo({ agentId: 'a3', status: 'active' }),
        createMockAgentInfo({ agentId: 'a4', status: 'merged' }),
        createMockAgentInfo({ agentId: 'a5', status: 'blocked' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.statusDistribution).toEqual({
        completed: 2,
        active: 1,
        merged: 1,
        blocked: 1
      })
    })
  })

  describe('computeFunFacts', () => {
    it('identifies most productive day', async () => {
      // Create agents on different days of the week
      // Jan 10, 2026 is a Saturday (day 6)
      // Jan 11, 2026 is a Sunday (day 0)
      // Jan 12, 2026 is a Monday (day 1)
      const agents = [
        createMockAgentInfo({ agentId: 'a1', createdAt: '2026-01-10T10:00:00.000Z' }), // Saturday
        createMockAgentInfo({ agentId: 'a2', createdAt: '2026-01-10T14:00:00.000Z' }), // Saturday
        createMockAgentInfo({ agentId: 'a3', createdAt: '2026-01-10T16:00:00.000Z' }), // Saturday
        createMockAgentInfo({ agentId: 'a4', createdAt: '2026-01-11T10:00:00.000Z' }), // Sunday
        createMockAgentInfo({ agentId: 'a5', createdAt: '2026-01-12T10:00:00.000Z' }) // Monday
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const productiveDayFact = metrics.funFacts.find(f => f.id === 'productive-day')
      expect(productiveDayFact).toBeDefined()
      expect(productiveDayFact?.value).toBe('Saturday')
      expect(productiveDayFact?.description).toContain('3 agents')
    })

    it('calculates completion rate', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', status: 'completed' }),
        createMockAgentInfo({ agentId: 'a2', status: 'merged' }),
        createMockAgentInfo({ agentId: 'a3', status: 'active' }),
        createMockAgentInfo({ agentId: 'a4', status: 'blocked' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const completionFact = metrics.funFacts.find(f => f.id === 'completion-rate')
      expect(completionFact).toBeDefined()
      expect(completionFact?.value).toBe('50%') // 2 of 4 completed/merged
    })

    it('identifies favorite tool', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', tool: 'cursor-cli' }),
        createMockAgentInfo({ agentId: 'a2', tool: 'cursor-cli' }),
        createMockAgentInfo({ agentId: 'a3', tool: 'cursor-cli' }),
        createMockAgentInfo({ agentId: 'a4', tool: 'claude' }),
        createMockAgentInfo({ agentId: 'a5', tool: 'codex' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const toolFact = metrics.funFacts.find(f => f.id === 'favorite-tool')
      expect(toolFact).toBeDefined()
      expect(toolFact?.value).toBe('cursor-cli')
      expect(toolFact?.description).toContain('3 times')
    })

    it('handles empty data gracefully', async () => {
      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [] })

      const metrics = await analyticsService.getAnalytics(['/project'])

      // Should return empty array for funFacts when no agents
      expect(metrics.funFacts).toEqual([])
    })

    it('includes cache efficiency when cached tokens exist', async () => {
      const agent = createMockAgentInfo({
        agentId: 'a1',
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 500, // 50% of input
          cacheCreationTokens: 100
        }
      })

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const cacheFact = metrics.funFacts.find(f => f.id === 'cache-savings')
      expect(cacheFact).toBeDefined()
      expect(cacheFact?.value).toBe('50.0%')
    })
  })

  describe('computeAchievements', () => {
    it('unlocks first-agent achievement', async () => {
      const agent = createMockAgentInfo()

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const firstAgent = metrics.achievements.find(a => a.id === 'first-agent')
      expect(firstAgent).toBeDefined()
      expect(firstAgent?.unlockedAt).toBeDefined()
      expect(firstAgent?.progress).toBe(100)
    })

    it('tracks progress for multi-step achievements', async () => {
      // Create 5 agents (should be 50% toward ten-agents achievement)
      const agents = Array.from({ length: 5 }, (_, i) =>
        createMockAgentInfo({ agentId: `agent-${i}` })
      )

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const tenAgents = metrics.achievements.find(a => a.id === 'ten-agents')
      expect(tenAgents).toBeDefined()
      expect(tenAgents?.unlockedAt).toBeUndefined() // Not yet unlocked
      expect(tenAgents?.progress).toBe(50) // 5/10 = 50%

      const fiftyAgents = metrics.achievements.find(a => a.id === 'fifty-agents')
      expect(fiftyAgents?.progress).toBe(10) // 5/50 = 10%
    })

    it('unlocks all-tools achievement when all tools used', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', tool: 'claude' }),
        createMockAgentInfo({ agentId: 'a2', tool: 'cursor-cli' }),
        createMockAgentInfo({ agentId: 'a3', tool: 'codex' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const allTools = metrics.achievements.find(a => a.id === 'all-tools')
      expect(allTools).toBeDefined()
      expect(allTools?.unlockedAt).toBeDefined()
      expect(allTools?.progress).toBe(100)
    })

    it('computes streak correctly', async () => {
      // Create agents for the last 3 days (today = 2026-01-12)
      const agents = [
        createMockAgentInfo({
          agentId: 'a1',
          createdAt: '2026-01-12T10:00:00.000Z',
          lastActivity: '2026-01-12T12:00:00.000Z'
        }),
        createMockAgentInfo({
          agentId: 'a2',
          createdAt: '2026-01-11T10:00:00.000Z',
          lastActivity: '2026-01-11T12:00:00.000Z'
        }),
        createMockAgentInfo({
          agentId: 'a3',
          createdAt: '2026-01-10T10:00:00.000Z',
          lastActivity: '2026-01-10T12:00:00.000Z'
        })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const streak3 = metrics.achievements.find(a => a.id === 'streak-3')
      expect(streak3).toBeDefined()
      expect(streak3?.unlockedAt).toBeDefined()
      expect(streak3?.progress).toBe(100)
    })

    it('handles missing dates in streak calculation', async () => {
      // Create agents with a gap (missing Jan 11)
      const agents = [
        createMockAgentInfo({
          agentId: 'a1',
          createdAt: '2026-01-12T10:00:00.000Z',
          lastActivity: '2026-01-12T12:00:00.000Z'
        }),
        createMockAgentInfo({
          agentId: 'a2',
          createdAt: '2026-01-10T10:00:00.000Z', // Gap - missing Jan 11
          lastActivity: '2026-01-10T12:00:00.000Z'
        })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const streak3 = metrics.achievements.find(a => a.id === 'streak-3')
      expect(streak3).toBeDefined()
      // Streak should be 1 (only today) since there's a gap
      expect(streak3?.unlockedAt).toBeUndefined()
      expect(streak3?.progress).toBeLessThan(100)
    })

    it('unlocks merged achievement when PR is merged', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', status: 'merged' }),
        createMockAgentInfo({ agentId: 'a2', status: 'active' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      const mergedAchievement = metrics.achievements.find(a => a.id === 'pr-merged')
      expect(mergedAchievement).toBeDefined()
      expect(mergedAchievement?.unlockedAt).toBeDefined()
    })
  })

  describe('time series', () => {
    it('buckets agents by date correctly', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', createdAt: '2026-01-10T10:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a2', createdAt: '2026-01-10T14:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a3', createdAt: '2026-01-11T10:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a4', createdAt: '2026-01-12T10:00:00.000Z' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.agentsOverTime).toEqual([
        { date: '2026-01-10', value: 2 },
        { date: '2026-01-11', value: 1 },
        { date: '2026-01-12', value: 1 }
      ])
    })

    it('handles agents with missing dates', async () => {
      const agent = createMockAgentInfo({
        agentId: 'a1',
        createdAt: '2026-01-10T10:00:00.000Z'
      })

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.agentsOverTime.length).toBe(1)
      expect(metrics.agentsOverTime[0].date).toBe('2026-01-10')
    })

    it('computes cost time series', async () => {
      const agents = [
        createMockAgentInfo({
          agentId: 'a1',
          createdAt: '2026-01-10T10:00:00.000Z',
          lastActivity: '2026-01-10T12:00:00.000Z',
          totalCostUsd: 1.50
        }),
        createMockAgentInfo({
          agentId: 'a2',
          createdAt: '2026-01-10T14:00:00.000Z',
          lastActivity: '2026-01-10T16:00:00.000Z',
          totalCostUsd: 0.75
        }),
        createMockAgentInfo({
          agentId: 'a3',
          createdAt: '2026-01-11T10:00:00.000Z',
          lastActivity: '2026-01-11T12:00:00.000Z',
          totalCostUsd: 2.25
        })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      expect(metrics.costOverTime).toEqual([
        { date: '2026-01-10', value: 2.25 }, // 1.50 + 0.75
        { date: '2026-01-11', value: 2.25 }
      ])
    })

    it('sorts time series by date', async () => {
      // Create agents in non-chronological order
      const agents = [
        createMockAgentInfo({ agentId: 'a1', createdAt: '2026-01-12T10:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a2', createdAt: '2026-01-10T10:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a3', createdAt: '2026-01-11T10:00:00.000Z' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalytics(['/project'])

      // Should be sorted chronologically
      expect(metrics.agentsOverTime[0].date).toBe('2026-01-10')
      expect(metrics.agentsOverTime[1].date).toBe('2026-01-11')
      expect(metrics.agentsOverTime[2].date).toBe('2026-01-12')
    })
  })

  describe('invalidateCache', () => {
    it('clears cache forcing recomputation', async () => {
      const agent = createMockAgentInfo()

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: [agent] })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      // First call
      await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(1)

      // Invalidate cache
      analyticsService.invalidateCache()

      // Second call - should recompute
      await analyticsService.getAnalytics(['/project'])
      expect(mockAgentService.getAssignments).toHaveBeenCalledTimes(2)
    })
  })

  describe('getAnalyticsForDateRange', () => {
    it('filters agents by date range', async () => {
      const agents = [
        createMockAgentInfo({ agentId: 'a1', createdAt: '2026-01-05T10:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a2', createdAt: '2026-01-10T10:00:00.000Z' }),
        createMockAgentInfo({ agentId: 'a3', createdAt: '2026-01-15T10:00:00.000Z' })
      ]

      vi.mocked(mockAgentService.getAssignments).mockResolvedValue({ assignments: agents })
      vi.mocked(mockAgentService.listAgents).mockResolvedValue([])

      const metrics = await analyticsService.getAnalyticsForDateRange(
        ['/project'],
        new Date('2026-01-08'),
        new Date('2026-01-12')
      )

      // Only agent2 falls within the date range
      expect(metrics.totalAgents).toBe(1)
    })
  })
})
