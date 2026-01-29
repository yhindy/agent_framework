import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { app } from 'electron'
import { ProjectConfig } from './types/ProjectConfig'
import { createLogger } from './logger'

const log = createLogger('ProjectConfigHelper')

/**
 * Helper for project configuration and path resolution.
 * Extracted from AgentService to reduce file size.
 */
export class ProjectConfigHelper {
  getMinionsPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'minions')
      : join(app.getAppPath(), 'resources', 'minions')
  }

  getProjectConfigPath(projectPath: string): string {
    // New format first: minions.json at project root
    const newConfigPath = join(projectPath, 'minions.json')
    if (existsSync(newConfigPath)) {
      return newConfigPath
    }

    // Legacy fallback: minions/config.json
    return join(projectPath, 'minions', 'config.json')
  }

  isNewFormatProject(projectPath: string): boolean {
    return existsSync(join(projectPath, 'minions.json'))
  }

  getProjectName(projectPath: string): string {
    const config = this.getProjectConfig(projectPath)
    return config.project?.name || projectPath.split('/').pop() || 'project'
  }

  getProjectConfig(projectPath: string): ProjectConfig {
    const configPath = this.getProjectConfigPath(projectPath)
    if (!existsSync(configPath)) {
      return {
        project: { name: 'unknown', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }
    }
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (e) {
      log.error('Error parsing config.json', e)
      return {
        project: { name: 'unknown', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }
    }
  }

  saveProjectConfig(projectPath: string, config: ProjectConfig): void {
    const configPath = this.getProjectConfigPath(projectPath)
    writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  getAgentPath(projectPath: string, agentInfo: { agentId: string; isBaseBranchAgent?: boolean }): string {
    if (agentInfo.isBaseBranchAgent) {
      return projectPath
    }

    const config = this.getProjectConfig(projectPath)
    const projectName = config.project?.name || projectPath.split('/').pop() || 'project'

    if (agentInfo.agentId.startsWith(`${projectName}-`)) {
      return join(dirname(projectPath), agentInfo.agentId)
    } else {
      return join(dirname(projectPath), `${projectName}-${agentInfo.agentId}`)
    }
  }

  /**
   * Compute the worktree path for a given agent ID.
   * Consolidates the repeated pattern of checking if agentId already has the project name prefix.
   */
  getWorktreePath(projectPath: string, agentId: string): string {
    const projectName = this.getProjectName(projectPath)
    if (agentId.startsWith(`${projectName}-`)) {
      return join(dirname(projectPath), agentId)
    }
    return join(dirname(projectPath), `${projectName}-${agentId}`)
  }
}