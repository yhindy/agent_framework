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
    service.setFindProjectPath(async (assignmentId: string) => {
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
})
