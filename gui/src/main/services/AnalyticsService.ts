/**
 * AnalyticsService - Aggregates and caches analytics metrics from agent data.
 *
 * This service collects data from .agent-info files and Claude JSONL session files
 * to provide comprehensive analytics for the Analytics Page.
 */

import { AgentService } from './AgentService'
import { ClaudeSessionInfoService, ClaudeSessionInfo } from './ClaudeSessionInfoService'
import { AgentInfo } from './types/ProjectConfig'
import {
  AnalyticsMetrics,
  TimeSeriesData,
  FunFact,
  Achievement,
  TokenBreakdown,
  GetAnalyticsOptions
} from '../../shared/types/analytics'

/**
 * Achievement definition for computing achievements.
 */
interface AchievementDefinition {
  id: string
  title: string
  description: string
  icon: string
  check: (
    agentInfos: AgentInfo[],
    metrics: Partial<AnalyticsMetrics>
  ) => { unlocked: boolean; progress?: number; unlockedAt?: string }
}

/**
 * Cache entry with expiration tracking.
 */
interface CacheEntry {
  metrics: AnalyticsMetrics
  expiry: number
  cacheKey: string
}

export class AnalyticsService {
  private cache: CacheEntry | null = null
  private readonly CACHE_TTL_MS = 60000 // 1 minute cache

  constructor(
    private agentService: AgentService,
    private claudeSessionInfoService: ClaudeSessionInfoService
  ) {}

  /**
   * Get aggregated analytics metrics for all specified projects.
   * Uses caching for performance.
   */
  async getAnalytics(
    projectPaths: string[],
    options?: GetAnalyticsOptions
  ): Promise<AnalyticsMetrics> {
    const now = Date.now()
    const cacheKey = this.computeCacheKey(projectPaths)

    // Return cached if valid, not forced, and cache key matches
    if (
      !options?.force &&
      this.cache &&
      now < this.cache.expiry &&
      this.cache.cacheKey === cacheKey
    ) {
      return this.cache.metrics
    }

    // Compute fresh metrics
    const metrics = await this.computeMetrics(projectPaths, options?.dateRange)

    // Cache result
    this.cache = {
      metrics,
      expiry: now + this.CACHE_TTL_MS,
      cacheKey
    }

    return metrics
  }

  /**
   * Get analytics for a specific date range.
   */
  async getAnalyticsForDateRange(
    projectPaths: string[],
    start: Date,
    end: Date
  ): Promise<AnalyticsMetrics> {
    // For date range queries, we don't use cache since the range varies
    return this.computeMetrics(projectPaths, {
      start: start.toISOString(),
      end: end.toISOString()
    })
  }

  /**
   * Invalidate the cache.
   * Call this when agents are created/updated/deleted.
   */
  invalidateCache(): void {
    this.cache = null
  }

  /**
   * Compute a cache key based on project paths.
   */
  private computeCacheKey(projectPaths: string[]): string {
    return projectPaths.slice().sort().join('|')
  }

  /**
   * Compute all analytics metrics.
   */
  private async computeMetrics(
    projectPaths: string[],
    dateRange?: { start: string; end: string }
  ): Promise<AnalyticsMetrics> {
    // 1. Collect all agent infos from all projects in parallel
    const agentInfoPromises = projectPaths.map(path =>
      this.agentService.getAssignments(path).then(result => result.assignments)
    )
    const agentInfosNested = await Promise.all(agentInfoPromises)
    let allAgentInfos = agentInfosNested.flat()

    // 2. Filter by date range if specified
    if (dateRange) {
      const startDate = new Date(dateRange.start)
      const endDate = new Date(dateRange.end)
      allAgentInfos = allAgentInfos.filter(agent => {
        const createdAt = new Date(agent.createdAt)
        return createdAt >= startDate && createdAt <= endDate
      })
    }

    // 3. Collect session info for Claude agents in parallel
    const sessionInfos = await this.collectSessionInfos(allAgentInfos, projectPaths)

    // 4. Aggregate metrics
    const metrics = this.aggregateMetrics(allAgentInfos, sessionInfos)

    // 5. Compute fun facts
    metrics.funFacts = this.computeFunFacts(allAgentInfos, metrics)

    // 6. Compute achievements
    metrics.achievements = this.computeAchievements(allAgentInfos, metrics)

    // 7. Set metadata
    metrics.lastUpdated = new Date().toISOString()
    metrics.dateRange = this.computeDateRange(allAgentInfos, dateRange)

    return metrics
  }

