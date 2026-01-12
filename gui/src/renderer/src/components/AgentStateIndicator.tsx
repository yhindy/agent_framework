import { memo } from 'react'
import './AgentStateIndicator.css'

interface AgentStateIndicatorProps {
  claudeState: 'working' | 'waiting' | 'unknown'
  isRunning: boolean
  size?: 'small' | 'medium'
}

const STATE_CONFIG = {
  working: { class: 'state-indicator--working', title: 'Agent is working' },
  waiting: { class: 'state-indicator--waiting', title: 'Agent is waiting for input' },
  unknown: { class: 'state-indicator--idle', title: 'Agent state unknown' },
  stopped: { class: 'state-indicator--idle', title: 'Agent stopped' }
} as const

function AgentStateIndicator({
  claudeState,
  isRunning,
  size = 'small'
}: AgentStateIndicatorProps): JSX.Element {
  const stateKey = isRunning ? claudeState : 'stopped'
  const config = STATE_CONFIG[stateKey]

  return (
    <span
      className={`state-indicator state-indicator--${size} ${config.class}`}
      title={config.title}
      aria-label={config.title}
    />
  )
}

export default memo(AgentStateIndicator)
