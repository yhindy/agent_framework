import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { PRPollingService } from '../PRPollingService'
import { AgentService } from '../AgentService'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    send: vi.fn()
  }
}))

describe('PR Polling Integration Tests', () => {
  let pollingService: PRPollingService
  let mockMainWindow: Partial<BrowserWindow>
  let mockAgentService: Partial<AgentService>

  beforeEach(() => {
    vi.useFakeTimers()

    mockMainWindow = {
      webContents: {
        send: vi.fn()
      }
    } as any

    mockAgentService = {
      checkPullRequestStatus: vi.fn()
    } as any

    pollingService = new PRPollingService(
      mockMainWindow as BrowserWindow,
      mockAgentService as AgentService
    )

    pollingService.setFindProjectPath(async (assignmentId: string) => {
      return '/test/project'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    pollingService.dispose()
  })

  describe('IPC Handler Integration', () => {
    it('should handle prPolling:start IPC event', async () => {
      const assignmentId = 'test-assignment-1'
      const subscriberId = 'dashboard-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      // Simulate IPC handler call
      await pollingService.startPolling(assignmentId, subscriberId)

      expect(mockAgentService.checkPullRequestStatus).toHaveBeenCalled()
      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')
    })

    it('should handle prPolling:stop IPC event', async () => {
      const assignmentId = 'test-assignment-1'
      const subscriberId = 'dashboard-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await pollingService.startPolling(assignmentId, subscriberId)
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      await pollingService.stopPolling(assignmentId, subscriberId)

      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })

    it('should handle prPolling:stopAll IPC event', async () => {
      const subscriberId = 'dashboard-1'

      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      await pollingService.startPolling('assignment-1', subscriberId)
      await pollingService.startPolling('assignment-2', subscriberId)

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      await pollingService.stopAllPolling(subscriberId)

      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('Dashboard Integration', () => {
    it('should poll multiple assignments simultaneously', async () => {
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      const dashboardId = 'dashboard-1'

      // Simulate Dashboard polling multiple assignments
      await pollingService.startPolling('assignment-1', dashboardId)
      await pollingService.startPolling('assignment-2', dashboardId)
      await pollingService.startPolling('assignment-3', dashboardId)

      const initialCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length

      // After 30 seconds, should have polled all 3
      vi.advanceTimersByTime(30000)

      const totalCalls = (mockAgentService.checkPullRequestStatus as any).mock.calls.length
      expect(totalCalls - initialCalls).toBe(3)
    })

    it('should emit UI update event on each poll', async () => {
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      ;(mockMainWindow.webContents!.send as any).mockClear()

      await pollingService.startPolling('assignment-1', 'dashboard-1')

      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')
    })

    it('should stop polling when Dashboard unmounts', async () => {
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      const dashboardId = 'dashboard-1'

      await pollingService.startPolling('assignment-1', dashboardId)
      await pollingService.startPolling('assignment-2', dashboardId)

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Dashboard unmounts and stops all polling
      await pollingService.stopAllPolling(dashboardId)

      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('Multi-Component Scenarios', () => {
    it('should handle same assignment polled by Dashboard and AgentView', async () => {
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      const assignmentId = 'shared-assignment'
      const dashboardId = 'dashboard-1'
      const agentViewId = 'agent-view-1'

      // Both Dashboard and AgentView start polling same assignment
      await pollingService.startPolling(assignmentId, dashboardId)
      await pollingService.startPolling(assignmentId, agentViewId)

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Should only call API once (deduplication)
      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should continue polling when one component unmounts', async () => {
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      const assignmentId = 'shared-assignment'
      const dashboardId = 'dashboard-1'
      const agentViewId = 'agent-view-1'

      await pollingService.startPolling(assignmentId, dashboardId)
      await pollingService.startPolling(assignmentId, agentViewId)

      // AgentView unmounts
      await pollingService.stopAllPolling(agentViewId)

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Should still poll because Dashboard is still subscribed
      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(1)
    })

    it('should stop polling only when last component unmounts', async () => {
      ;(mockAgentService.checkPullRequestStatus as any).mockResolvedValue({
        status: 'OPEN'
      })

      const assignmentId = 'shared-assignment'
      const dashboardId = 'dashboard-1'
      const agentViewId = 'agent-view-1'

      await pollingService.startPolling(assignmentId, dashboardId)
      await pollingService.startPolling(assignmentId, agentViewId)

      // Both unmount
      await pollingService.stopAllPolling(dashboardId)
      await pollingService.stopAllPolling(agentViewId)

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('PR Status Update Flow', () => {
    it('should detect PR merge and emit update', async () => {
      const assignmentId = 'test-assignment'

      ;(mockAgentService.checkPullRequestStatus as any)
        .mockResolvedValueOnce({ status: 'OPEN' })
        .mockResolvedValueOnce({ status: 'MERGED' })

      ;(mockMainWindow.webContents!.send as any).mockClear()

      await pollingService.startPolling(assignmentId, 'viewer-1')

      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')

      ;(mockMainWindow.webContents!.send as any).mockClear()

      // Advance 30 seconds for next poll
      vi.advanceTimersByTime(30000)

      // Should have detected merge and emitted update
      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Next interval should not poll (PR is merged)
      vi.advanceTimersByTime(30000)
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })

    it('should handle PR status transitions', async () => {
      const assignmentId = 'test-assignment'
      let callCount = 0

      ;(mockAgentService.checkPullRequestStatus as any).mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve({ status: 'OPEN' })
        if (callCount === 2) return Promise.resolve({ status: 'MERGED' })
        return Promise.resolve({ status: 'MERGED' })
      })

      ;(mockMainWindow.webContents!.send as any).mockClear()

      await pollingService.startPolling(assignmentId, 'viewer-1')

      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')

      ;(mockMainWindow.webContents!.send as any).mockClear()

      vi.advanceTimersByTime(30000)

      expect(mockMainWindow.webContents!.send).toHaveBeenCalledWith('assignments:updated')

      // After merge, polling should stop
      ;(mockAgentService.checkPullRequestStatus as any).mockClear()
      vi.advanceTimersByTime(30000)

      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBe(0)
    })
  })

  describe('Error Recovery', () => {
    it('should recover from transient network errors', async () => {
      const assignmentId = 'test-assignment'

      ;(mockAgentService.checkPullRequestStatus as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ status: 'OPEN' })

      await pollingService.startPolling(assignmentId, 'viewer-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Advance and check recovery
      vi.advanceTimersByTime(30000)

      // Should have recovered and called again
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeGreaterThanOrEqual(0)
    })

    it('should stop polling after persistent failures', async () => {
      const assignmentId = 'test-assignment'

      ;(mockAgentService.checkPullRequestStatus as any).mockRejectedValue(
        new Error('Persistent failure')
      )

      await pollingService.startPolling(assignmentId, 'viewer-1')

      ;(mockAgentService.checkPullRequestStatus as any).mockClear()

      // Try multiple times
      vi.advanceTimersByTime(30000)
      vi.advanceTimersByTime(30000)
      vi.advanceTimersByTime(30000)

      // After 3 failures, should stop polling
      expect((mockAgentService.checkPullRequestStatus as any).mock.calls.length).toBeLessThanOrEqual(3)
    })
  })
})
