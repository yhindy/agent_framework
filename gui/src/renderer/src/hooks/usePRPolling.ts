import { useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

interface UsePRPollingOptions {
  assignmentIds: string[]
  enabled: boolean
}

/**
 * React hook for managing PR polling subscriptions.
 *
 * This hook handles the component lifecycle for PR polling:
 * - Starts polling when component mounts and assignmentIds are provided
 * - Updates polling subscriptions when assignmentIds change
 * - Stops all polling when component unmounts
 *
 * Each component instance gets a unique subscriberId to track its subscriptions.
 */
export function usePRPolling({ assignmentIds, enabled }: UsePRPollingOptions): void {
  const subscriberIdRef = useRef<string>(uuidv4())

  // Handle initial polling start and updates
  useEffect(() => {
    if (!enabled || assignmentIds.length === 0) return

    const subscriberId = subscriberIdRef.current

    // Start polling for all current assignments
    assignmentIds.forEach((assignmentId) => {
      window.electronAPI.startPRPolling(assignmentId, subscriberId).catch((err) => {
        console.error(`[usePRPolling] Failed to start polling for ${assignmentId}:`, err)
      })
    })

    // Cleanup: stop polling for these assignments
    return () => {
      assignmentIds.forEach((assignmentId) => {
        window.electronAPI.stopPRPolling(assignmentId, subscriberId).catch((err) => {
          console.error(`[usePRPolling] Failed to stop polling for ${assignmentId}:`, err)
        })
      })
    }
  }, [assignmentIds, enabled])

  // Handle cleanup on component unmount
  useEffect(() => {
    const subscriberId = subscriberIdRef.current

    // Stop all polling for this component when it unmounts
    return () => {
      window.electronAPI.stopAllPRPolling(subscriberId).catch((err) => {
        console.error('[usePRPolling] Failed to stop all polling on unmount:', err)
      })
    }
  }, [])
}
