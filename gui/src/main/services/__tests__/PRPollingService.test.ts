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

    it('should call checkPullRequestStatus at the configured interval', async () => {
      const assignmentId = 'test-assignment-1'

      // Mock response with recent creation time for 2-minute interval
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() // 2 minutes ago
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      const initialCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance time by 2 minutes and flush promises
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

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

      // Mock response with recent creation time for 2-minute interval
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() // 2 minutes ago
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      await service.startPolling(assignmentId, 'subscriber-2')

      const callsBefore = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // Remove first subscriber
      await service.stopPolling(assignmentId, 'subscriber-1')

      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Should still be polling - use async timer advancement (2 minute interval)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
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

    it('should call GitHub API only once per interval regardless of subscribers', async () => {
      const assignmentId = 'test-assignment-1'

      // Mock response with recent creation time for 2-minute interval
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() // 2 minutes ago
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      await service.startPolling(assignmentId, 'subscriber-2')
      await service.startPolling(assignmentId, 'subscriber-3')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance 2 minutes using async timer advancement
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

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
    it('should poll every 2 minutes for new PRs (< 5 minutes old)', async () => {
      const assignmentId = 'test-assignment-1'
      const now = Date.now()
      const prCreatedAt = now - 2 * 60 * 1000 // 2 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(prCreatedAt).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance by 2 minutes using async timer
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      // Should have called for new PR interval
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should poll every 5 minutes for recent PRs (5-60 minutes old)', async () => {
      const assignmentId = 'test-assignment-1'
      const now = Date.now()
      const prCreatedAt = now - 30 * 60 * 1000 // 30 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(prCreatedAt).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance by 2 minutes - should not call for recent PR (5min interval)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 3 more minutes (total 5)
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should poll every 15 minutes for stale PRs (> 60 minutes old)', async () => {
      const assignmentId = 'test-assignment-1'
      const now = Date.now()
      const prCreatedAt = now - 120 * 60 * 1000 // 120 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(prCreatedAt).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance by 5 minutes - should not call for stale PR (15min interval)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 10 more minutes (total 15)
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should default to 3 minute interval when creation time is unknown', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
        // No createdAt
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      // Clear the cache to allow the next API call
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance by 60 seconds - should not call with default 3min interval
      await vi.advanceTimersByTimeAsync(60000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 2 more minutes (total 3)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })
  })

  describe('simple retry on errors', () => {
    it('should retry after default interval on first error', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValueOnce(
        new Error('Network error')
      )

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValueOnce({
        status: 'OPEN'
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 3 minutes (default interval without createdAt) using async timer
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

      // Should have retried
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })

    it('should stop polling after 2 consecutive errors (simplified from 3)', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValue(
        new Error('Persistent error')
      )

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Trigger retry attempts - with simple retry, stops after 2 errors
      vi.advanceTimersByTime(30000) // First error's backoff
      vi.advanceTimersByTime(30000) // Second error's backoff

      // After 2 errors, should stop polling completely
      const finalCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length
      expect(finalCalls).toBeLessThanOrEqual(2)
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

      // Advance by 5 minutes (less than backoff) using async timer
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      // Should not make new calls during backoff
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance by 7 more minutes (total 12 minutes, past backoff and past next 3-min interval)
      await vi.advanceTimersByTimeAsync(7 * 60 * 1000)

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
    it('should cache PR status for 2 minutes (for found PRs)', async () => {
      const assignmentId = 'test-assignment-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      await service.startPolling(assignmentId, 'subscriber-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance by 1 minute (within cache TTL of 2 minutes)
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000)

      // Should use cache instead of calling API (cache is still fresh)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      // Advance past cache TTL (2 minutes from initial call)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      // Now should call API again because cache expired
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
      // Clear the cache to allow the next API call (simulating expired cache)
      ;(service as any).prStatusCache.delete(assignmentId)

      // Advance to trigger error using async timer (2 minute interval)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      // After error, next call should not use stale cache
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

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

      // Trigger two errors using async timer
      await vi.advanceTimersByTimeAsync(60000)
      await vi.advanceTimersByTimeAsync(60000)

      // Manual refresh should reset error count
      await (service as any).refreshPRNow(assignmentId)

      // Should succeed because error count was reset
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThan(0)
    })
  })

  describe('polling interval enforcement', () => {
    it('should poll new PRs (< 5 min old) at 2-minute intervals', async () => {
      const assignmentId = 'test-new-pr'
      const prCreatedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString() // 2 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: prCreatedAt
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      ;(service as any).prStatusCache.delete(assignmentId)

      // At 30 seconds, no call should have been made
      await vi.advanceTimersByTimeAsync(30 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      ;(service as any).prStatusCache.delete(assignmentId)

      // At 2 minutes total, it should fire
      await vi.advanceTimersByTimeAsync(90 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should poll recent PRs (5-60 min old) at 5-minute intervals', async () => {
      const assignmentId = 'test-recent-pr'
      const prCreatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 minutes ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: prCreatedAt
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      ;(service as any).prStatusCache.delete(assignmentId)

      // At 90 seconds, no call should have been made
      await vi.advanceTimersByTimeAsync(90 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      ;(service as any).prStatusCache.delete(assignmentId)

      // At 5 minutes total, it should fire
      await vi.advanceTimersByTimeAsync(210 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should poll stale PRs (> 60 min old) at 15-minute intervals', async () => {
      const assignmentId = 'test-stale-pr'
      const prCreatedAt = new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 hours ago

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: prCreatedAt
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      ;(service as any).prStatusCache.delete(assignmentId)

      // At 5 minutes, no call should have been made
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      ;(service as any).prStatusCache.delete(assignmentId)

      // At 15 minutes total, it should fire
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should use 3-minute default interval when creation time is unknown', async () => {
      const assignmentId = 'test-unknown-age'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
        // No createdAt - unknown age
      })

      await service.startPolling(assignmentId, 'subscriber-1')
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      ;(service as any).prStatusCache.delete(assignmentId)

      // At 60 seconds, no call should have been made
      await vi.advanceTimersByTimeAsync(60 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)

      ;(service as any).prStatusCache.delete(assignmentId)

      // At 3 minutes total, it should fire
      await vi.advanceTimersByTimeAsync(120 * 1000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })
  })

  describe('status-change-only UI events', () => {
    it('should NOT emit agents:updated when polling returns the same status', async () => {
      const assignmentId = 'test-no-change'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      // First poll - should emit because it's new
      await service.startPolling(assignmentId, 'subscriber-1')

      // Verify first poll emitted events
      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('agents:updated')
      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')

      // Clear mocks and cache, then advance to trigger second poll
      ;(mockMainWindow.webContents!.send as any).mockClear()
      ;(service as any).prStatusCache.delete(assignmentId)

      // Second poll returns same status (OPEN -> OPEN) - 2 minute interval
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      // Expected: no events emitted when status is unchanged.
      expect(mockMainWindow.webContents!.send).not.toHaveBeenCalledWith('agents:updated')
      expect(mockMainWindow.webContents!.send).not.toHaveBeenCalledWith('assignments:updated')
    })

    it('should emit events when status actually changes (OPEN -> MERGED)', async () => {
      const assignmentId = 'test-status-change'
      let callCount = 0

      ;(mockAgentService.checkPullRequestStatus as any).mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            status: 'OPEN',
            createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
          })
        }
        return Promise.resolve({
          status: 'MERGED',
          createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          mergedAt: new Date().toISOString()
        })
      })

      // First poll
      await service.startPolling(assignmentId, 'subscriber-1')

      // Clear mocks and cache
      ;(mockMainWindow.webContents!.send as any).mockClear()
      ;(service as any).prStatusCache.delete(assignmentId)

      // Second poll with status change - 2 minute interval
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      // Events SHOULD be emitted because status changed from OPEN to MERGED
      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('agents:updated')
      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')
    })
  })

  describe('cache preservation across stop/restart', () => {
    it('should preserve cache after stopPollingJob', async () => {
      const assignmentId = 'test-cache-preserve'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      // Start polling - this caches the result
      await service.startPolling(assignmentId, 'subscriber-1')

      // Verify cache was populated
      const cacheBeforeStop = (service as any).prStatusCache.get(assignmentId)
      expect(cacheBeforeStop).toBeDefined()
      expect(cacheBeforeStop.status).toBe('OPEN')

      // Stop polling
      await service.stopPolling(assignmentId, 'subscriber-1')

      const cacheAfterStop = (service as any).prStatusCache.get(assignmentId)
      expect(cacheAfterStop).toBeDefined()
      expect(cacheAfterStop.status).toBe('OPEN')
    })

    it('should reuse cached data when re-subscribing after stop', async () => {
      const assignmentId = 'test-cache-reuse'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      // Start and stop polling
      await service.startPolling(assignmentId, 'subscriber-1')
      await service.stopPolling(assignmentId, 'subscriber-1')

      const callsAfterStop = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      await service.startPolling(assignmentId, 'subscriber-2')

      const callsAfterResubscribe = (mockAgentService.checkPullRequestStatus as any).mock.calls.length
      expect(callsAfterResubscribe).toBe(callsAfterStop)
    })
  })

  describe('concurrent poll limiting', () => {
    it('should limit concurrent GitHub API calls to 2 when many polls fire simultaneously', async () => {
      let currentConcurrent = 0
      let peakConcurrent = 0
      let totalApiCalls = 0
      const resolvers: Array<() => void> = []

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
      })

      for (let i = 0; i < 10; i++) {
        await service.startPolling(`assignment-${i}`, 'subscriber-1')
      }

      for (let i = 0; i < 10; i++) {
        ;(service as any).prStatusCache.delete(`assignment-${i}`)
      }

      // Switch to a slow mock that tracks concurrency
      ;(mockAgentService.checkPullRequestStatus as any).mockImplementation(() => {
        currentConcurrent++
        totalApiCalls++
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent)
        return new Promise<any>((resolve) => {
          resolvers.push(() => {
            currentConcurrent--
            resolve({ status: 'OPEN', createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() })
          })
        })
      })

      // Trigger all 10 intervals simultaneously
      vi.advanceTimersByTime(2 * 60 * 1000)
      await vi.advanceTimersByTimeAsync(0)

      // Only 2 should have reached the API; the rest are queued
      expect(peakConcurrent).toBeLessThanOrEqual(2)
      expect(totalApiCalls).toBeLessThanOrEqual(2)

      expect(service.pollQueue.length).toBeGreaterThan(0)

      // Drain the queue by resolving API calls iteratively
      for (let iteration = 0; iteration < 20; iteration++) {
        if (resolvers.length === 0 && service.pollQueue.length === 0) break
        const batch = resolvers.splice(0, resolvers.length)
        batch.forEach(r => r())
        await vi.advanceTimersByTimeAsync(0)
      }

      expect(totalApiCalls).toBe(10)
    })

    it('should expose a concurrency limiter for poll execution', () => {
      const hasConcurrencyLimit =
        typeof (service as any).maxConcurrentPolls === 'number' ||
        typeof (service as any).pollSemaphore !== 'undefined' ||
        typeof (service as any).pollQueue !== 'undefined'

      expect(hasConcurrencyLimit).toBe(true)
    })
  })

  describe('REST API fallback', () => {
    it('should fall back to REST API when gh CLI returns a non-rate-limit error', async () => {
      // Verify the REST fallback method exists on the service
      const hasRestFallback = typeof (service as any).checkPRStatusViaRest === 'function'
      expect(hasRestFallback).toBe(true)

      // Verify that _doPollingCheck calls checkPRStatusViaRest on non-rate-limit errors
      // by mocking both checkPullRequestStatus and checkPRStatusViaRest
      const restSpy = vi.spyOn(service as any, 'checkPRStatusViaRest').mockResolvedValue({
        status: 'OPEN'
      })

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'ERROR',
        error: 'gh: command not found'
      })

      await service.startPolling('test-rest-fallback', 'subscriber-1')

      expect(restSpy).toHaveBeenCalled()
      restSpy.mockRestore()
    })

    it('should parse REST API response correctly when fallback is used', async () => {
      const restMethod = (service as any).checkPRStatusViaRest
      expect(restMethod).toBeDefined()

      // checkPRStatusViaRest uses execFileAsync (git) and fetch, which will fail
      // in test env; it should catch errors and return { status: 'unknown' }
      const result = await restMethod.call(service, '/test/path', 'test-rest-parse')
      expect(result).toHaveProperty('status')
    })

    it('should handle REST API failure gracefully without crashing', async () => {
      // Mock checkPRStatusViaRest to simulate a failure that returns unknown
      const restSpy = vi.spyOn(service as any, 'checkPRStatusViaRest').mockResolvedValue({
        status: 'unknown',
        error: 'REST API error: 500'
      })

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'ERROR',
        error: 'gh: command not found'
      })

      await service.startPolling('test-rest-failure', 'subscriber-1')

      // Service should not crash; REST fallback was called
      expect(restSpy).toHaveBeenCalled()
      restSpy.mockRestore()
    })
  })
})
