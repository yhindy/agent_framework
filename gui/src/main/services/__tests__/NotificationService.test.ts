import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NotificationService } from '../NotificationService'
import { BrowserWindow, Notification } from 'electron'

// Mock Electron
vi.mock('electron', () => {
  const mockNotificationInstance = {
    show: vi.fn(),
    on: vi.fn()
  }
  return {
    BrowserWindow: vi.fn(),
    Notification: vi.fn().mockImplementation(() => mockNotificationInstance),
    ipcMain: { on: vi.fn(), handle: vi.fn() }
  }
})

describe('NotificationService', () => {
  let notificationService: NotificationService
  let mockMainWindow: any
  let mockWebContents: any

  beforeEach(() => {
    vi.useFakeTimers()

    // Setup Mock Window & WebContents
    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents,
      isFocused: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      focus: vi.fn()
    } as unknown as BrowserWindow

    notificationService = new NotificationService(mockMainWindow)
    notificationService.clearAllCooldowns()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('cooldown behavior', () => {
    it('sends notification on first event', () => {
      notificationService.setWindowFocus(false)

      const result = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      expect(result).toBe(true)
      expect(Notification).toHaveBeenCalledWith({
        title: 'Input Required',
        body: 'Agent is waiting',
        silent: false,
        urgency: 'normal'
      })
    })

    it('should respect 30s cooldown for same agent', () => {
      notificationService.setWindowFocus(false)

      // First notification
      const result1 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })
      expect(result1).toBe(true)

      // Advance time but not past cooldown (30s)
      vi.advanceTimersByTime(15000) // 15 seconds

      // Clear mock to track new calls
      vi.mocked(Notification).mockClear()

      // Second notification for same agent should be blocked
      const result2 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting again',
        agentId: 'agent-1'
      })
      expect(result2).toBe(false)
      expect(Notification).not.toHaveBeenCalled()
    })

    it('should allow notification after 30s cooldown expires', () => {
      notificationService.setWindowFocus(false)

      // First notification
      notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      // Advance time past cooldown (30s)
      vi.advanceTimersByTime(31000)

      // Clear mock to track new calls
      vi.mocked(Notification).mockClear()

      // Second notification for same agent should now work
      const result = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting again',
        agentId: 'agent-1'
      })
      expect(result).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })

    it('tracks cooldowns per-agent independently', () => {
      notificationService.setWindowFocus(false)

      // Notification for agent-1
      const result1 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent 1 waiting',
        agentId: 'agent-1'
      })
      expect(result1).toBe(true)

      // Advance time 15s (within cooldown)
      vi.advanceTimersByTime(15000)

      vi.mocked(Notification).mockClear()

      // Notification for agent-2 should still work (different agent)
      const result2 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent 2 waiting',
        agentId: 'agent-2'
      })
      expect(result2).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })

    it('should clear cooldown when explicitly requested', () => {
      notificationService.setWindowFocus(false)

      // First notification
      const result1 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })
      expect(result1).toBe(true)

      // Advance time by only 5 seconds (well within cooldown)
      vi.advanceTimersByTime(5000)

      // Clear mock
      vi.mocked(Notification).mockClear()

      // Without clearing cooldown, this should fail
      const result2 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting again',
        agentId: 'agent-1'
      })
      expect(result2).toBe(false)

      // Now clear the cooldown
      notificationService.clearCooldown('agent-1')

      // Clear mock again
      vi.mocked(Notification).mockClear()

      // Notification should now work immediately
      const result3 = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting yet again',
        agentId: 'agent-1'
      })
      expect(result3).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })

    it('should allow immediate notification after cooldown cleared', () => {
      notificationService.setWindowFocus(false)

      // Send notification
      notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      // Clear cooldown immediately (simulating user providing input)
      notificationService.clearCooldown('agent-1')

      // Clear mock
      vi.mocked(Notification).mockClear()

      // Immediate notification should work
      const result = notificationService.notify({
        title: 'Input Required',
        body: 'Agent needs input again',
        agentId: 'agent-1'
      })
      expect(result).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })
  })

  describe('window focus behavior', () => {
    it('sends notification when window unfocused', () => {
      notificationService.setWindowFocus(false)

      const result = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      expect(result).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })

    it('skips notification when window focused', () => {
      notificationService.setWindowFocus(true)

      const result = notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      expect(result).toBe(false)
      expect(Notification).not.toHaveBeenCalled()
    })

    it('tracks focus state correctly via setWindowFocus', () => {
      // Start unfocused
      notificationService.setWindowFocus(false)
      expect(notificationService.isWindowFocused()).toBe(false)

      // Become focused
      notificationService.setWindowFocus(true)
      expect(notificationService.isWindowFocused()).toBe(true)

      // Become unfocused again
      notificationService.setWindowFocus(false)
      expect(notificationService.isWindowFocused()).toBe(false)
    })
  })

  describe('notification interactions', () => {
    it('brings window to front on click', () => {
      notificationService.setWindowFocus(false)

      notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      // Get the mock notification instance and its click handler
      const mockNotificationInstance = vi.mocked(Notification).mock.results[0].value
      const clickHandler = mockNotificationInstance.on.mock.calls.find(
        (call: any[]) => call[0] === 'click'
      )?.[1]

      expect(clickHandler).toBeDefined()

      // Simulate click
      clickHandler()

      // Should focus window
      expect(mockMainWindow.focus).toHaveBeenCalled()
    })

    it('restores window if minimized on click', () => {
      mockMainWindow.isMinimized.mockReturnValue(true)
      notificationService.setWindowFocus(false)

      notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      const mockNotificationInstance = vi.mocked(Notification).mock.results[0].value
      const clickHandler = mockNotificationInstance.on.mock.calls.find(
        (call: any[]) => call[0] === 'click'
      )?.[1]

      clickHandler()

      expect(mockMainWindow.restore).toHaveBeenCalled()
      expect(mockMainWindow.focus).toHaveBeenCalled()
    })

    it('sends notification:clicked event with agentId on click', () => {
      notificationService.setWindowFocus(false)

      notificationService.notify({
        title: 'Input Required',
        body: 'Agent is waiting',
        agentId: 'agent-1'
      })

      const mockNotificationInstance = vi.mocked(Notification).mock.results[0].value
      const clickHandler = mockNotificationInstance.on.mock.calls.find(
        (call: any[]) => call[0] === 'click'
      )?.[1]

      clickHandler()

      expect(mockWebContents.send).toHaveBeenCalledWith('notification:clicked', 'agent-1')
    })
  })

  describe('notifications without agentId', () => {
    it('sends notification without cooldown when no agentId', () => {
      notificationService.setWindowFocus(false)

      // First notification without agentId
      const result1 = notificationService.notify({
        title: 'Info',
        body: 'Something happened'
      })
      expect(result1).toBe(true)

      // Second notification without agentId should also work immediately
      vi.mocked(Notification).mockClear()

      const result2 = notificationService.notify({
        title: 'Info',
        body: 'Something else happened'
      })
      expect(result2).toBe(true)
      expect(Notification).toHaveBeenCalled()
    })
  })
})
