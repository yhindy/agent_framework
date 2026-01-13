import { ReactNode } from 'react'
import './ChartCard.css'

interface ChartCardProps {
  title: string
  children: ReactNode
  span?: number
}

function ChartCard({ title, children, span = 1 }: ChartCardProps): JSX.Element {
  return (
    <div className={`chart-card ${span > 1 ? `span-${span}` : ''}`}>
      <h3 className="chart-title">{title}</h3>
      <div className="chart-content">{children}</div>
    </div>
  )
}

export default ChartCard
