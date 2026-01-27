import { useState, useEffect, useCallback } from 'react'

export interface SessionInfo {
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

interface UseSessionInfoResult {
  sessionInfo: SessionInfo | null
  workingState: 'working' | 'waiting' | 'unknown' | undefined
  isLoading: boolean
}

/**
 * Hook to fetch and manage Claude session info for an agent.
 * Returns the session info and working state for use in components.
 */
export function useSessionInfo(agentId: string, isRunning: boolean): UseSessionInfoResult {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadSessionInfo = useCallback(async () => {
    if (!isRunning) {
      setSessionInfo(null)
      return
    }

    setIsLoading(true)
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
    } finally {
      setIsLoading(false)
    }
  }, [agentId, isRunning])

  useEffect(() => {
    loadSessionInfo()

    // Refresh on agent updates (main process pushes these when state changes)
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadSessionInfo()
    })

    // Also refresh on terminal output (debounced for performance)
    const unsubscribeOutput = window.electronAPI.onTerminalOutput((id: string) => {
      if (id === agentId) {
        setTimeout(loadSessionInfo, 500)
      }
    })

    return () => {
      unsubscribe()
      unsubscribeOutput()
    }
  }, [agentId, isRunning, loadSessionInfo])

  return {
    sessionInfo,
    workingState: isRunning ? sessionInfo?.state : undefined,
    isLoading
  }
}
