import { BrowserWindow } from 'electron'
import { AgentService } from './AgentService'

interface PollingJob {
  assignmentId: string
  projectPath: string
  intervalId: NodeJS.Timeout | null
  lastCheckTime: number
  errorCount: number
  isPolling: boolean
}

/**
 * PRPollingService manages automatic polling of PR status across the application.
 * It deduplicates requests so that multiple components watching the same PR
 * result in only a single GitHub API call every 30 seconds.
 */
export class PRPollingService {
  private mainWindow: BrowserWindow
  private agentService: AgentService
  private findProjectPath: ((assignmentId: string) => Promise<string | null>) | null = null

  // Map of assignmentId -> PollingJob
  private pollingJobs: Map<string, PollingJob> = new Map()

  // Track active subscriptions: assignmentId -> Set<subscriberId>
  private subscriptions: Map<string, Set<string>> = new Map()

  // Rate limiting state
  private rateLimitedUntil: number = 0
  private rateLimitBackoffMs: number = 5 * 60 * 1000 // 5 minutes

  constructor(mainWindow: BrowserWindow, agentService: AgentService) {
    this.mainWindow = mainWindow
    this.agentService = agentService
  }

  /**
   * Set the function to find project path for an assignment
   */
  setFindProjectPath(fn: (assignmentId: string) => Promise<string | null>): void {
    this.findProjectPath = fn
  }

  /**
   * Start polling for a specific assignment
   */
  async startPolling(assignmentId: string, subscriberId: string): Promise<void> {
    // Get or create subscription set for this assignment
    if (!this.subscriptions.has(assignmentId)) {
      this.subscriptions.set(assignmentId, new Set())
    }

    const subscribers = this.subscriptions.get(assignmentId)!
    subscribers.add(subscriberId)

    // If already polling, just add subscriber and return
    if (this.pollingJobs.has(assignmentId)) {
      return
    }

    // Create new polling job
    const job: PollingJob = {
      assignmentId,
      projectPath: '', // Will be set on first poll
      intervalId: null,
      lastCheckTime: 0,
      errorCount: 0,
      isPolling: false
    }

    this.pollingJobs.set(assignmentId, job)

    // Start polling immediately, then every 30 seconds
    await this.executePollingCheck(job)

    job.intervalId = setInterval(async () => {
      await this.executePollingCheck(job)
    }, 30000) // 30 seconds
  }

  /**
   * Stop polling for a specific assignment for a subscriber
   */
  async stopPolling(assignmentId: string, subscriberId: string): Promise<void> {
    const subscribers = this.subscriptions.get(assignmentId)
    if (!subscribers) return

    subscribers.delete(subscriberId)

    // If no more subscribers, stop polling
    if (subscribers.size === 0) {
      this.subscriptions.delete(assignmentId)
      this.stopPollingJob(assignmentId)
    }
  }

  /**
   * Stop all polling for a subscriber (called on component unmount)
   */
  async stopAllPolling(subscriberId: string): Promise<void> {
    const assignmentsToStop: string[] = []

    for (const [assignmentId, subscribers] of this.subscriptions.entries()) {
      subscribers.delete(subscriberId)
      if (subscribers.size === 0) {
        assignmentsToStop.push(assignmentId)
      }
    }

    // Stop jobs that have no more subscribers
    for (const assignmentId of assignmentsToStop) {
      this.subscriptions.delete(assignmentId)
      this.stopPollingJob(assignmentId)
    }
  }

  /**
   * Execute a single PR status check
   */
  private async executePollingCheck(job: PollingJob): Promise<void> {
    // Check if rate limited
    if (this.isRateLimited()) {
      return
    }

    // Prevent concurrent checks for same job
    if (job.isPolling) {
      return
    }

    job.isPolling = true

    try {
      // We need to find the project path for this assignment
      // This is a bit tricky since we only have the assignmentId
      // We'll need to get it from the active projects
      const projectPath = await this.findProjectPathForAssignment(job.assignmentId)
      if (!projectPath) {
        // Assignment no longer exists, stop polling
        this.stopPollingJob(job.assignmentId)
        return
      }

      job.projectPath = projectPath

      const result = await this.agentService.checkPullRequestStatus(
        projectPath,
        job.assignmentId,
        { silent: true }
      )

      if (result.error) {
        this.handlePollingError(job, result.error)
      } else {
        // Success - reset error count
        job.errorCount = 0
        job.lastCheckTime = Date.now()

        // Emit update event to refresh UI
        this.mainWindow.webContents.send('assignments:updated')

        // Stop polling if PR is merged or closed
        if (result.status === 'MERGED' || result.status === 'CLOSED') {
          this.stopPollingJob(job.assignmentId)
        }
      }
    } catch (error: any) {
      this.handlePollingError(job, error.message)
    } finally {
      job.isPolling = false
    }
  }

  /**
   * Handle polling errors with retry logic
   */
  private handlePollingError(job: PollingJob, errorMessage: string): void {
    job.errorCount++

    // Check for rate limiting
    if (errorMessage.includes('rate limit') || errorMessage.includes('403') || errorMessage.includes('429')) {
      console.warn('[PRPolling] Rate limited, backing off for 5 minutes')
      this.rateLimitedUntil = Date.now() + this.rateLimitBackoffMs
    }

    // Stop after 3 consecutive errors
    if (job.errorCount >= 3) {
      console.warn(`[PRPolling] Stopping polling for ${job.assignmentId} after 3 errors`)
      this.stopPollingJob(job.assignmentId)
    }
  }

  /**
   * Check if we're currently rate limited
   */
  private isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil
  }

  /**
   * Stop a polling job and clear its interval
   */
  private stopPollingJob(assignmentId: string): void {
    const job = this.pollingJobs.get(assignmentId)
    if (!job) return

    if (job.intervalId) {
      clearInterval(job.intervalId)
      job.intervalId = null
    }

    this.pollingJobs.delete(assignmentId)
  }

  /**
   * Find the project path for an assignment
   */
  private async findProjectPathForAssignment(assignmentId: string): Promise<string | null> {
    if (!this.findProjectPath) {
      return null
    }
    return this.findProjectPath(assignmentId)
  }

  /**
   * Clean up all polling when shutting down
   */
  dispose(): void {
    for (const job of this.pollingJobs.values()) {
      if (job.intervalId) {
        clearInterval(job.intervalId)
      }
    }
    this.pollingJobs.clear()
    this.subscriptions.clear()
  }
}
