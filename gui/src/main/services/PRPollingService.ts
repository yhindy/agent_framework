import { BrowserWindow } from 'electron'
import { AgentService } from './AgentService'
import { createLogger } from './logger'

const log = createLogger('PRPollingService')

interface PollingJob {
  assignmentId: string
  projectPath: string
  intervalId: NodeJS.Timeout | null
  lastCheckTime: number
  errorCount: number
  isPolling: boolean
  prCreatedAt: number | null
  isManualRefresh: boolean
}

interface CachedPRStatus {
  status: string
  timestamp: number
  mergedAt?: string
  isError?: boolean
}

/**
 * PRPollingService manages automatic polling of PR status across the application.
 * It deduplicates requests so that multiple components watching the same PR
 * result in only a single GitHub API call.
 *
 * Key features:
 * - Subscription-based polling (components subscribe/unsubscribe with unique IDs)
 * - Adaptive polling intervals based on PR age
 * - Differentiated caching for found/not-found/error results
 * - In-flight request deduplication
 * - Rate limit detection with automatic backoff
 *
 * Polling intervals (based on PR age):
 * - New PRs (< 5 min): 30 seconds
 * - Recent PRs (5-60 min): 90 seconds
 * - Stale PRs (> 60 min): 5 minutes
 *
 * Cache TTLs:
 * - Found PRs: 5 minutes
 * - Not found: 30 seconds
 * - API errors: 10 seconds
 */
export class PRPollingService {
  private mainWindow: BrowserWindow
  private agentService: AgentService
  private findProjectPath: ((assignmentId: string) => Promise<string | null>) | null = null

  // Map of assignmentId -> PollingJob
  private pollingJobs: Map<string, PollingJob> = new Map()

  // Track active subscriptions: assignmentId -> Set<subscriberId>
  private subscriptions: Map<string, Set<string>> = new Map()

  // Cache for PR status: assignmentId -> CachedPRStatus
  private prStatusCache: Map<string, CachedPRStatus> = new Map()

  // Rate limiting state
  private rateLimitedUntil: number = 0
  private rateLimitBackoffMs: number = 10 * 60 * 1000 // 10 minutes

  // Differentiated cache TTLs
  private readonly POSITIVE_CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes for found PRs
  private readonly NEGATIVE_CACHE_TTL_MS = 30 * 1000      // 30 seconds for not-found
  private readonly ERROR_CACHE_TTL_MS = 10 * 1000         // 10 seconds for API errors

