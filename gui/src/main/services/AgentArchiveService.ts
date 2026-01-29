import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs'
import { AgentInfo, ArchivedAgent, Assignment } from './types/ProjectConfig'
import { createLogger } from './logger'

const log = createLogger('AgentArchiveService')

/**
 * Callbacks for agent operations that AgentArchiveService needs.
 */
export interface ArchiveAgentOps {
  listAgents: (projectPath: string) => Promise<Array<{ id: string; worktreePath: string }>>
  readAgentInfo: (worktreePath: string) => AgentInfo | null
  createAssignment: (projectPath: string, assignment: Partial<Assignment>) => Promise<AgentInfo>
}

/**
 * Service for agent archiving and restoration.
 * Extracted from AgentService to reduce file size.
 */
export class AgentArchiveService {
  constructor(private agentOps: ArchiveAgentOps) {}

  resolveMainProjectPath(projectPath: string): string {
    const gitPath = join(projectPath, '.git')
    try {
      if (existsSync(gitPath) && statSync(gitPath).isFile()) {
        // This is a worktree - read the main repo path
        const gitContent = readFileSync(gitPath, 'utf-8').trim()
        // Format: "gitdir: /path/to/repo/.git/worktrees/name"
        const match = gitContent.match(/gitdir:\s*(.+)/)
        if (match) {
          const gitDir = match[1]
          // Extract main repo path from gitdir
          const mainGitMatch = gitDir.match(/(.+)\/\.git\/worktrees\//)
          if (mainGitMatch) {
            log.info(`Resolved worktree ${projectPath} to main repo ${mainGitMatch[1]}`)
            return mainGitMatch[1]
          }
        }
      }
    } catch (error) {
      log.warn(`Failed to resolve main project path for ${projectPath}:`, error)
    }
    return projectPath
  }

  getArchiveDirectory(projectPath: string): string {
    const mainPath = this.resolveMainProjectPath(projectPath)
    return join(mainPath, '.minions', 'archive')
  }

  ensureArchiveDirectory(projectPath: string): string {
    const archiveDir = this.getArchiveDirectory(projectPath)
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true })
    }
    return archiveDir
  }

  async archiveAgent(projectPath: string, agentId: string): Promise<ArchivedAgent> {
    // 1. Find agent's worktree path
    const agents = await this.agentOps.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)

    if (!agent) {
      throw new Error(`Agent ${agentId} not found for archiving`)
    }

    // 2. Read agent info
    const agentInfo = this.agentOps.readAgentInfo(agent.worktreePath)
    if (!agentInfo) {
      throw new Error(`Could not read agent info for ${agentId}`)
    }

    // 3. Create archive record
    const timestamp = Date.now()
    const archiveId = `${agentId}-${timestamp}`

    const archived: ArchivedAgent = {
      archiveId,
      archivedAt: new Date().toISOString(),
      archiveVersion: 1,

      agentId: agentInfo.agentId,
      assignmentId: agentInfo.id,

      branch: agentInfo.branch,
      feature: agentInfo.feature,
      prompt: agentInfo.prompt,

      tool: agentInfo.tool,
      model: agentInfo.model,
      mode: agentInfo.mode,

      createdAt: agentInfo.createdAt,
      completedAt: new Date().toISOString(),

      finalStatus: agentInfo.status,

      prUrl: agentInfo.prUrl,
      prStatus: agentInfo.prStatus,

      totalCostUsd: agentInfo.totalCostUsd,
      tokenUsage: agentInfo.tokenUsage,

      parentAgentId: agentInfo.parentAgentId,
      isSuperMinion: (agentInfo as any).isSuperMinion
    }

    // 4. Ensure archive directory exists and write archive file
    const archiveDir = this.ensureArchiveDirectory(projectPath)
    const archivePath = join(archiveDir, `${archiveId}.json`)
    writeFileSync(archivePath, JSON.stringify(archived, null, 2))

    log.info(`Archived agent ${agentId} to ${archivePath}`)

    return archived
  }

  async listArchivedAgents(projectPath: string): Promise<ArchivedAgent[]> {
    const archiveDir = this.getArchiveDirectory(projectPath)

    if (!existsSync(archiveDir)) {
      return []
    }

    try {
      const files = readdirSync(archiveDir).filter(f => f.endsWith('.json'))
      const archives: ArchivedAgent[] = []

      for (const file of files) {
        try {
          const content = readFileSync(join(archiveDir, file), 'utf-8')
          archives.push(JSON.parse(content))
        } catch (error) {
          log.warn(`Failed to read archive file ${file}:`, error)
        }
      }

      // Sort by archivedAt descending (most recent first)
      return archives.sort((a, b) =>
        new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
      )
    } catch (error) {
      log.warn('Failed to list archived agents:', error)
      return []
    }
  }

  async getArchivedAgent(projectPath: string, archiveId: string): Promise<ArchivedAgent | null> {
    const archivePath = join(this.getArchiveDirectory(projectPath), `${archiveId}.json`)

    if (!existsSync(archivePath)) {
      return null
    }

    try {
      const content = readFileSync(archivePath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      log.error(`Failed to read archive ${archiveId}:`, error)
      return null
    }
  }

  async restoreArchivedAgent(projectPath: string, archiveId: string): Promise<AgentInfo> {
    // Load archived agent metadata
    const archived = await this.getArchivedAgent(projectPath, archiveId)
    if (!archived) {
      throw new Error(`Archive not found: ${archiveId}`)
    }

    // Generate new branch name with -restored suffix to avoid conflicts
    const timestamp = Date.now()
    const originalBranch = archived.branch.replace(/^feature\//, '')
    const newBranch = `${originalBranch}-restored-${timestamp}`

    // Create new assignment with archived agent's configuration
    const assignment = await this.agentOps.createAssignment(projectPath, {
      feature: archived.feature,
      branch: newBranch,
      prompt: archived.prompt || `Restored from archive: ${archived.feature}`,
      tool: archived.tool,
      model: archived.model,
      mode: archived.mode as 'auto' | 'manual' | 'interactive' | 'planning' | 'dev' | 'idle'
    })

    log.info(`Restored agent from archive ${archiveId} as ${assignment.agentId}`)

    return assignment
  }
}