  /**
   * Collect Claude session infos for agents that have Claude sessions.
   */
  private async collectSessionInfos(
    agentInfos: AgentInfo[],
    projectPaths: string[]
  ): Promise<Map<string, ClaudeSessionInfo>> {
    const sessionInfos = new Map<string, ClaudeSessionInfo>()

    // Build a map of agentId -> worktreePath for quick lookup
    const worktreePaths = new Map<string, string>()

    for (const projectPath of projectPaths) {
      const agents = await this.agentService.listAgents(projectPath)
      for (const agent of agents) {
        worktreePaths.set(agent.id, agent.worktreePath)
      }
    }

    // Collect session info in parallel
    const sessionPromises: Promise<void>[] = []

    for (const agent of agentInfos) {
      if (agent.claudeSessionId && agent.tool === 'claude') {
        const worktreePath = worktreePaths.get(agent.agentId)
        if (worktreePath) {
          sessionPromises.push(
            Promise.resolve().then(() => {
              const info = this.claudeSessionInfoService.parseSessionInfo(
                agent.claudeSessionId!,
                worktreePath
              )
              if (info) {
                sessionInfos.set(agent.agentId, info)
              }
            })
          )
        }
      }
    }

    await Promise.all(sessionPromises)
    return sessionInfos
  }

  /**
   * Aggregate metrics from agent infos and session infos.
   */
  private aggregateMetrics(
    agentInfos: AgentInfo[],
    sessionInfos: Map<string, ClaudeSessionInfo>
  ): AnalyticsMetrics {
    // Basic counts
    const totalAgents = agentInfos.length
    const totalSessions = agentInfos.filter(a => a.claudeSessionId).length

    // Cost aggregation (prefer session info, fall back to agent info)
    let totalCostUsd = 0
    for (const agent of agentInfos) {
      const sessionInfo = sessionInfos.get(agent.agentId)
      totalCostUsd += sessionInfo?.totalCostUsd ?? agent.totalCostUsd ?? 0
    }

    // Token aggregation
    const tokens: TokenBreakdown = { input: 0, output: 0, cached: 0, total: 0 }

    for (const agent of agentInfos) {
      const sessionInfo = sessionInfos.get(agent.agentId)

      // Prefer session info tokens, fall back to agent info tokens
      if (sessionInfo?.tokenUsage) {
        tokens.input += sessionInfo.tokenUsage.inputTokens
        tokens.output += sessionInfo.tokenUsage.outputTokens
        tokens.cached += sessionInfo.tokenUsage.cacheReadTokens
      } else if (agent.tokenUsage) {
        tokens.input += agent.tokenUsage.inputTokens
        tokens.output += agent.tokenUsage.outputTokens
        tokens.cached += agent.tokenUsage.cacheReadTokens
      }
    }
    tokens.total = tokens.input + tokens.output

    // Tool distribution
    const toolDistribution = this.countByKey(agentInfos, agent => agent.tool || 'unknown')

    // Model distribution (normalize by removing date suffix like -20251001)
    const modelDistribution = this.countByKey(agentInfos, agent => {
      const sessionInfo = sessionInfos.get(agent.agentId)
      const model = sessionInfo?.actualModel || agent.actualModel || agent.model || 'unknown'
      return model.replace(/-\d{8}$/, '')
    })

    // Status distribution
    const statusDistribution = this.countByKey(agentInfos, agent => agent.status || 'unknown')

    // Time series: agents created per day
    const agentsOverTime = this.computeTimeSeries(agentInfos, agent => agent.createdAt)

    // Time series: cost per day
    const costOverTime = this.computeCostTimeSeries(agentInfos, sessionInfos)

    // Sessions over time (same as agents for now - could be refined)
    const sessionsOverTime = this.computeTimeSeries(
      agentInfos.filter(a => a.claudeSessionId),
      agent => agent.createdAt
    )

    return {
      totalAgents,
      totalSessions,
      totalCostUsd,
      tokens,
      toolDistribution,
      modelDistribution,
      statusDistribution,
      agentsOverTime,
      costOverTime,
      sessionsOverTime,
      funFacts: [],
      achievements: [],
      lastUpdated: new Date().toISOString(),
      dateRange: { start: '', end: '' }
    }
  }

