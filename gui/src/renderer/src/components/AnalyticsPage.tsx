import { useState, useEffect, useCallback } from 'react'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import type { AnalyticsMetrics, TimeSeriesData } from '../../../shared/types/analytics'
import MetricCard from './analytics/MetricCard'
import ChartCard from './analytics/ChartCard'
import FunFactsSection from './analytics/FunFactsSection'
import AchievementsSection from './analytics/AchievementsSection'
import './AnalyticsPage.css'

type DateRangeOption = '7d' | '30d' | '90d' | 'all'

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82ca9d']
const STATUS_COLORS: Record<string, string> = {
  completed: '#4ec9b0',
  merged: '#4CAF50',
  in_progress: '#0e639c',
  working: '#2196F3',
  waiting: '#dcdcaa',
  blocked: '#f48771',
  error: '#F44336',
  unknown: '#9E9E9E'
}

function AnalyticsPage(): JSX.Element {
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d')
  const [error, setError] = useState<string | null>(null)

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      if (dateRange === 'all') {
        const data = await window.electronAPI.getAnalytics({ force: false })
        setMetrics(data)
        return
      }

      const daysMap: Record<Exclude<DateRangeOption, 'all'>, number> = {
        '7d': 7,
        '30d': 30,
        '90d': 90
      }
      const start = new Date()
      start.setDate(start.getDate() - daysMap[dateRange])
      const data = await window.electronAPI.getAnalyticsForDateRange(
        start.toISOString(),
        new Date().toISOString()
      )
      setMetrics(data)
    } catch (err) {
      console.error('Failed to load analytics:', err)
      setError('Failed to load analytics data')
    } finally {
      setIsLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  const handleRefresh = () => {
    loadAnalytics()
  }

  if (isLoading) {
    return (
      <div className="analytics-page analytics-loading">
        <div className="loading-spinner">
          <div className="spinner-ring"></div>
          <span>Loading analytics...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="analytics-page analytics-error">
        <div className="error-content">
          <span className="error-icon">⚠️</span>
          <h2>Unable to Load Analytics</h2>
          <p>{error}</p>
          <button className="retry-button" onClick={handleRefresh}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!metrics || metrics.totalAgents === 0) {
    return (
      <div className="analytics-page analytics-empty">
        <div className="empty-content">
          <span className="empty-icon">📊</span>
          <h2>No Analytics Yet</h2>
          <p>Create your first agent to start tracking your productivity metrics!</p>
          <div className="empty-tips">
            <div className="tip">
              <span className="tip-icon">🤖</span>
              <span>Agents created, sessions, and costs will be tracked</span>
            </div>
            <div className="tip">
              <span className="tip-icon">📈</span>
              <span>View trends over time with interactive charts</span>
            </div>
            <div className="tip">
              <span className="tip-icon">🏆</span>
              <span>Unlock achievements as you use the platform</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Prepare chart data
  const toolData = Object.entries(metrics.toolDistribution).map(([name, value]) => ({
    name: formatToolName(name),
    value
  }))

  const modelData = Object.entries(metrics.modelDistribution).map(([name, value]) => ({
    name: formatModelName(name),
    value
  }))

  const statusData = Object.entries(metrics.statusDistribution).map(([name, value]) => ({
    name: formatStatusName(name),
    value,
    fill: STATUS_COLORS[name] || STATUS_COLORS.unknown
  }))

  // Format time series data for charts
  const activityData = metrics.agentsOverTime.map((d) => ({
    ...d,
    date: formatChartDate(d.date)
  }))

  const costData = metrics.costOverTime.map((d) => ({
    ...d,
    date: formatChartDate(d.date)
  }))

  return (
    <div className="analytics-page">
      <div className="analytics-header">
        <div className="header-left">
          <h1>Analytics</h1>
          {metrics.lastUpdated && (
            <span className="last-updated">Updated {formatRelativeTime(metrics.lastUpdated)}</span>
          )}
        </div>
        <div className="header-controls">
          <div className="date-range-selector">
            {(['7d', '30d', '90d', 'all'] as const).map((range) => (
              <button
                key={range}
                className={`range-btn ${dateRange === range ? 'active' : ''}`}
                onClick={() => setDateRange(range)}
              >
                {range === 'all' ? 'All Time' : range}
              </button>
            ))}
          </div>
          <button className="refresh-btn" onClick={handleRefresh} title="Refresh analytics">
            ↻
          </button>
        </div>
      </div>

      {/* Core Metrics Row */}
      <div className="metrics-row">
        <MetricCard
          title="Total Agents"
          value={metrics.totalAgents}
          icon="🤖"
          trend={calculateTrend(metrics.agentsOverTime)}
        />
        <MetricCard
          title="Total Sessions"
          value={metrics.totalSessions}
          icon="📊"
          breakdown={metrics.toolDistribution}
        />
        <MetricCard
          title="Total Cost"
          value={formatCurrency(metrics.totalCostUsd)}
          icon="💰"
          trend={calculateTrend(metrics.costOverTime)}
        />
        <MetricCard
          title="Total Tokens"
          value={formatLargeNumber(metrics.tokens.total)}
          icon="🔤"
          subtitle={`${formatLargeNumber(metrics.tokens.cached)} cached`}
        />
        <MetricCard
          title="Code Generated"
          value={formatLargeNumber(metrics.tokens.output)}
          icon="📝"
          subtitle="output tokens"
        />
      </div>

      {/* Charts Section */}
      <div className="charts-grid">
        {/* Activity Timeline */}
        <ChartCard title="Agent Activity" span={2}>
          {activityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8884d8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: '#2d2d30',
                    border: '1px solid #404040',
                    borderRadius: 8
                  }}
                  labelStyle={{ color: '#e8e8e8' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Agents"
                  stroke="#8884d8"
                  fillOpacity={1}
                  fill="url(#colorActivity)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-chart-data">No activity data available</div>
          )}
        </ChartCard>

        {/* Tool Distribution */}
        <ChartCard title="Tool Usage">
          {toolData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={toolData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {toolData.map((_, index) => (
                    <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#2d2d30',
                    border: '1px solid #404040',
                    borderRadius: 8
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-chart-data">No tool data available</div>
          )}
        </ChartCard>

        {/* Model Distribution */}
        <ChartCard title="Model Usage">
          {modelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={modelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#666"
                  tick={{ fill: '#888', fontSize: 11 }}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    background: '#2d2d30',
                    border: '1px solid #404040',
                    borderRadius: 8
                  }}
                />
                <Bar dataKey="value" fill="#82ca9d" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-chart-data">No model data available</div>
          )}
        </ChartCard>

        {/* Cost Trend */}
        <ChartCard title="Cost Over Time" span={2}>
          {costData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={costData}>
                <defs>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff7300" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ff7300" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis
                  stroke="#666"
                  tick={{ fill: '#888', fontSize: 11 }}
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#2d2d30',
                    border: '1px solid #404040',
                    borderRadius: 8
                  }}
                  formatter={(value) => [`$${(value as number).toFixed(4)}`, 'Cost']}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Cost"
                  stroke="#ff7300"
                  strokeWidth={2}
                  dot={{ fill: '#ff7300', strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, fill: '#ff7300' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-chart-data">No cost data available</div>
          )}
        </ChartCard>

        {/* Status Distribution */}
        <ChartCard title="Agent Status">
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {statusData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#2d2d30',
                    border: '1px solid #404040',
                    borderRadius: 8
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-chart-data">No status data available</div>
          )}
        </ChartCard>
      </div>

      {/* Fun Facts Section */}
      <FunFactsSection facts={metrics.funFacts} />

      {/* Achievements Section */}
      <AchievementsSection achievements={metrics.achievements} />
    </div>
  )
}

// Helper functions

function formatCurrency(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function formatLargeNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toString()
}

function formatChartDate(isoDate: string): string {
  try {
    const date = new Date(isoDate)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return isoDate
  }
}

function formatRelativeTime(isoDate: string): string {
  try {
    const date = new Date(isoDate)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  } catch {
    return ''
  }
}

function formatToolName(tool: string): string {
  const names: Record<string, string> = {
    claude: 'Claude',
    'cursor-cli': 'Cursor CLI',
    codex: 'Codex'
  }
  return names[tool] || tool
}

function formatModelName(model: string): string {
  // Remove date suffixes like -20250101
  const cleaned = model.replace(/-\d{8}$/, '')
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function formatStatusName(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function calculateTrend(
  data: TimeSeriesData[]
): { value: number; isPositive: boolean } | undefined {
  if (!data || data.length < 2) return undefined

  // Compare last period vs previous period
  const midpoint = Math.floor(data.length / 2)
  const recentData = data.slice(midpoint)
  const previousData = data.slice(0, midpoint)

  const recentSum = recentData.reduce((sum, d) => sum + d.value, 0)
  const previousSum = previousData.reduce((sum, d) => sum + d.value, 0)

  if (previousSum === 0) return undefined

  const percentChange = ((recentSum - previousSum) / previousSum) * 100
  return {
    value: Math.round(Math.abs(percentChange)),
    isPositive: percentChange >= 0
  }
}

export default AnalyticsPage
