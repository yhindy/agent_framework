import { useState, useEffect, useCallback } from 'react'
import './SessionInfoPanel.css'

interface SessionInfo {
  sessionId: string
  actualModel: string
  claudeCodeVersion?: string
  totalCostUsd?: number
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
  lastUpdated: string
  modelHistory: Array<{
    model: string
    timestamp: string
  }>
  state: 'working' | 'waiting' | 'unknown'
}

interface SessionInfoPanelProps {
  agentId: string
  isRunning: boolean
}

function formatModelName(model: string): string {
  // Remove date suffix like -20251001
  return model.replace(/-\d{8}$/, '')
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return tokens.toString()
  return `${(tokens / 1000).toFixed(1)}K`
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function timeAgo(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export default function SessionInfoPanel({ agentId, isRunning }: SessionInfoPanelProps) {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const loadSessionInfo = useCallback(async () => {
    if (!isRunning) {
      setSessionInfo(null)
      return
    }

    try {
      const info = await window.electronAPI.getClaudeSessionInfo(agentId)
      // Only update state if info changed (reduces re-renders)
      setSessionInfo(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(info)) {
          return info
        }
        return prev
      })
    } catch (err) {
      console.error('Failed to load session info:', err)
    }
  }, [agentId, isRunning])

  useEffect(() => {
    loadSessionInfo()

    // Refresh on agent updates
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadSessionInfo()
    })

    // Also refresh on terminal output (real-time updates)
    const unsubscribeOutput = window.electronAPI.onTerminalOutput((id: string) => {
      if (id === agentId) {
        // Debounce - don't refresh too often
        setTimeout(loadSessionInfo, 500)
      }
    })

    // Poll for changes (catches model changes, state updates, token usage)
    // Use 2 second interval - mtime caching makes this efficient
    const pollInterval = setInterval(() => {
      if (isRunning) {
        loadSessionInfo()
      }
    }, 2000)

    return () => {
      unsubscribe()
      unsubscribeOutput()
      clearInterval(pollInterval)
    }
  }, [agentId, isRunning, loadSessionInfo])

  const handleCopySessionId = async () => {
    if (sessionInfo?.sessionId) {
      try {
        await navigator.clipboard.writeText(sessionInfo.sessionId)
        setCopyFeedback('session')
        setTimeout(() => setCopyFeedback(null), 2000)
      } catch (err) {
        console.error('Failed to copy:', err)
      }
    }
  }

  // Show loading state if running but no session info yet
  if (!isRunning) {
    return null
  }

  if (!sessionInfo) {
    return (
      <div className="session-info-panel">
        <div className="session-info-collapsed">
          <div className="session-info-badges">
            <span className="session-badge">
              <span className="badge-label">Session:</span>
              <span className="badge-value">Loading...</span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  const truncatedSessionId = sessionInfo.sessionId.slice(0, 8)
  const displayModel = formatModelName(sessionInfo.actualModel)

  return (
    <div className="session-info-panel">
      <div className="session-info-collapsed" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="session-info-badges">
          <span className="session-badge" title={`Session ID: ${sessionInfo.sessionId}`}>
            <span className="badge-label">Session:</span>
            <span className="badge-value">{truncatedSessionId}...</span>
          </span>

          <span className="model-badge" title={`Model: ${sessionInfo.actualModel}`}>
            <span className="badge-label">Model:</span>
            <span className="badge-value">{displayModel}</span>
          </span>

          {sessionInfo.state !== 'unknown' && (
            <span className={`state-badge state-${sessionInfo.state}`}>
              {sessionInfo.state === 'working' ? 'Working' : 'Waiting'}
            </span>
          )}
        </div>

        <button className="expand-button" title={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? '▲' : '▼'}
        </button>
      </div>

      {isExpanded && (
        <div className="session-info-expanded">
          <div className="info-row">
            <span className="info-label">Session ID:</span>
            <span className="info-value">
              {sessionInfo.sessionId}
              <button
                className="copy-btn"
                onClick={handleCopySessionId}
                title="Copy session ID"
              >
                {copyFeedback === 'session' ? 'Copied!' : '📋'}
              </button>
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Full Model:</span>
            <span className="info-value">{sessionInfo.actualModel}</span>
          </div>

          {sessionInfo.claudeCodeVersion && (
            <div className="info-row">
              <span className="info-label">Claude Code:</span>
              <span className="info-value">v{sessionInfo.claudeCodeVersion}</span>
            </div>
          )}

          {sessionInfo.totalCostUsd !== undefined && (
            <div className="info-row">
              <span className="info-label">Cost:</span>
              <span className="info-value cost">{formatCost(sessionInfo.totalCostUsd)}</span>
            </div>
          )}

          {sessionInfo.tokenUsage && (
            <div className="info-row">
              <span className="info-label">Tokens:</span>
              <span className="info-value">
                {formatTokenCount(sessionInfo.tokenUsage.inputTokens)} in / {' '}
                {formatTokenCount(sessionInfo.tokenUsage.outputTokens)} out
                {sessionInfo.tokenUsage.cacheReadTokens > 0 && (
                  <span className="cached">
                    {' '}({formatTokenCount(sessionInfo.tokenUsage.cacheReadTokens)} cached)
                  </span>
                )}
              </span>
            </div>
          )}

          {sessionInfo.modelHistory.length > 0 && (
            <div className="info-row">
              <span className="info-label">Model History:</span>
              <span className="info-value model-history">
                {sessionInfo.modelHistory.map((entry, i) => (
                  <span key={i} className="history-entry">
                    → {formatModelName(entry.model)} ({timeAgo(entry.timestamp)})
                  </span>
                ))}
              </span>
            </div>
          )}

          <div className="info-row">
            <span className="info-label">Last Updated:</span>
            <span className="info-value">{timeAgo(sessionInfo.lastUpdated)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
