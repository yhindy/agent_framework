import { Notification, BrowserWindow } from 'electron'
import { SettingsService } from './SettingsService'

export interface NotificationOptions {
  title: string
  body: string
  agentId?: string
}

export class NotificationService {
  private cooldowns: Map<string, number> = new Map()
  private windowFocused: boolean = true
  private mainWindow: BrowserWindow | null = null
  private settingsService: SettingsService

  constructor(mainWindow: BrowserWindow, settingsService: SettingsService) {
    this.mainWindow = mainWindow
    this.settingsService = settingsService
    this.windowFocused = mainWindow.isFocused()
  }

  private getCooldownMs(): number {
    const settings = this.settingsService.getSettings()
    return settings.notifications.cooldownSeconds * 1000
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

    // Check if notifications are enabled in settings
    const settings = this.settingsService.getSettings()
    if (!settings.notifications.enabled) {
      return false
    }

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
    return timeSinceLastNotification >= this.getCooldownMs()
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
