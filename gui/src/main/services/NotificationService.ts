import { Notification, BrowserWindow } from 'electron'
import { SettingsService } from './SettingsService'

export interface NotificationOptions {
  title: string
  body: string
  agentId?: string
}

type NotificationUrgency = 'low' | 'normal' | 'critical'

interface InternalNotificationOptions {
  title: string
  body: string
  agentId?: string
  silent?: boolean
  urgency?: NotificationUrgency
  navigateOnClick?: boolean
}

const LOG_PREFIX = '[NotificationService]'

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

  /**
   * Internal helper to show notifications with common click handling.
   */
  private showNotification(options: InternalNotificationOptions): boolean {
    const { title, body, agentId, silent = false, urgency = 'normal', navigateOnClick = true } = options

    try {
      const notification = new Notification({ title, body, silent, urgency })

      if (navigateOnClick) {
        notification.on('click', () => this.handleNotificationClick(agentId))
      }

      notification.show()
      return true
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to show notification:`, error)
      return false
    }
  }

  /**
   * Handle notification click - restore window and navigate to agent.
   */
  private handleNotificationClick(agentId?: string): void {
    if (!this.mainWindow) return

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore()
    }
    this.mainWindow.focus()

    if (agentId) {
      this.mainWindow.webContents.send('notification:clicked', agentId)
    }
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

    const result = this.showNotification({ title, body, agentId })

    // Update cooldown for this agent on success
    if (result && agentId) {
      this.cooldowns.set(agentId, Date.now())
    }

    return result
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

  /**
   * Notify user that session resume failed with a specific reason.
   * Always shows (ignores cooldown) since this is a critical error.
   */
  notifySessionResumeFailed(agentId: string, agentName: string, reason: string): boolean {
    return this.showNotification({
      title: 'Session Resume Failed',
      body: `${agentName}: ${reason}\n\nClick to view recovery options.`,
      agentId,
      urgency: 'critical'
    })
  }

  /**
   * Notify user that we're retrying session resume.
   * Only shows every other retry to avoid spam.
   */
  notifySessionResumeRetrying(agentName: string, attempt: number, maxAttempts: number): boolean {
    if (attempt % 2 !== 0) {
      return false
    }

    return this.showNotification({
      title: 'Retrying Session Resume',
      body: `${agentName}: Attempt ${attempt} of ${maxAttempts}`,
      silent: true,
      urgency: 'low',
      navigateOnClick: false
    })
  }

  /**
   * Notify user that session resume retry succeeded.
   */
  notifySessionResumeSuccess(agentId: string, agentName: string): boolean {
    return this.showNotification({
      title: 'Session Resume Successful',
      body: `${agentName} has been successfully resumed.`,
      agentId
    })
  }
}
