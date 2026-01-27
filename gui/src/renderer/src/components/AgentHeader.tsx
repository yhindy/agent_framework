import { ReactNode, useState, useRef, useEffect } from 'react'
import SessionInfoPanel from './SessionInfoPanel'
import './AgentHeader.css'

interface CopyTooltipState {
  visible: boolean
  position: { x: number; y: number }
}

export interface HeaderBadge {
  label: string
  value: string
  variant?: 'default' | 'feature' | 'id' | 'status' | 'count'
  copyable?: boolean
  statusColor?: 'working' | 'idle' | 'pr_open' | 'merged' | 'blocked'
}

interface AgentHeaderProps {
  /** Icon to display (React component or element) */
  icon: ReactNode
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
  /** Agent status for display in SessionInfoPanel */
  status?: string
  /** Working state from Claude session info (working/waiting/unknown) */
  workingState?: 'working' | 'waiting' | 'unknown'
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
  status,
  workingState,
  actions,
  taskCount
}: AgentHeaderProps) {
  const [copyTooltip, setCopyTooltip] = useState<CopyTooltipState>({
    visible: false,
    position: { x: 0, y: 0 }
  })
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
      }
    }
  }, [])

  const handleCopyToClipboard = (text: string, e: React.MouseEvent) => {
    navigator.clipboard.writeText(text)

    // Get position for the tooltip - use fixed positioning relative to viewport
    const valueElement = e.currentTarget as HTMLElement
    const rect = valueElement.getBoundingClientRect()

    // Position tooltip below the clicked element, centered horizontally
    // Using viewport coordinates for fixed positioning
    const tooltipX = rect.left + rect.width / 2
    const tooltipY = rect.bottom

    // Clear any existing timeout
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
    }

    // Show tooltip
    setCopyTooltip({
      visible: true,
      position: { x: tooltipX, y: tooltipY }
    })

    // Apply flash to both the value element and the parent badge for better visibility
    const badgeElement = valueElement.closest('.header-badge') as HTMLElement

    valueElement.classList.add('header-copy-flash')
    if (badgeElement) {
      badgeElement.classList.add('header-badge-flash')
    }

    // Hide tooltip after delay
    tooltipTimeoutRef.current = setTimeout(() => {
      setCopyTooltip(prev => ({ ...prev, visible: false }))
      valueElement.classList.remove('header-copy-flash')
      if (badgeElement) {
        badgeElement.classList.remove('header-badge-flash')
      }
    }, 1500)
  }

  // Filter out 'id' variant badges - they are shown in the SessionInfoPanel expanded view
  const displayBadges = badges.filter(badge => badge.variant !== 'id')

  const getStatusDotClass = (status?: string): string => {
    const validStatuses = ['working', 'pr_open', 'merged', 'blocked']
    return status && validStatuses.includes(status) ? status : 'idle'
  }

  return (
    <header className="agent-header-v2">
      {/* Copy confirmation tooltip */}
      {copyTooltip.visible && (
        <div
          className="copy-tooltip"
          style={{
            left: copyTooltip.position.x,
            top: copyTooltip.position.y
          }}
        >
          <span className="copy-tooltip-icon">&#10003;</span>
          <span className="copy-tooltip-text">Copied!</span>
          <div className="copy-tooltip-arrow" />
        </div>
      )}

      {/* Left section: Icon + Title + Type + Working State */}
      <div className="header-identity">
        <div className="header-icon-wrapper">
          <span className="header-icon">{icon}</span>
          {taskCount !== undefined && taskCount > 0 && (
            <span className="header-task-indicator">{taskCount}</span>
          )}
        </div>
        <div className="header-title-group">
          <div className="header-type-row">
            <span className="header-type-label">{typeLabel}</span>
            {workingState && workingState !== 'unknown' && (
              <span className={`header-working-chip header-working-chip--${workingState}`}>
                {workingState === 'working' ? 'Working' : 'Waiting'}
              </span>
            )}
          </div>
          <h2 className="header-title">{title}</h2>
        </div>
      </div>

      {/* Center section: Metadata badges */}
      <div className="header-metadata">
        {displayBadges.map((badge, index) => (
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

        {/* Session Info Panel - unified info panel for all agents */}
        {/* For claude tool: shows model + state + session details */}
        {/* For other tools: shows status + agent ID */}
        <SessionInfoPanel
          agentId={agentId}
          isRunning={tool === 'claude' ? isRunning : false}
          status={status}
        />
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
