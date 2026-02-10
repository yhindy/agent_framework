import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { AgentService } from './AgentService'
import { createLogger } from './logger'

const execFileAsync = promisify(execFile)
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
  createdAt?: string
  prUrl?: string
  found?: boolean
}

/**
 * PRPollingService manages automatic polling of PR status across the application.
 * It deduplicates requests so that multiple components watching the same PR
 * result in only a single GitHub API call.
 *
 * Polling intervals scale with PR age:
 * - New PRs (< 5 min): every 2 minutes
 * - Recent PRs (5-60 min): every 5 minutes
 * - Stale PRs (> 60 min): every 15 minutes
 *
 * Additional safeguards:
 * - 2-minute cache TTL prevents burst duplicate calls
 * - 10-minute global backoff on rate limit detection (403/429)
 * - Concurrency limit of 2 simultaneous API calls with queue draining
 * - REST API fallback when gh CLI fails
 */
export class PRPollingService {
  private mainWindow: BrowserWindow
  private agentService: AgentService
  private findProjectPath: ((assignmentId: string) => Promise<string | null>) | null = null

  private pollingJobs: Map<string, PollingJob> = new Map()
  private subscriptions: Map<string, Set<string>> = new Map()
  private prStatusCache: Map<string, CachedPRStatus> = new Map()
  private lastEmittedStatus: Map<string, string> = new Map()

  private rateLimitedUntil: number = 0
  private readonly rateLimitBackoffMs: number = 10 * 60 * 1000
  private readonly cacheTtlFoundMs: number = 2 * 60 * 1000
  private readonly cacheTtlNotFoundMs: number = 2 * 60 * 1000

  maxConcurrentPolls: number = 2
  activePollCount: number = 0
  pollQueue: Array<() => Promise<void>> = []

  constructor(mainWindow: BrowserWindow, agentService: AgentService) {
    this.mainWindow = mainWindow
    this.agentService = agentService
  }

  setFindProjectPath(fn: (assignmentId: string) => Promise<string | null>): void {
    this.findProjectPath = fn
  }

  async startPolling(assignmentId: string, subscriberId: string): Promise<void> {
    if (!this.subscriptions.has(assignmentId)) {
      this.subscriptions.set(assignmentId, new Set())
    }

    const subscribers = this.subscriptions.get(assignmentId)!
    subscribers.add(subscriberId)

    if (this.pollingJobs.has(assignmentId)) {
      return
    }

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
    await this.executePollingCheck(job)
    this.scheduleNextPoll(job)
  }

  async stopPolling(assignmentId: string, subscriberId: string): Promise<void> {
    const subscribers = this.subscriptions.get(assignmentId)
    if (!subscribers) return

    subscribers.delete(subscriberId)

    if (subscribers.size === 0) {
      this.subscriptions.delete(assignmentId)
      this.stopPollingJob(assignmentId)
    }
  }

  async stopAllPolling(subscriberId: string): Promise<void> {
    const assignmentsToStop: string[] = []

    for (const [assignmentId, subscribers] of this.subscriptions.entries()) {
      subscribers.delete(subscriberId)
      if (subscribers.size === 0) {
        assignmentsToStop.push(assignmentId)
      }
    }

    for (const assignmentId of assignmentsToStop) {
      this.subscriptions.delete(assignmentId)
      this.stopPollingJob(assignmentId)
    }
  }

  async refreshPRNow(assignmentId: string): Promise<void> {
    const job = this.pollingJobs.get(assignmentId)
    if (!job) return

    job.isManualRefresh = true
    job.errorCount = 0
    this.prStatusCache.delete(assignmentId)

    await this.executePollingCheck(job)
    this.scheduleNextPoll(job)
  }

  private static readonly MINUTES = 60 * 1000
  private static readonly RETRY_BACKOFF_MS = 30 * 1000

