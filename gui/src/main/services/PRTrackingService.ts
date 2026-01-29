import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { existsSync } from 'fs'
import { AgentInfo } from './types/ProjectConfig'
import { ProjectConfigHelper } from './ProjectConfigHelper'
import { WorktreeService } from './WorktreeService'
import { createLogger } from './logger'

const log = createLogger('PRTrackingService')
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Callbacks for agent operations that PRTrackingService needs.
 * Uses callback functions to avoid circular dependency on AgentService.
 */
export interface PRAgentOps {
  getAssignments: (projectPath: string) => Promise<{ assignments: AgentInfo[] }>
  readAgentInfo: (worktreePath: string, agentId?: string, projectPath?: string) => AgentInfo | null
  writeAgentInfo: (worktreePath: string, info: AgentInfo, projectPath?: string) => void
  updateAgentInfo: (worktreePath: string, updates: Partial<AgentInfo>, agentId?: string, projectPath?: string) => void
}

/**
 * Service for pull request creation, detection, and status tracking.
 * Extracted from AgentService to reduce file size.
 */
export class PRTrackingService {
  constructor(
    private projectConfig: ProjectConfigHelper,
    private worktreeService: WorktreeService,
    private agentOps: PRAgentOps
  ) {}

  async checkDependencies(): Promise<{ ghInstalled: boolean; ghAuthenticated: boolean; error?: string }> {
    try {
      // Check if gh CLI is installed
      await execAsync('gh --version')

      // Check if authenticated
      try {
        await execAsync('gh auth status')
        return { ghInstalled: true, ghAuthenticated: true }
      } catch (authError) {
        return {
          ghInstalled: true,
          ghAuthenticated: false,
          error: 'GitHub CLI not authenticated. Run: gh auth login'
        }
      }
    } catch (error) {
      // Provide platform-appropriate installation instructions
      const platform = process.platform
      let installHint: string
      if (platform === 'darwin') {
        installHint = 'brew install gh'
      } else if (platform === 'win32') {
        installHint = 'winget install GitHub.cli (or scoop install gh)'
      } else {
        installHint = 'See https://cli.github.com/manual/installation'
      }
      return {
        ghInstalled: false,
        ghAuthenticated: false,
        error: `GitHub CLI not installed. Install with: ${installHint}`
      }
    }
  }