  // Track in-flight detection requests
  private inFlightDetection: Map<string, Promise<void>> = new Map()

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
      isPolling: false,
      prCreatedAt: null,
      isManualRefresh: false
    }

    this.pollingJobs.set(assignmentId, job)

    // Start polling immediately
    await this.executePollingCheck(job)

    // Schedule next poll with dynamic interval
    this.scheduleNextPoll(job)
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
   * Manually refresh PR status immediately.
   * Works even without an active polling job.
   */
  async refreshPRNow(assignmentId: string): Promise<void> {
    // Clear cache to force fresh API call
    this.prStatusCache.delete(assignmentId)

    const job = this.pollingJobs.get(assignmentId)
    if (job) {
      // Mark as manual refresh to bypass backoff
      job.isManualRefresh = true
      job.errorCount = 0 // Reset error count on manual refresh

      // Execute check immediately
      await this.executePollingCheck(job)

      // Reschedule polling
      this.scheduleNextPoll(job)
    } else {
      // No active polling job, but still perform a one-off check
      await this.performOneOffCheck(assignmentId)
    }
  }

  /**
   * Perform a one-off PR status check without starting polling.
   * Used for manual refresh when no polling job exists.
   */
  private async performOneOffCheck(assignmentId: string): Promise<void> {
    // Find project path
    const projectPath = await this.findProjectPathForAssignment(assignmentId)
    if (!projectPath) return

    try {
      const result = await this.agentService.checkPullRequestStatus(
        projectPath,
        assignmentId,
        { silent: true }
      )

      if (!result.error) {
        // Cache the result
        this.prStatusCache.set(assignmentId, {
          status: result.status,
          timestamp: Date.now(),
          mergedAt: result.mergedAt
        })

        // Emit update event to refresh UI
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('assignments:updated')
        }
      } else {
        // Cache error briefly
        this.prStatusCache.set(assignmentId, {
          status: 'ERROR',
          timestamp: Date.now(),
          isError: true
        })
      }
    } catch (error: any) {
      log.warn(`One-off PR check failed for ${assignmentId}:`, error.message)
      this.prStatusCache.set(assignmentId, {
        status: 'ERROR',
        timestamp: Date.now(),
        isError: true
      })
    }
  }

  /**
   * Handle notification that a PR was just created.
   * Clears cache and uses retry logic to detect the PR (handles GitHub indexing lag).
   *
   * @param projectPath - Path to the project
   * @param assignmentId - Assignment ID
   * @returns Promise that resolves when detection completes (non-blocking)
   */
  async onPRCreated(projectPath: string, assignmentId: string): Promise<void> {
    log.info(`onPRCreated: Starting detection for ${assignmentId}`)

    const inFlight = this.inFlightDetection.get(assignmentId)
    if (inFlight) {
      log.info(`onPRCreated: Detection already in-flight for ${assignmentId}`)
      return inFlight
    }

    this.prStatusCache.delete(assignmentId)
    this.agentService.clearPRDetectionCache(projectPath, assignmentId)

    const detectionPromise = (async () => {
      try {
        const result = await this.agentService.detectExistingPullRequestWithRetry(
          projectPath,
          assignmentId,
          3
        )

        if (result?.found) {
          log.info(`onPRCreated: PR detected for ${assignmentId}:`, result.prUrl)
          this.prStatusCache.set(assignmentId, {
            status: result.prStatus || 'OPEN',
            timestamp: Date.now()
          })
          this.notifyPRCreated(assignmentId, result.prUrl, result.prStatus)
        } else {
          log.warn(`onPRCreated: PR not found after retries for ${assignmentId}`)
        }
      } catch (error: any) {
        log.error(`onPRCreated: Error detecting PR for ${assignmentId}:`, error.message)
      } finally {
        this.inFlightDetection.delete(assignmentId)
      }
    })()

    this.inFlightDetection.set(assignmentId, detectionPromise)
    return detectionPromise
  }

  /**
   * Notify the UI that a PR was created or detected.
   */
  private notifyPRCreated(assignmentId: string, prUrl?: string, prStatus?: string): void {
    if (this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('pr:created', { assignmentId, prUrl, prStatus })
    this.mainWindow.webContents.send('assignments:updated')
  }

  /**
   * Force refresh PR status for an assignment, bypassing all caches.
   * Used when navigating to an agent view to ensure fresh data.
   *
   * @param assignmentId - Assignment ID
   * @returns The detection result
   */
  async forceRefreshPR(assignmentId: string): Promise<{
    found: boolean
    prUrl?: string
    prStatus?: string
  } | null> {
    // Clear cache
    this.prStatusCache.delete(assignmentId)

    // Find project path
    const projectPath = await this.findProjectPathForAssignment(assignmentId)
    if (!projectPath) return null

    // Clear agent service cache too
    this.agentService.clearPRDetectionCache(projectPath, assignmentId)

    // Perform detection with force flag
    const result = await this.agentService.detectExistingPullRequest(
      projectPath,
      assignmentId,
      { force: true }
    )

    if (result?.found) {
      // Cache the result
      this.prStatusCache.set(assignmentId, {
        status: result.prStatus || 'OPEN',
        timestamp: Date.now()
      })

      // Emit update event
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('assignments:updated')
      }
    }

    return result
  }

  /**
   * Calculate polling interval based on PR age (in milliseconds)
   * - New PRs (< 5 min): 30 seconds
   * - Recent PRs (5-60 min): 90 seconds
   * - Stale PRs (> 60 min): 5 minutes
   */
  private calculatePollingInterval(prCreatedAt: number | null): number {
    if (!prCreatedAt) {
      return 60 * 1000 // Default to 60 seconds if no creation time
    }

    const ageMinutes = (Date.now() - prCreatedAt) / 60000

    if (ageMinutes < 5) {
      return 30 * 1000 // 30 seconds for new PRs
    } else if (ageMinutes < 60) {
      return 90 * 1000 // 90 seconds for recent PRs
    } else {
      return 5 * 60 * 1000 // 5 minutes for stale PRs
    }
  }

  /**
   * Calculate backoff delay based on error count (exponential backoff)
   */
  private calculateBackoffMs(errorCount: number): number {
    if (errorCount === 1) {
      return 30 * 1000 // 30 seconds on first error
    } else if (errorCount === 2) {
      return 2 * 60 * 1000 // 2 minutes on second error
    } else {
      return 10 * 60 * 1000 // 10 minutes on third+ errors
    }
  }

  /**
   * Schedule the next poll with dynamic interval
   */
  private scheduleNextPoll(job: PollingJob): void {
    if (job.intervalId) {
      clearInterval(job.intervalId)
    }

    const interval = this.calculatePollingInterval(job.prCreatedAt)
    job.intervalId = setInterval(async () => {
      await this.executePollingCheck(job)
    }, interval)
  }

  /**
   * Get the appropriate cache TTL based on the cached result type.
   */
  private getCacheTTL(cached: CachedPRStatus): number {
    if (cached.isError) return this.ERROR_CACHE_TTL_MS
    const isKnownStatus = ['OPEN', 'MERGED', 'CLOSED'].includes(cached.status)
    return isKnownStatus ? this.POSITIVE_CACHE_TTL_MS : this.NEGATIVE_CACHE_TTL_MS
  }

  /**
   * Check if there's a fresh cached PR status.
   * Uses differentiated TTLs based on status type.
   */
  private getCachedPRStatus(assignmentId: string): CachedPRStatus | null {
    const cached = this.prStatusCache.get(assignmentId)
    if (!cached) return null

    if (Date.now() - cached.timestamp < this.getCacheTTL(cached)) {
      return cached
    }

    // Cache is stale, remove it
    this.prStatusCache.delete(assignmentId)
    return null
  }

  /**
   * Execute a single PR status check
   */
  private async executePollingCheck(job: PollingJob): Promise<void> {
    // Check if rate limited (unless this is a manual refresh)
    if (!job.isManualRefresh && this.isRateLimited()) {
      return
    }

    // Prevent concurrent checks for same job
    if (job.isPolling) {
      return
    }

    job.isPolling = true

    try {
      // Check cache first (unless manual refresh)
      if (!job.isManualRefresh) {
        const cached = this.getCachedPRStatus(job.assignmentId)
        if (cached) {
          // Use cached value
          job.lastCheckTime = Date.now()
          if (cached.status === 'MERGED' || cached.status === 'CLOSED') {
            this.stopPollingJob(job.assignmentId)
          }
          return
        }
      }

      // Find project path
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
        // Cache error briefly
        this.prStatusCache.set(job.assignmentId, {
          status: 'ERROR',
          timestamp: Date.now(),
          isError: true
        })
      } else {
        // Success - reset error count
        job.errorCount = 0
        job.lastCheckTime = Date.now()

        // Store creation time on first successful check
        if (!job.prCreatedAt && result.createdAt) {
          job.prCreatedAt = new Date(result.createdAt).getTime()
        }

        // Cache the result (positive cache)
        this.prStatusCache.set(job.assignmentId, {
          status: result.status,
          timestamp: Date.now(),
          mergedAt: result.mergedAt
        })

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
      job.isManualRefresh = false
    }
  }

  /**
   * Handle polling errors with exponential backoff retry logic
   */
  private handlePollingError(job: PollingJob, errorMessage: string): void {
    job.errorCount++

    // Check for rate limiting
    if (errorMessage.includes('rate limit') || errorMessage.includes('403') || errorMessage.includes('429')) {
      log.warn(` Rate limited for ${job.assignmentId}, backing off for 10 minutes`)
      this.rateLimitedUntil = Date.now() + this.rateLimitBackoffMs
      return
    }

    // Use exponential backoff for other errors
    if (job.errorCount < 3) {
      const backoffMs = this.calculateBackoffMs(job.errorCount)
      log.warn(` Error #${job.errorCount} for ${job.assignmentId}, backing off for ${backoffMs / 1000}s`)
    } else {
      // Stop after 3 consecutive errors (this prevents infinite retries)
      log.warn(` Stopping polling for ${job.assignmentId} after 3 consecutive errors`)
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

    // MEMORY FIX: Clean up cache and subscriptions for this job
    this.prStatusCache.delete(assignmentId)
    this.subscriptions.delete(assignmentId)
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
    this.prStatusCache.clear()
    this.inFlightDetection.clear()
  }
}
