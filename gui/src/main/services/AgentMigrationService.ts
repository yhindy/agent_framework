import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { AgentInfo } from './types/ProjectConfig'
import { ProjectConfigHelper } from './ProjectConfigHelper'
import { WorktreeService } from './WorktreeService'
import { createLogger } from './logger'

const log = createLogger('AgentMigrationService')
const execAsync = promisify(exec)

/**
 * Callbacks for agent write operations that AgentMigrationService needs.
 */
export interface MigrationAgentOps {
  writeAgentInfo: (worktreePath: string, info: AgentInfo, projectPath?: string) => void
}

/**
 * Service for migrating legacy agent formats to the new format.
 * Extracted from AgentService to reduce file size.
 */
export class AgentMigrationService {
  constructor(
    private projectConfig: ProjectConfigHelper,
    private worktreeService: WorktreeService,
    private agentOps: MigrationAgentOps
  ) {}

  parseAgentInfo(filePath: string): Record<string, string> {
    const content = readFileSync(filePath, 'utf-8')
    const info: Record<string, string> = {}

    for (const line of content.split('\n')) {
      const [key, value] = line.split('=')
      if (key && value) {
        info[key.trim()] = value.trim()
      }
    }

    return info
  }

  async migrateAssignments(projectPath: string): Promise<void> {
    log.info('Starting assignment migration for:', projectPath)

    try {
      const config = this.projectConfig.getProjectConfig(projectPath)
      const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

      // Get all worktrees
      const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectPath })
      const worktrees = this.worktreeService.parseWorktrees(stdout, projectName)

      let migratedCount = 0

      for (const worktree of worktrees) {
        const agentInfoPath = join(worktree.path, '.agent-info')

        if (existsSync(agentInfoPath)) {
          const content = readFileSync(agentInfoPath, 'utf-8')

          // Check if it's already JSON format
          try {
            JSON.parse(content)
            continue // Already migrated
          } catch {
            // Old format - needs migration
            log.info('Migrating .agent-info for:', worktree.path)

            const oldInfo = this.parseAgentInfo(agentInfoPath)
            const agentId = oldInfo.AGENT_ID

            // Find matching assignment in config.json
            const assignment = config.assignments?.find(a => a.agentId === agentId)

            // Create new AgentInfo
            const newInfo: AgentInfo = {
              id: assignment?.id || `${agentId}-${Date.now()}`,
              agentId: agentId,
              branch: oldInfo.BRANCH || '',
              project: oldInfo.PROJECT || projectName,
              feature: assignment?.feature || '',
              status: (assignment?.status as any) || 'active',
              tool: assignment?.tool || 'claude',
              model: assignment?.model,
              mode: (assignment?.mode as any) || 'auto',
              prompt: (assignment as any)?.prompt,
              specFile: (assignment as any)?.specFile,
              prUrl: assignment?.prUrl,
              prStatus: assignment?.prStatus,
              createdAt: new Date().toISOString(),
              lastActivity: assignment?.lastActivity || new Date().toISOString(),
              hasUnread: assignment?.hasUnread
            }

            // Write new format
            this.agentOps.writeAgentInfo(worktree.path, newInfo)
            migratedCount++
          }
        }
      }

      // Clear assignments from config.json after migration
      if (migratedCount > 0 && config.assignments && config.assignments.length > 0) {
        log.info(`Migrated ${migratedCount} agents, clearing config.json assignments`)
        config.assignments = []
        this.projectConfig.saveProjectConfig(projectPath, config)
      }

      log.info(`Migration complete: ${migratedCount} agents migrated`)
    } catch (error) {
      log.error('Migration failed:', error)
    }
  }
}