  /**
   * Calculate polling interval based on PR age.
   * Scales from 2 minutes (new) to 15 minutes (stale) to reduce API load.
   */
  private calculatePollingInterval(prCreatedAt: number | null): number {
    if (!prCreatedAt) {
      return 3 * PRPollingService.MINUTES
    }

    const ageMinutes = (Date.now() - prCreatedAt) / PRPollingService.MINUTES

    if (ageMinutes < 5) {
      return 2 * PRPollingService.MINUTES
    } else if (ageMinutes < 60) {
      return 5 * PRPollingService.MINUTES
    } else {
      return 15 * PRPollingService.MINUTES
    }
  }

  private scheduleNextPoll(job: PollingJob): void {
    if (job.intervalId) {
      clearInterval(job.intervalId)
    }

    const interval = this.calculatePollingInterval(job.prCreatedAt)
    job.intervalId = setInterval(async () => {
      await this.executePollingCheck(job)
    }, interval)
  }

  private getCachedPRStatus(assignmentId: string): CachedPRStatus | null {
    const cached = this.prStatusCache.get(assignmentId)
    if (!cached) return null

    const ttl = cached.found !== false ? this.cacheTtlFoundMs : this.cacheTtlNotFoundMs
    if (Date.now() - cached.timestamp < ttl) {
      return cached
    }

    this.prStatusCache.delete(assignmentId)
    return null
  }

  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil
  }

  clearCacheForAgent(assignmentId: string): void {
    this.prStatusCache.delete(assignmentId)
  }

  private async executePollingCheck(job: PollingJob): Promise<void> {
    if (!job.isManualRefresh && this.isRateLimited()) {
      return
    }

    if (job.isPolling) {
      return
    }

    if (!job.isManualRefresh) {
      const cached = this.getCachedPRStatus(job.assignmentId)
      if (cached) {
        job.lastCheckTime = Date.now()
        if (this.isTerminalStatus(cached.status)) {
          this.stopPollingJob(job.assignmentId)
        }
        return
      }
    }

    if (this.activePollCount >= this.maxConcurrentPolls) {
      this.pollQueue.push(async () => {
        await this._doPollingCheck(job)
      })
      return
    }

    this.activePollCount++
    try {
      await this._doPollingCheck(job)
    } finally {
      this.activePollCount--
      this._drainQueue()
    }
  }

  private async _doPollingCheck(job: PollingJob): Promise<void> {
    job.isPolling = true

    try {
      const previousStatus = this.lastEmittedStatus.get(job.assignmentId)

      const projectPath = await this.findProjectPathForAssignment(job.assignmentId)
      if (!projectPath) {
        this.stopPollingJob(job.assignmentId)
        return
      }

      job.projectPath = projectPath

      // Skip PR polling for non-git agents (agents without a branch).
      // Non-git projects don't have branches or PRs to poll.
      try {
        const { assignments } = await this.agentService.getAssignments(projectPath)
        const assignment = assignments.find((a: any) => a.id === job.assignmentId)
        if (assignment && !assignment.branch) {
          log.debug(`Skipping PR polling for ${job.assignmentId}: agent has no branch (non-git project)`)
          this.stopPollingJob(job.assignmentId)
          return
        }
      } catch {
        // If we can't check, continue with normal polling (will fail gracefully later)
      }

      let result = await this.agentService.checkPullRequestStatus(
        projectPath,
        job.assignmentId,
        { silent: true }
      )

      if (result.error && !this.isRateLimitError(result.error)) {
        const restResult = await this.checkPRStatusViaRest(projectPath, job.assignmentId)
        if (restResult.status !== 'unknown') {
          result = restResult
        }
      }

      if (result.error) {
        this.handlePollingError(job, result.error)
      } else {
        job.errorCount = 0
        job.lastCheckTime = Date.now()

        if (!job.prCreatedAt && result.createdAt) {
          job.prCreatedAt = new Date(result.createdAt).getTime()
        }

        this.prStatusCache.set(job.assignmentId, {
          status: result.status,
          timestamp: Date.now(),
          mergedAt: result.mergedAt,
          createdAt: result.createdAt,
          found: true
        })

        if (result.status !== previousStatus) {
          this.lastEmittedStatus.set(job.assignmentId, result.status)
          this.mainWindow.webContents.send('agents:updated')
          this.mainWindow.webContents.send('assignments:updated')
        }

        if (this.isTerminalStatus(result.status)) {
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

  private _drainQueue(): void {
    while (this.pollQueue.length > 0 && this.activePollCount < this.maxConcurrentPolls) {
      const next = this.pollQueue.shift()!
      this.activePollCount++
      next().finally(() => {
        this.activePollCount--
        this._drainQueue()
      })
    }
  }

  /**
   * Handle polling errors: back off on rate limits, stop after 2 consecutive failures.
   */
  private handlePollingError(job: PollingJob, errorMessage: string): void {
    job.errorCount++

    if (this.isRateLimitError(errorMessage)) {
      log.warn(`Rate limited for ${job.assignmentId}, backing off for 10 minutes`)
      this.rateLimitedUntil = Date.now() + this.rateLimitBackoffMs
      return
    }

    if (job.errorCount < 2) {
      log.warn(`Error #${job.errorCount} for ${job.assignmentId}, will retry in ${PRPollingService.RETRY_BACKOFF_MS / 1000}s`)
    } else {
      log.warn(`Stopping polling for ${job.assignmentId} after ${job.errorCount} consecutive errors`)
      this.stopPollingJob(job.assignmentId)
    }
  }

  /** Stop a polling job. Cache is intentionally preserved for re-subscription reuse. */
  private stopPollingJob(assignmentId: string): void {
    const job = this.pollingJobs.get(assignmentId)
    if (!job) return

    if (job.intervalId) {
      clearInterval(job.intervalId)
      job.intervalId = null
    }

    this.pollingJobs.delete(assignmentId)
    this.subscriptions.delete(assignmentId)
    this.lastEmittedStatus.delete(assignmentId)
  }

  private async findProjectPathForAssignment(assignmentId: string): Promise<string | null> {
    if (!this.findProjectPath) {
      return null
    }
    return this.findProjectPath(assignmentId)
  }

  /**
   * REST API fallback for checking PR status when gh CLI fails.
   */
  async checkPRStatusViaRest(projectPath: string, _assignmentId: string): Promise<{ status: string; mergedAt?: string; createdAt?: string; error?: string }> {
    try {
      const { stdout: remoteUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: projectPath })
      const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)/)
      if (!match) throw new Error('Could not parse GitHub repo from remote URL')
      const [, owner, repo] = match

      const { stdout: branchName } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath })

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'MinionsApp' }
      if (token) headers['Authorization'] = `token ${token}`

      const searchUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branchName.trim()}&state=all`
      const response = await fetch(searchUrl, { headers })
      if (!response.ok) throw new Error(`REST API error: ${response.status}`)

      const data = await response.json() as any[]
      if (!data || data.length === 0) {
        return { status: 'unknown', error: 'No PR found via REST API' }
      }

      const pr = data[0]
      let status: string
      if (pr.state === 'open') {
        status = 'OPEN'
      } else if (pr.merged_at) {
        status = 'MERGED'
      } else {
        status = 'CLOSED'
      }

      return {
        status,
        mergedAt: pr.merged_at || undefined,
        createdAt: pr.created_at || undefined
      }
    } catch (error) {
      return { status: 'unknown', error: String(error) }
    }
  }

  private isTerminalStatus(status: string): boolean {
    return status === 'MERGED' || status === 'CLOSED'
  }

  private isRateLimitError(errorMessage: string): boolean {
    return errorMessage.includes('rate limit') || errorMessage.includes('403') || errorMessage.includes('429')
  }

  dispose(): void {
    for (const job of this.pollingJobs.values()) {
      if (job.intervalId) {
        clearInterval(job.intervalId)
      }
    }
    this.pollingJobs.clear()
    this.subscriptions.clear()
    this.prStatusCache.clear()
    this.lastEmittedStatus.clear()
  }
}
