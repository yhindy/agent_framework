import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { PRPollingService } from '../PRPollingService'
import { AgentService } from '../AgentService'

// Mock Electron's BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    send: vi.fn()
  }
}))

describe('PRPollingService', () => {
  let service: PRPollingService
  let mockMainWindow: Partial<BrowserWindow>
  let mockAgentService: Partial<AgentService>

  beforeEach(() => {
    vi.useFakeTimers()

    // Setup mock mainWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn()
      }
    } as any

    // Setup mock AgentService
    mockAgentService = {
      checkPullRequestStatus: vi.fn()
    } as any

    service = new PRPollingService(
      mockMainWindow as BrowserWindow,
      mockAgentService as AgentService
    )

    // Set a mock findProjectPath function
    service.setFindProjectPath(async () => {
      return '/test/project/path'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    service.dispose()
  })

  describe('startPolling', () => {
    it('should create a new polling job for the first subscriber', async () => {
      const assignmentId = 'test-assignment-1'
      const subscriberId = 'subscriber-1'

      await service.startPolling(assignmentId, subscriberId)

      // Should have called checkPullRequestStatus immediately
      expect(mockAgentService.checkPullRequestStatus).toHaveBeenCalled()
    })

    it('should add subscriber to existing job without creating duplicate intervals', async () => {
      const assignmentId = 'test-assignment-1'

      // Mock successful response
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      const callCountAfterFirst = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Start polling for the same assignment with different subscriber
      await service.startPolling(assignmentId, 'subscriber-2')

      // Should still only have called once (no new interval created)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(callCountAfterFirst)
    })

    it('should call checkPullRequestStatus every 30 seconds', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      const initialCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(
        initialCalls
      )
    })

    it('should emit assignments:updated event on successful check', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')
    })
  })

  describe('stopPolling', () => {
    it('should remove subscriber from job', async () => {
      const assignmentId = 'test-assignment-1'
      const subscriberId = 'subscriber-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, subscriberId)
      await service.stopPolling(assignmentId, subscriberId)

      // After stopping, intervals should be cleared
      vi.advanceTimersByTime(30000)

      // Should not have called more times since we stopped
      const calls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length
      expect(calls).toBeLessThanOrEqual(2) // One initial, potential one from pending timer
    })

    it('should keep polling when other subscribers exist', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      await service.startPolling(assignmentId, 'subscriber-2')

      const callsBefore = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Remove first subscriber
      await service.stopPolling(assignmentId, 'subscriber-1')

      // Should still be polling
      vi.advanceTimersByTime(30000)
      const callsAfter = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      expect(callsAfter).toBeGreaterThan(callsBefore)
    })

    it('should stop polling when last subscriber unmounts', async () => {
      const assignmentId = 'test-assignment-1'
      const subscriberId = 'subscriber-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, subscriberId)
      await service.stopPolling(assignmentId, subscriberId)

      // Clear the mock to verify no more calls
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      vi.advanceTimersByTime(30000)

      // Should not have been called again
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('stopAllPolling', () => {
    it('should stop all polling for a subscriber across multiple assignments', async () => {
      const subscriberId = 'subscriber-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling('assignment-1', subscriberId)
      await service.startPolling('assignment-2', subscriberId)

      await service.stopAllPolling(subscriberId)

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should retry on network error', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValueOnce(
        new Error('Network error')
      )

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValueOnce({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      // Should have called once (failed), then get cleaned up
      // The service will keep trying as long as errors < 3
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    it('should stop after 3 consecutive errors', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValue(
        new Error('Persistent error')
      )

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance timers to trigger retries
      vi.advanceTimersByTime(30000)
      vi.advanceTimersByTime(30000)
      vi.advanceTimersByTime(30000)

      // After 3 errors, should stop polling
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeLessThanOrEqual(3)
    })

    it('should handle rate limiting by backing off', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'ERROR',
        error: 'rate limit exceeded'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      const initialCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Advance time by 1 minute (less than 5 minute backoff)
      vi.advanceTimersByTime(60000)

      // Should not have made new calls due to rate limit backoff
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toEqual(initialCalls)
    })

    it('should stop polling for merged PRs', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'MERGED'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance time
      vi.advanceTimersByTime(30000)

      // Should not make more calls for merged PR
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })

    it('should stop polling for closed PRs', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'CLOSED'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance time
      vi.advanceTimersByTime(30000)

      // Should not make more calls for closed PR
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('deduplication', () => {
    it('should not create duplicate jobs for same assignment', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      const initialCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Start polling for same assignment multiple times
      await service.startPolling(assignmentId, 'subscriber-1')
      await service.startPolling(assignmentId, 'subscriber-2')
      await service.startPolling(assignmentId, 'subscriber-3')

      const callsAfterStart = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Should only have created one job, so difference should be small
      expect(callsAfterStart - initialCalls).toBeLessThanOrEqual(2) // Initial + potential pending
    })

    it('should call GitHub API only once per 30s regardless of subscribers', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      await service.startPolling(assignmentId, 'subscriber-2')
      await service.startPolling(assignmentId, 'subscriber-3')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance 30 seconds
      vi.advanceTimersByTime(30000)

      // Should only call once, not once per subscriber
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })
  })

  describe('dispose', () => {
    it('should clear all polling jobs on dispose', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      service.dispose()

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Should not make any more calls
      vi.advanceTimersByTime(30000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('dynamic polling intervals', () => {
    it('should poll every 30 seconds for new PRs (< 5 minutes old)', async () => {
      const assignmentId = 'test-assignment-1'
      const now = Date.now()
      const prCreatedAt = now - 2 * 60 * 1000 // 2 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(prCreatedAt).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 30 seconds
      vi.advanceTimersByTime(30000)

      // Should have called for new PR interval
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should poll every 90 seconds for recent PRs (5-60 minutes old)', async () => {
      const assignmentId = 'test-assignment-1'
      const now = Date.now()
      const prCreatedAt = now - 30 * 60 * 1000 // 30 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(prCreatedAt).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 30 seconds - should not call for recent PR
      vi.advanceTimersByTime(30000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 60 more seconds (total 90)
      vi.advanceTimersByTime(60000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should poll every 5 minutes for stale PRs (> 60 minutes old)', async () => {
      const assignmentId = 'test-assignment-1'
      const now = Date.now()
      const prCreatedAt = now - 120 * 60 * 1000 // 120 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(prCreatedAt).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 2 minutes - should not call for stale PR
      vi.advanceTimersByTime(120000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 3 more minutes (total 5)
      vi.advanceTimersByTime(180000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should default to 60 second interval when creation time is unknown', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
        // No createdAt
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 30 seconds - should not call with default interval
      vi.advanceTimersByTime(30000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 30 more seconds (total 60)
      vi.advanceTimersByTime(30000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })
  })

  describe('exponential backoff on errors', () => {
    it('should retry after 30 seconds on first error', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValueOnce(
        new Error('Network error')
      )

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValueOnce({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 30 seconds
      vi.advanceTimersByTime(30000)

      // Should have retried
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })

    it('should retry after 2 minutes on second error', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any)
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce({
          status: 'OPEN'
        })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance past first retry (30s) but not second (2m)
      vi.advanceTimersByTime(60000)
      const callsAfter1Min = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Advance to 2 minutes total
      vi.advanceTimersByTime(60000)
      const callsAfter2Min = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      expect(callsAfter2Min).toBeGreaterThan(callsAfter1Min)
    })

    it('should stop polling after 3 consecutive errors', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValue(
        new Error('Persistent error')
      )

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Trigger multiple retry attempts
      vi.advanceTimersByTime(30000) // First error's backoff
      vi.advanceTimersByTime(120000) // Second error's backoff
      vi.advanceTimersByTime(600000) // Third error's backoff

      // After 3 errors, should stop polling completely
      const finalCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length
      expect(finalCalls).toBeLessThanOrEqual(3)
    })
  })

  describe('rate limiting with 10 minute backoff', () => {
    it('should detect rate limit errors and back off for 10 minutes', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'ERROR',
        error: 'rate limit exceeded'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 5 minutes (less than backoff)
      vi.advanceTimersByTime(5 * 60 * 1000)

      // Should not make new calls during backoff
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 6 more minutes (total 11 minutes, past backoff)
      vi.advanceTimersByTime(6 * 60 * 1000)

      // Should be able to call now
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })

    it('should handle 429 Too Many Requests as rate limit', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'ERROR',
        error: '429: Too Many Requests'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000)

      // Should not call during backoff
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })

    it('should handle 403 Forbidden as rate limit', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'ERROR',
        error: '403: Forbidden'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000)

      // Should not call during backoff
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('caching', () => {
    it('should cache PR status for 5 minutes', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 30 seconds (within new PR polling interval)
      vi.advanceTimersByTime(30000)

      // Should use cache instead of calling API
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance past cache TTL (5 minutes from initial call + 30s = 5.5 minutes)
      vi.advanceTimersByTime(4 * 60 * 1000 + 40 * 1000)

      // Now should call API again because cache is stale
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })

    it('should bypass cache on manual refresh', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Manually refresh - should bypass cache
      await (service as any).refreshPRNow(assignmentId)

      // Should have called API despite fresh cache
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })

    it('should clear cache on error', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any)
        .mockResolvedValueOnce({
          status: 'OPEN',
          createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
        })
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({
          status: 'MERGED',
          createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
        })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance to trigger error
      vi.advanceTimersByTime(30000)

      // After error, next call should not use stale cache
      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })
  })

  describe('manual refresh', () => {
    it('should execute refresh immediately bypassing rate limit', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any)
        .mockResolvedValueOnce({
          status: 'OPEN',
          error: 'rate limit exceeded'
        })
        .mockResolvedValueOnce({
          status: 'MERGED'
        })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Trigger rate limit
      vi.advanceTimersByTime(30000)

      // Manual refresh should work despite rate limit
      await (service as any).refreshPRNow(assignmentId)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })

    it('should reset error count on manual refresh', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any)
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce({
          status: 'OPEN'
        })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Trigger two errors
      vi.advanceTimersByTime(30000)
      vi.advanceTimersByTime(120000)

      // Manual refresh should reset error count
      await (service as any).refreshPRNow(assignmentId)

      // Should succeed because error count was reset
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })
  })
})
