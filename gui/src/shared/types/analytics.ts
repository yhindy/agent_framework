/**
 * Analytics Types for the Analytics Page feature.
 * These types define the structure of analytics data aggregated from
 * agent info files and Claude session JSONL files.
 */

/**
 * Time series data point for charts.
 */
export interface TimeSeriesData {
  /** ISO date string (YYYY-MM-DD) */
  date: string
  /** The value for this data point */
  value: number
  /** Optional label for display */
  label?: string
}

/**
 * Fun fact computed from analytics data.
 */
export interface FunFact {
  /** Unique identifier */
  id: string
  /** Display title */
  title: string
  /** The value to display (can be string or number) */
  value: string | number
  /** Icon/emoji to display */
  icon: string
  /** Optional description for additional context */
  description?: string
}

/**
 * Achievement or milestone that can be unlocked.
 */
export interface Achievement {
  /** Unique identifier */
  id: string
  /** Display title */
  title: string
  /** Description of how to unlock */
  description: string
  /** Icon/emoji to display */
  icon: string
  /** ISO timestamp of when achievement was unlocked (if unlocked) */
  unlockedAt?: string
  /** Progress towards unlocking (0-100) for in-progress achievements */
  progress?: number
}

/**
 * Token usage breakdown.
 */
export interface TokenBreakdown {
  /** Input tokens consumed */
  input: number
  /** Output tokens generated */
  output: number
  /** Tokens served from cache */
  cached: number
  /** Total tokens (input + output) */
  total: number
}

/**
 * Aggregated analytics metrics.
 * This is the main data structure returned by the AnalyticsService.
 */
export interface AnalyticsMetrics {
  // Core counts
  /** Total number of agents created */
  totalAgents: number
  /** Total number of Claude sessions */
  totalSessions: number
  /** Total cost in USD */
  totalCostUsd: number

  // Token breakdown
  /** Aggregated token usage */
  tokens: TokenBreakdown

  // Distributions (for pie/bar charts)
  /** Distribution of agents by tool: { claude: 45, 'cursor-cli': 10, codex: 5 } */
  toolDistribution: Record<string, number>
  /** Distribution of agents by model: { opus: 30, sonnet: 15, haiku: 15 } */
  modelDistribution: Record<string, number>
  /** Distribution of agents by status: { completed: 40, in_progress: 10, ... } */
  statusDistribution: Record<string, number>

  // Time series data (for line/area charts)
  /** Daily agent creation counts */
  agentsOverTime: TimeSeriesData[]
  /** Daily/weekly cost totals */
  costOverTime: TimeSeriesData[]
  /** Daily session counts */
  sessionsOverTime: TimeSeriesData[]

  // Fun features
  /** Computed fun facts */
  funFacts: FunFact[]
  /** Achievements/streaks */
  achievements: Achievement[]

  // Metadata
  /** ISO timestamp of when this data was last computed */
  lastUpdated: string
  /** Date range covered by this data */
  dateRange: { start: string; end: string }
}

/**
 * Options for getAnalytics method.
 */
export interface GetAnalyticsOptions {
  /** Force refresh, bypassing cache */
  force?: boolean
  /** Optional date range filter */
  dateRange?: { start: string; end: string }
}
