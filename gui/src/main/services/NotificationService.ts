import { Notification, BrowserWindow } from 'electron'

export interface NotificationOptions {
  title: string
  body: string
  agentId?: string
}

const COOLDOWN_MS = 30000 // 30 seconds between notifications for the same agent

export class NotificationService {
  private cooldowns: Map<string, number> = new Map()
  private windowFocused: boolean = true
  private mainWindow: BrowserWindow | null = null

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.windowFocused = mainWindow.isFocused()
  }

  setWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.windowFocused = mainWindow.isFocused()
  }

  setWindowFocus(focused: boolean): void {
    this.windowFocused = focused
  }

  isWindowFocused(): boolean {
    return this.windowFocused
  }

  notify(options: NotificationOptions): boolean {
    const { title, body, agentId } = options

    // Only notify when window is unfocused
    if (this.windowFocused) {
      return false
    }

    // Check cooldown for this agent
    if (agentId && !this.shouldNotify(agentId)) {
      return false
    }

    try {
      // Create and show notification
      const notification = new Notification({
        title,
        body,
        silent: false,
        urgency: 'normal'
      })

      // Handle click - bring window to front
      notification.on('click', () => {
        if (this.mainWindow) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore()
          }
          this.mainWindow.focus()

          // Navigate to the agent if agentId is provided
          if (agentId) {
            this.mainWindow.webContents.send('notification:clicked', agentId)
          }
        }
      })

      notification.show()
    } catch (error) {
      console.error('[NotificationService] Failed to show notification:', error)
      return false
    }

    // Update cooldown for this agent
    if (agentId) {
      this.cooldowns.set(agentId, Date.now())
    }

    return true
  }

  private shouldNotify(agentId: string): boolean {
    const lastNotified = this.cooldowns.get(agentId)
    if (!lastNotified) {
      return true
    }

    const timeSinceLastNotification = Date.now() - lastNotified
    return timeSinceLastNotification >= COOLDOWN_MS
  }

  /**
   * Clear the cooldown for a specific agent (useful for testing)
   */
  clearCooldown(agentId: string): void {
    this.cooldowns.delete(agentId)
  }

  /**
   * Clear all cooldowns (useful for testing)
   */
  clearAllCooldowns(): void {
    this.cooldowns.clear()
  }
}
