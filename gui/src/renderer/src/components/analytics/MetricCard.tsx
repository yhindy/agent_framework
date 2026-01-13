import './MetricCard.css'

interface MetricCardProps {
  title: string
  value: string | number
  icon: string
  trend?: {
    value: number
    isPositive: boolean
  }
  subtitle?: string
  breakdown?: Record<string, number>
}

function MetricCard({ title, value, icon, trend, subtitle, breakdown }: MetricCardProps): JSX.Element {
  return (
    <div className="metric-card">
      <div className="metric-card-header">
        <span className="metric-icon">{icon}</span>
        <span className="metric-title">{title}</span>
      </div>
      <div className="metric-value">{value}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
      {trend && (
        <div className={`metric-trend ${trend.isPositive ? 'positive' : 'negative'}`}>
          <span className="trend-arrow">{trend.isPositive ? '↑' : '↓'}</span>
          <span className="trend-value">{Math.abs(trend.value)}%</span>
          <span className="trend-label">vs last period</span>
        </div>
      )}
      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="metric-breakdown">
          {Object.entries(breakdown).map(([key, val]) => (
            <div key={key} className="breakdown-item">
              <span className="breakdown-label">{key}</span>
              <span className="breakdown-value">{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MetricCard