  /**
   * Count items by a key extractor function.
   */
  private countByKey<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const item of items) {
      const key = getKey(item)
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }

  /**
   * Compute time series data from agents.
   */
  private computeTimeSeries(
    agentInfos: AgentInfo[],
    getDate: (agent: AgentInfo) => string | undefined
  ): TimeSeriesData[] {
    const dateCounts = new Map<string, number>()

    for (const agent of agentInfos) {
      const dateStr = getDate(agent)
      if (dateStr) {
        const date = dateStr.split('T')[0]
        dateCounts.set(date, (dateCounts.get(date) || 0) + 1)
      }
    }

    return Array.from(dateCounts, ([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * Compute cost time series from agents and session infos.
   */
  private computeCostTimeSeries(
    agentInfos: AgentInfo[],
    sessionInfos: Map<string, ClaudeSessionInfo>
  ): TimeSeriesData[] {
    const dateCosts = new Map<string, number>()

    for (const agent of agentInfos) {
      const sessionInfo = sessionInfos.get(agent.agentId)
      const cost = sessionInfo?.totalCostUsd ?? agent.totalCostUsd ?? 0

      if (cost > 0) {
        const date = (agent.lastActivity || agent.createdAt).split('T')[0]
        dateCosts.set(date, (dateCosts.get(date) || 0) + cost)
      }
    }

    return Array.from(dateCosts, ([date, value]) => ({
      date,
      value: Math.round(value * 100) / 100
    })).sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * Compute the date range covered by the agents.
   */
  private computeDateRange(
    agentInfos: AgentInfo[],
    explicitRange?: { start: string; end: string }
  ): { start: string; end: string } {
    if (explicitRange) {
      return explicitRange
    }

    if (agentInfos.length === 0) {
      const today = new Date().toISOString().split('T')[0]
      return { start: today, end: today }
    }

    let minDate = agentInfos[0].createdAt.split('T')[0]
    let maxDate = agentInfos[0].createdAt.split('T')[0]

    for (const agent of agentInfos) {
      const date = agent.createdAt.split('T')[0]
      if (date < minDate) minDate = date
      if (date > maxDate) maxDate = date
    }

    return { start: minDate, end: maxDate }
  }

  /**
   * Compute fun facts from aggregated data.
   */
  private computeFunFacts(
    agentInfos: AgentInfo[],
    metrics: Partial<AnalyticsMetrics>
  ): FunFact[] {
    const facts: FunFact[] = []

    if (agentInfos.length === 0) {
      return facts
    }

    // Total agents created
    facts.push({
      id: 'total-agents',
      title: 'Minions Deployed',
      value: agentInfos.length,
      icon: '🤖',
      description: `You've created ${agentInfos.length} agent${agentInfos.length === 1 ? '' : 's'}!`
    })

    // Most productive day of the week
    const dayOfWeekCounts = new Map<number, number>()
    for (const agent of agentInfos) {
      const day = new Date(agent.createdAt).getDay()
      dayOfWeekCounts.set(day, (dayOfWeekCounts.get(day) || 0) + 1)
    }

    if (dayOfWeekCounts.size > 0) {
      const mostProductiveEntry = [...dayOfWeekCounts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0]
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday'
      ]
      facts.push({
        id: 'productive-day',
        title: 'Most Productive Day',
        value: dayNames[mostProductiveEntry[0]],
        icon: '📅',
        description: `${mostProductiveEntry[1]} agent${mostProductiveEntry[1] === 1 ? '' : 's'} created on ${dayNames[mostProductiveEntry[0]]}s`
      })
    }

    // Favorite tool
    const toolCounts = Object.entries(metrics.toolDistribution || {}).sort(
      (a, b) => b[1] - a[1]
    )
    if (toolCounts.length > 0) {
      facts.push({
        id: 'favorite-tool',
        title: 'Favorite Tool',
        value: toolCounts[0][0],
        icon: '🔧',
        description: `Used ${toolCounts[0][1]} time${toolCounts[0][1] === 1 ? '' : 's'}`
      })
    }

    // Completion rate
    const completedAgents = agentInfos.filter(
      a => a.status === 'completed' || a.status === 'merged'
    )
    if (agentInfos.length > 0) {
      const completionRate = Math.round((completedAgents.length / agentInfos.length) * 100)
      facts.push({
        id: 'completion-rate',
        title: 'Completion Rate',
        value: `${completionRate}%`,
        icon: '✅',
        description: `${completedAgents.length} of ${agentInfos.length} agent${agentInfos.length === 1 ? '' : 's'} completed`
      })
    }

    // Cache efficiency
    if (metrics.tokens?.cached && metrics.tokens.cached > 0 && metrics.tokens.input > 0) {
      const savings = ((metrics.tokens.cached / metrics.tokens.input) * 100).toFixed(1)
      facts.push({
        id: 'cache-savings',
        title: 'Cache Efficiency',
        value: `${savings}%`,
        icon: '💾',
        description: `${this.formatLargeNumber(metrics.tokens.cached)} tokens served from cache`
      })
    }

    // Total cost (if any)
    if (metrics.totalCostUsd && metrics.totalCostUsd > 0) {
      facts.push({
        id: 'total-cost',
        title: 'Total Investment',
        value: `$${metrics.totalCostUsd.toFixed(2)}`,
        icon: '💰',
        description: 'Total API costs across all agents'
      })
    }

    return facts
  }

  /**
   * Format large numbers for display.
   */
  private formatLargeNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`
    }
    return num.toString()
  }

  /**
   * Compute achievements/streaks from historical data.
   */
  private computeAchievements(
    agentInfos: AgentInfo[],
    metrics: Partial<AnalyticsMetrics>
  ): Achievement[] {
    const definitions: AchievementDefinition[] = [
      {
        id: 'first-agent',
        title: 'First Steps',
        description: 'Create your first agent',
        icon: '🎉',
        check: agents => ({ unlocked: agents.length >= 1 })
      },
      {
        id: 'ten-agents',
        title: 'Building a Team',
        description: 'Create 10 agents',
        icon: '👥',
        check: agents => ({
          unlocked: agents.length >= 10,
          progress: Math.min(100, (agents.length / 10) * 100)
        })
      },
      {
        id: 'fifty-agents',
        title: 'Minion Army',
        description: 'Create 50 agents',
        icon: '🪖',
        check: agents => ({
          unlocked: agents.length >= 50,
          progress: Math.min(100, (agents.length / 50) * 100)
        })
      },
      {
        id: 'hundred-agents',
        title: 'Legion Commander',
        description: 'Create 100 agents',
        icon: '⭐',
        check: agents => ({
          unlocked: agents.length >= 100,
          progress: Math.min(100, (agents.length / 100) * 100)
        })
      },
      {
        id: 'all-tools',
        title: 'Tool Collector',
        description: 'Use all three tools (Claude, Cursor CLI, Codex)',
        icon: '🧰',
        check: agents => {
          const tools = new Set(agents.map(a => a.tool))
          const hasAll =
            tools.has('claude') && tools.has('cursor-cli') && tools.has('codex')
          return {
            unlocked: hasAll,
            progress: (tools.size / 3) * 100
          }
        }
      },
      {
        id: 'streak-3',
        title: 'Getting Started',
        description: 'Use agents 3 days in a row',
        icon: '🔥',
        check: agents => {
          const streak = this.computeStreak(agents)
          return { unlocked: streak >= 3, progress: Math.min(100, (streak / 3) * 100) }
        }
      },
      {
        id: 'streak-7',
        title: 'Week Warrior',
        description: 'Use agents 7 days in a row',
        icon: '🔥🔥',
        check: agents => {
          const streak = this.computeStreak(agents)
          return { unlocked: streak >= 7, progress: Math.min(100, (streak / 7) * 100) }
        }
      },
      {
        id: 'streak-30',
        title: 'Monthly Master',
        description: 'Use agents 30 days in a row',
        icon: '🔥🔥🔥',
        check: agents => {
          const streak = this.computeStreak(agents)
          return { unlocked: streak >= 30, progress: Math.min(100, (streak / 30) * 100) }
        }
      },
      {
        id: 'pr-merged',
        title: 'Merged Master',
        description: 'Get a PR merged',
        icon: '🎊',
        check: agents => ({
          unlocked: agents.some(a => a.status === 'merged')
        })
      },
      {
        id: 'five-prs-merged',
        title: 'Merge Machine',
        description: 'Get 5 PRs merged',
        icon: '🏆',
        check: agents => {
          const mergedCount = agents.filter(a => a.status === 'merged').length
          return {
            unlocked: mergedCount >= 5,
            progress: Math.min(100, (mergedCount / 5) * 100)
          }
        }
      },
      {
        id: 'cost-saver',
        title: 'Penny Pincher',
        description: 'Achieve 50%+ cache efficiency',
        icon: '💸',
        check: (_agents, m) => {
          if (!m.tokens?.cached || !m.tokens?.input || m.tokens.input === 0) {
            return { unlocked: false, progress: 0 }
          }
          const efficiency = (m.tokens.cached / m.tokens.input) * 100
          return {
            unlocked: efficiency >= 50,
            progress: Math.min(100, efficiency * 2) // Scale 0-50% to 0-100%
          }
        }
      }
    ]

    const achievements: Achievement[] = []

    for (const def of definitions) {
      const result = def.check(agentInfos, metrics)
      achievements.push({
        id: def.id,
        title: def.title,
        description: def.description,
        icon: def.icon,
        unlockedAt: result.unlocked ? new Date().toISOString() : undefined,
        progress: result.unlocked ? 100 : result.progress
      })
    }

    return achievements
  }

  /**
   * Compute the current activity streak (consecutive days with agent activity).
   */
  private computeStreak(agents: AgentInfo[]): number {
    // Get unique active dates (based on lastActivity or createdAt)
    const dates = new Set<string>()
    for (const agent of agents) {
      const date = (agent.lastActivity || agent.createdAt).split('T')[0]
      dates.add(date)
    }

    if (dates.size === 0) {
      return 0
    }

    // Sort dates and compute current streak from today
    const sortedDates = [...dates].sort().reverse()
    const today = new Date().toISOString().split('T')[0]

    let streak = 0
    let expectedDate = today

    for (const date of sortedDates) {
      if (date === expectedDate) {
        streak++
        // Calculate previous day
        const prev = new Date(expectedDate)
        prev.setDate(prev.getDate() - 1)
        expectedDate = prev.toISOString().split('T')[0]
      } else if (date < expectedDate) {
        // Gap in streak - but check if we're on the first iteration
        // Allow streak to start from yesterday if today has no activity yet
        if (streak === 0) {
          const yesterday = new Date(today)
          yesterday.setDate(yesterday.getDate() - 1)
          const yesterdayStr = yesterday.toISOString().split('T')[0]

          if (date === yesterdayStr) {
            streak = 1
            const prev = new Date(yesterdayStr)
            prev.setDate(prev.getDate() - 1)
            expectedDate = prev.toISOString().split('T')[0]
            continue
          }
        }
        break
      }
    }

    return streak
  }
}
