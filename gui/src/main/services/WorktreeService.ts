import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { ProjectConfigHelper } from './ProjectConfigHelper'
import { createLogger } from './logger'

const log = createLogger('WorktreeService')
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Service for git worktree operations.
 * Extracted from AgentService to reduce file size.
 */
export class WorktreeService {
  constructor(private projectConfig: ProjectConfigHelper) {}

  parseWorktrees(output: string, projectName: string): Array<{ path: string; branch: string }> {
    const worktrees: Array<{ path: string; branch: string }> = []
    const lines = output.split('\n')

    let currentWorktree: any = {}
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const path = line.substring('worktree '.length)
        // Include worktrees that start with project name
        // Supports legacy 'project-agent-N' and new 'project-N'
        // We filter by .agent-info existence later
        const dirName = path.split('/').pop()
        if (dirName && dirName.startsWith(`${projectName}-`)) {
          currentWorktree.path = path
        }
      } else if (line.startsWith('branch ')) {
        const branch = line.substring('branch '.length).replace('refs/heads/', '')
        currentWorktree.branch = branch
      } else if (line === '' && currentWorktree.path) {
        worktrees.push(currentWorktree)
        currentWorktree = {}
      }
    }

    if (currentWorktree.path) {
      worktrees.push(currentWorktree)
    }

    return worktrees
  }

  async getDefaultBranch(projectPath: string, worktreePath: string): Promise<string> {
    // 1. Try to get from project config first
    const config = this.projectConfig.getProjectConfig(projectPath)
    if (config.project?.defaultBaseBranch) {
      log.debug(`Using default branch from config: ${config.project.defaultBaseBranch}`)
      return config.project.defaultBaseBranch
    }

    try {
      // 2. Try to get default branch from gh CLI
      const { stdout } = await execAsync('gh repo view --json defaultBranchRef --jq .defaultBranchRef.name', { cwd: worktreePath })
      if (stdout.trim()) {
        return stdout.trim()
      }
    } catch (error) {
      log.info('Could not get default branch from gh, trying git...')
    }

    try {
      // 3. Fallback: check if 'main' or 'master' exists locally
      const { stdout: branches } = await execAsync('git branch -a', { cwd: worktreePath })
      if (branches.includes('remotes/origin/main') || branches.includes(' main\n')) {
        return 'main'
      }
    } catch (error) {
      // Ignore
    }

    return 'master'
  }

  async getRemote(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git remote', { cwd: worktreePath })
      const remotes = stdout.trim().split('\n').filter(r => r.trim())
      if (remotes.includes('origin')) return 'origin'
      if (remotes.length > 0) return remotes[0]
    } catch (error) {
      // Ignore
    }
    return 'origin'
  }

  async commitSetupFiles(worktreePath: string): Promise<void> {
    try {
      // Check if there are any uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: worktreePath })
      if (!statusOutput.trim()) {
        log.info('No uncommitted setup files to commit')
        return
      }

      log.info('Committing setup files in:', worktreePath)
      log.info('Changed files:', statusOutput.trim())

      // Add all changes (setup files, .agent-info, etc.)
      await execAsync('git add -A', { cwd: worktreePath })

      // Commit with a setup message
      try {
        await execFileAsync('git', ['commit', '-m', 'Worktree setup files'], { cwd: worktreePath })
        log.info('Setup files committed successfully')
      } catch (commitError: any) {
        // Handle git identity not configured
        if (commitError.message.includes('identity unknown') || commitError.stderr?.includes('identity unknown')) {
          log.info('Git identity unknown, setting default...')
          await execFileAsync('git', ['config', 'user.email', 'minion@local'], { cwd: worktreePath })
          await execFileAsync('git', ['config', 'user.name', 'Minion Setup'], { cwd: worktreePath })
          await execFileAsync('git', ['commit', '-m', 'Worktree setup files'], { cwd: worktreePath })
          log.info('Setup files committed with default identity')
        } else if (commitError.message.includes('nothing to commit')) {
          log.info('Nothing to commit after staging')
        } else {
          // Log but don't throw - setup file commit is best-effort
          log.warn('Failed to commit setup files:', commitError.message)
        }
      }
    } catch (error: any) {
      // Log but don't throw - setup file commit is best-effort
      log.warn('Error during setup file commit:', error.message)
    }
  }

  async commitCurrentChanges(worktreePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if there are any uncommitted changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: worktreePath })
      if (!statusOutput.trim()) {
        log.info('No uncommitted changes to commit before handoff')
        return { success: true }
      }

      log.info('Committing changes before handoff in:', worktreePath)
      log.info('Changed files:', statusOutput.trim())

      // Add all changes
      await execAsync('git add -A', { cwd: worktreePath })

      // Commit with a checkpoint message
      try {
        await execFileAsync('git', ['commit', '-m', '[wip] Checkpoint before handoff'], { cwd: worktreePath })
        log.info('Changes committed successfully before handoff')
        return { success: true }
      } catch (commitError: any) {
        // Handle git identity not configured
        if (commitError.message.includes('identity unknown') || commitError.stderr?.includes('identity unknown')) {
          log.info('Git identity unknown, setting default...')
          await execFileAsync('git', ['config', 'user.email', 'minion@local'], { cwd: worktreePath })
          await execFileAsync('git', ['config', 'user.name', 'Minion Agent'], { cwd: worktreePath })
          await execFileAsync('git', ['commit', '-m', '[wip] Checkpoint before handoff'], { cwd: worktreePath })
          log.info('Changes committed with default identity')
          return { success: true }
        } else if (commitError.message.includes('nothing to commit')) {
          log.info('Nothing to commit after staging')
          return { success: true }
        } else if (commitError.stderr?.includes('pre-commit') || commitError.stdout?.includes('pre-commit') || commitError.message.includes('hook failed')) {
          // Pre-commit hook failure - this is an error the user needs to handle
          const errorMsg = `Pre-commit hooks failed. Please fix the issues before handoff.\n\n${commitError.stderr || commitError.stdout || commitError.message}`
          log.error('Commit failed due to pre-commit hooks:', errorMsg)
          return { success: false, error: errorMsg }
        } else {
          log.error('Commit failed:', commitError.message)
          return { success: false, error: `Failed to commit changes: ${commitError.message}` }
        }
      }
    } catch (error: any) {
      log.error('Error during pre-handoff commit:', error.message)
      return { success: false, error: `Error committing changes: ${error.message}` }
    }
  }

  sanitizeBranchName(name: string): string {
    if (!name) return ''

    return name
      .toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/[^a-z0-9-_]/g, '')    // Remove special characters
      .replace(/-+/g, '-')            // Collapse multiple hyphens
      .replace(/^-+|-+$/g, '')        // Trim leading/trailing hyphens
  }

  generateBranchSuffix(shortName?: string, prompt?: string): string {
    if (shortName) {
      return this.sanitizeBranchName(shortName)
    }

    if (prompt) {
      const promptWords = prompt.split(/\s+/).slice(0, 3).join('-')
      const sanitized = this.sanitizeBranchName(promptWords)
      if (sanitized) {
        return sanitized
      }
    }

    return 'handoff'
  }
}