  async createPullRequest(projectPath: string, assignmentId: string, autoCommit: boolean = false): Promise<{ url: string }> {
    const { assignments } = await this.agentOps.getAssignments(projectPath)
    const assignment = assignments.find(a => a.id === assignmentId)

    if (!assignment) {
      throw new Error('Assignment not found')
    }

    // Allow PR creation from in_progress, review, or completed states
    if (['pending', 'blocked', 'closed'].includes(assignment.status)) {
      throw new Error(`Cannot create PR for assignment in '${assignment.status}' status`)
    }

    // Calculate worktree path
    const worktreePath = this.projectConfig.getWorktreePath(projectPath, assignment.agentId)

    if (!existsSync(worktreePath)) {
      throw new Error('Agent worktree not found')
    }

    try {
      // Check for uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: worktreePath })
      if (statusOutput.trim()) {
        if (autoCommit) {
          // Auto-commit changes
          log.info('Auto-committing changes...')
          await execAsync('git add -A', { cwd: worktreePath })
          const commitMessage = `Complete: ${assignment.feature}`

          try {
            await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath })
            log.info('Changes committed')
          } catch (commitError: any) {
            // If identity is unknown, try to set a default one
            if (commitError.message.includes('identity unknown')) {
              log.info('Git identity unknown, setting default...')
              await execFileAsync('git', ['config', 'user.email', 'agent@minions.ai'], { cwd: worktreePath })
              await execFileAsync('git', ['config', 'user.name', 'Minion Agent'], { cwd: worktreePath })
              await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath })
              log.info('Changes committed with default identity')
            } else if (commitError.stderr && (commitError.stderr.includes('pre-commit') || commitError.stdout.includes('pre-commit') || commitError.message.includes('hook failed'))) {
              throw new Error(`Pre-commit hooks failed. Please fix the issues and try again.\n\n${commitError.stderr || commitError.stdout || commitError.message}`)
            } else if (commitError.message.includes('nothing to commit')) {
              log.info('Nothing to commit')
            } else {
              throw commitError
            }
          }
        } else {
          throw new Error('Branch has uncommitted changes. Please commit all changes before creating a PR.')
        }
      }

      // Get default branch and remote
      const baseBranch = await this.worktreeService.getDefaultBranch(projectPath, worktreePath)
      const remote = await this.worktreeService.getRemote(worktreePath)
      log.debug(`Using base branch: ${baseBranch}, remote: ${remote}`)

      // Check if there are commits on this branch
      try {
        const { stdout: commitCount } = await execFileAsync('git', ['rev-list', '--count', `${baseBranch}..${assignment.branch}`], { cwd: worktreePath })
        if (parseInt(commitCount.trim()) === 0) {
          throw new Error(`No commits on branch '${assignment.branch}' compared to '${baseBranch}'. Make sure changes are committed before creating a PR.`)
        }
      } catch (error: any) {
        if (error.message.includes('No commits')) {
          throw error
        }
        // If the command fails for other reasons, continue - branch might not have base branch locally
      }

      // Push the branch to remote
      log.debug(`Pushing branch to ${remote}...`)
      try {
        await execFileAsync('git', ['push', '-u', remote, assignment.branch], { cwd: worktreePath })
      } catch (pushError: any) {
        // If it's already up to date, that's fine
        if (pushError.stderr && (pushError.stderr.includes('Everything up-to-date') || pushError.stdout.includes('Everything up-to-date'))) {
          log.info('Branch is already up to date')
        } else if (pushError.stderr && (pushError.stderr.includes('pre-push') || pushError.stdout.includes('pre-push') || pushError.message.includes('hook failed'))) {
          throw new Error(`Pre-push hooks failed. Please fix the issues and try again.\n\n${pushError.stderr || pushError.stdout || pushError.message}`)
        } else {
          log.error('Push error details', pushError)
          throw new Error(`Failed to push branch to ${remote}: ${pushError.message}`)
        }
      }

      // Use prompt for PR body, fallback to feature description
      const prBody = assignment.prompt || assignment.feature

      // Create PR title from feature
      const prTitle = assignment.feature.length > 72
        ? assignment.feature.substring(0, 69) + '...'
        : assignment.feature

      // Try to create PR
      log.info('Creating PR...')
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', baseBranch, '--head', assignment.branch],
          { cwd: worktreePath }
        )

        // Extract PR URL from output
        const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/)
        const prUrl = urlMatch ? urlMatch[0] : stdout.trim()

        // Update .agent-info with PR URL and status
        this.agentOps.updateAgentInfo(worktreePath, {
          prUrl: prUrl,
          prStatus: 'OPEN',
          status: 'pr_open'
        }, assignment.agentId, projectPath)

        log.info('PR created:', prUrl)
        return { url: prUrl }
      } catch (prError: any) {
        // Check if PR already exists
        if (prError.message.includes('already exists')) {
          log.info('PR already exists, fetching URL...')
          const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'list', '--head', assignment.branch, '--json', 'url', '--jq', '.[0].url'],
            { cwd: worktreePath }
          )
          const prUrl = stdout.trim()

          // Update .agent-info
          this.agentOps.updateAgentInfo(worktreePath, {
            prUrl: prUrl,
            prStatus: 'OPEN',
            status: 'pr_open'
          }, assignment.agentId, projectPath)

          return { url: prUrl }
        }
        throw prError
      }
    } catch (error: any) {
      log.error('Failed to create PR:', error)
      throw new Error(`Failed to create pull request: ${error.message}`)
    }
  }

  async detectExistingPullRequest(
    projectPath: string,
    assignmentId: string,
    _options?: { force?: boolean }
  ): Promise<{
    found: boolean
    prUrl?: string
    prStatus?: string
    createdAt?: string
  } | null> {
    // NOTE: Caching is now handled by PRPollingService
    // This method just performs the actual detection

    try {
      // 1. Load assignment
      const { assignments } = await this.agentOps.getAssignments(projectPath)
      const assignment = assignments.find(a => a.id === assignmentId)

      if (!assignment) {
        log.info('detectExistingPullRequest: Assignment not found')
        return null
      }

      // 2. If prUrl already exists, do a fresh status check to get latest state
      if (assignment.prUrl) {
        log.info('detectExistingPullRequest: PR already tracked, refreshing status:', assignment.prUrl)
        try {
          const statusResult = await this.checkPullRequestStatus(projectPath, assignmentId, { silent: true })
          // checkPullRequestStatus returns { status: 'ERROR' } on failure instead of throwing
          if (statusResult.status === 'ERROR') {
            log.warn('detectExistingPullRequest: Failed to refresh status:', statusResult.error)
            // Fall back to stored status
            return {
              found: true,
              prUrl: assignment.prUrl,
              prStatus: assignment.prStatus
            }
          }
          return {
            found: true,
            prUrl: assignment.prUrl,
            prStatus: statusResult.status,
            createdAt: statusResult.createdAt
          }
        } catch (error: any) {
          log.warn('detectExistingPullRequest: Failed to refresh status:', error.message)
          // Fall back to stored status
          return {
            found: true,
            prUrl: assignment.prUrl,
            prStatus: assignment.prStatus
          }
        }
      }

      // 3. Get worktree path
      const worktreePath = this.projectConfig.getWorktreePath(projectPath, assignment.agentId)

      // 4. Get remote
      const remote = await this.worktreeService.getRemote(worktreePath)
      if (!remote) {
        log.info('detectExistingPullRequest: No remote configured')
        return null
      }

      // 5. Get the actual current branch from git (more reliable than stored value)
      let currentBranch: string
      try {
        const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: worktreePath })
        currentBranch = branchOutput.trim()
        if (!currentBranch) {
          log.info('detectExistingPullRequest: Could not determine current branch')
          return null
        }
      } catch (error: any) {
        log.warn('detectExistingPullRequest: Error getting current branch:', error.message)
        return null
      }

      // 6. Check if branch exists on remote
      try {
        const { stdout: remoteRefs } = await execAsync(`git ls-remote --heads ${remote} ${currentBranch}`, { cwd: worktreePath })
        if (!remoteRefs.trim()) {
          log.info('detectExistingPullRequest: Branch not on remote:', currentBranch)
          return { found: false }
        }
      } catch (error: any) {
        log.warn('detectExistingPullRequest: Error checking remote refs:', error.message)
        return null
      }

      // 7. Run gh pr list to find existing PR
      let prData: { url: string; state: string; createdAt: string } | null = null
      try {
        const { stdout } = await execAsync(
          `gh pr list --head ${currentBranch} --json number,url,state,createdAt --jq '.[0]'`,
          { cwd: projectPath }
        )

        if (stdout.trim() && stdout.trim() !== 'null') {
          prData = JSON.parse(stdout.trim())
        }
      } catch (error: any) {
        log.warn('detectExistingPullRequest: GitHub CLI error:', error.message)
        return null
      }

      if (!prData) {
        // No PR found
        log.info('detectExistingPullRequest: No existing PR found')
        return { found: false }
      }

      // 8. PR found, update .agent-info
      log.info('detectExistingPullRequest: Found existing PR:', prData.url)
      const agentInfoPath = join(worktreePath, '.agent-info')
      if (existsSync(agentInfoPath)) {
        const updates: Partial<AgentInfo> = {
          prUrl: prData.url,
          prStatus: prData.state // OPEN, MERGED, CLOSED
        }

        if (prData.state === 'OPEN') {
          updates.status = 'pr_open'
        } else if (prData.state === 'MERGED') {
          updates.status = 'merged'
        } else if (prData.state === 'CLOSED') {
          updates.status = 'closed'
        }

        this.agentOps.updateAgentInfo(worktreePath, updates, assignment.agentId, projectPath)
      }

      return {
        found: true,
        prUrl: prData.url,
        prStatus: prData.state,
        createdAt: prData.createdAt
      }
    } catch (error: any) {
      log.error('detectExistingPullRequest: Unexpected error:', error.message)
      return null
    }
  }

  async checkPullRequestStatus(
    projectPath: string,
    assignmentId: string,
    options?: { silent?: boolean }
  ): Promise<{ status: string; mergedAt?: string; createdAt?: string; error?: string }> {
    const { assignments } = await this.agentOps.getAssignments(projectPath)
    const assignment = assignments.find(a => a.id === assignmentId)

    if (!assignment || !assignment.prUrl) {
      const error = 'Assignment or PR URL not found'
      if (!options?.silent) {
        log.error('', error)
      }
      return { status: 'ERROR', error }
    }

    // Calculate worktree path
    const worktreePath = this.projectConfig.getWorktreePath(projectPath, assignment.agentId)

    try {
      // Extract PR number from URL
      const prNumberMatch = assignment.prUrl.match(/\/pull\/(\d+)/)
      if (!prNumberMatch) {
        const error = 'Could not extract PR number from URL'
        if (!options?.silent) {
          log.error('', error)
        }
        return { status: 'ERROR', error }
      }
      const prNumber = prNumberMatch[1]

      // Check PR status using gh CLI
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', prNumber, '--json', 'state,mergedAt,createdAt'],
        { cwd: projectPath }
      )

      const prData = JSON.parse(stdout)
      const status = prData.state // OPEN, MERGED, CLOSED

      // Update .agent-info with PR status
      const updates: Partial<AgentInfo> = { prStatus: status }

      if (status === 'MERGED') {
        updates.status = 'merged'
      } else if (status === 'CLOSED') {
        updates.status = 'closed'
      }

      this.agentOps.updateAgentInfo(worktreePath, updates, assignment.agentId, projectPath)

      return {
        status,
        mergedAt: prData.mergedAt,
        createdAt: prData.createdAt
      }
    } catch (error: any) {
      if (!options?.silent) {
        log.error('Failed to check PR status:', error)
      }
      return { status: 'ERROR', error: error.message }
    }
  }
}
