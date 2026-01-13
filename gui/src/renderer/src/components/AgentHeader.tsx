import { ReactNode } from 'react'
import SessionInfoPanel from './SessionInfoPanel'
import './AgentHeader.css'

export interface HeaderBadge {
  label: string
  value: string
  variant?: 'default' | 'feature' | 'id' | 'status' | 'count'
  copyable?: boolean
  statusColor?: 'working' | 'idle' | 'pr_open' | 'merged' | 'blocked'
}

interface AgentHeaderProps {
  /** Icon to display (emoji) */
  icon: string
  /** Main title text */
  title: string
  /** Type label shown above the title */
  typeLabel: 'Minion' | 'Super Minion'
  /** Agent ID for reference */
  agentId: string
  /** Badges to display in the metadata row */
  badges?: HeaderBadge[]
  /** Tool being used (for session info) */
  tool?: string
  /** Whether the agent is running */
  isRunning?: boolean
  /** Action buttons (right side) */
  actions?: ReactNode
  /** Optional task count for super minions */
  taskCount?: number
}

function AgentHeader({
  icon,
  title,
  typeLabel,
  agentId,
  badges = [],
  tool,
  isRunning = false,
  actions,
  taskCount
}: AgentHeaderProps) {
  const handleCopyToClipboard = (text: string, e: React.MouseEvent) => {
    navigator.clipboard.writeText(text)
    const element = e.currentTarget
    element.classList.add('header-copy-flash')
    setTimeout(() => element.classList.remove('header-copy-flash'), 300)
  }

  const getStatusDotClass = (status?: string): string => {
    const validStatuses = ['working', 'pr_open', 'merged', 'blocked']
    return status && validStatuses.includes(status) ? status : 'idle'
  }

  return (
    <header className="agent-header-v2">
      {/* Left section: Icon + Title + Type */}
      <div className="header-identity">
        <div className="header-icon-wrapper">
          <span className="header-icon">{icon}</span>
          {taskCount !== undefined && taskCount > 0 && (
            <span className="header-task-indicator">{taskCount}</span>
          )}
        </div>
        <div className="header-title-group">
          <span className="header-type-label">{typeLabel}</span>
          <h2 className="header-title">{title}</h2>
        </div>
      </div>

      {/* Center section: Metadata badges */}
      <div className="header-metadata">
        {badges.map((badge, index) => (
          <div
            key={index}
            className={`header-badge header-badge--${badge.variant || 'default'}`}
            title={badge.copyable ? `${badge.value} (click to copy)` : badge.value}
          >
            {badge.variant === 'status' && (
              <span className={`header-status-dot ${getStatusDotClass(badge.statusColor)}`} />
            )}
            <span className="header-badge-label">{badge.label}</span>
            <span
              className={`header-badge-value ${badge.copyable ? 'copyable' : ''}`}
              onClick={badge.copyable ? (e) => handleCopyToClipboard(badge.value, e) : undefined}
              role={badge.copyable ? 'button' : undefined}
              tabIndex={badge.copyable ? 0 : undefined}
            >
              {badge.value}
            </span>
          </div>
        ))}

        {/* Session Info Panel - inline with badges */}
        {tool === 'claude' && (
          <SessionInfoPanel agentId={agentId} isRunning={isRunning} />
        )}
      </div>

      {/* Right section: Actions */}
      {actions && (
        <div className="header-actions">
          {actions}
        </div>
      )}
    </header>
  )
}

export default AgentHeader
