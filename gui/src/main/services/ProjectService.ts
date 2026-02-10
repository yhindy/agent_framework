import Store from 'electron-store'
import { join, basename, resolve } from 'path'
import { existsSync, cpSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { AgentService } from './AgentService'
import { createLogger } from './logger'
import { MinionsConfigService } from './MinionsConfigService'

const log = createLogger('ProjectService')

export type ProjectFormat = 'new' | 'legacy' | 'none'

export interface ProjectState {
  path: string
  name: string
  lastOpened: string
  needsInstall?: boolean
  isGitRepo?: boolean
}

interface StoreSchema {
  currentProjectPath: string | null
  activeProjects: ProjectState[]
  recentProjects: ProjectState[]
}

export class ProjectService {
  private store: Store<StoreSchema>
  private agentService: AgentService | null = null
  private minionsConfigService: MinionsConfigService

  constructor(agentService?: AgentService, minionsConfigService?: MinionsConfigService) {
    this.store = new Store<StoreSchema>({
      defaults: {
        currentProjectPath: null,
        activeProjects: [],
        recentProjects: []
      }
    })

    this.agentService = agentService || null
    this.minionsConfigService = minionsConfigService || new MinionsConfigService()
    this.validateActiveProjects()
  }

  setAgentService(agentService: AgentService): void {
    this.agentService = agentService
  }

  /**
   * Detect the project format based on config files present
   * @param projectPath - Path to the project root
   * @returns 'new' if minions.json exists, 'legacy' if minions/config.json exists, 'none' otherwise
   */
  getProjectFormat(projectPath: string): ProjectFormat {
    // Check for new format first (minions.json at project root)
    if (this.minionsConfigService.hasConfig(projectPath)) {
      return 'new'
    }
    // Then check legacy format (minions/config.json)
    if (this.minionsConfigService.hasLegacyConfig(projectPath)) {
      return 'legacy'
    }
    return 'none'
  }

  /**
   * Initialize the .minions/ folder structure
   * @param projectPath - Path to the project root
   */
  initializeMinionsFolder(projectPath: string): void {
    this.minionsConfigService.initializeMinionsFolder(projectPath)
  }

  // Validate active projects on startup (robustness)
  private validateActiveProjects() {
    const active = this.store.get('activeProjects', [])
    const validProjects = active.filter(p => existsSync(p.path))

    // Backfill isGitRepo for projects that don't have it set
    let needsUpdate = validProjects.length !== active.length
    for (const project of validProjects) {
      if (project.isGitRepo === undefined) {
        project.isGitRepo = existsSync(join(project.path, '.git'))
        needsUpdate = true
      }
    }

    if (needsUpdate) {
      this.store.set('activeProjects', validProjects)

      // If current project was invalid, switch to another or clear
      const current = this.store.get('currentProjectPath')
      if (current && !validProjects.find(p => p.path === current)) {
        this.store.set('currentProjectPath', validProjects.length > 0 ? validProjects[0].path : null)
      }
    }
  }

  // Legacy method wrapper for backward compatibility/single-project logic replacement
  async selectProject(projectPath: string): Promise<ProjectState> {
    return this.addProject(projectPath)
  }

  async addProject(projectPath: string): Promise<ProjectState> {
    log.info('Adding project:', projectPath)

    // SECURITY: Normalize path to prevent path traversal attacks
    const normalizedPath = resolve(projectPath)

    // Validate project path
    if (!existsSync(normalizedPath)) {
      const error = `Project path does not exist: ${normalizedPath}`
      log.error('Error:', error)
      throw new Error(error)
    }

    // Use the normalized path from here on
    projectPath = normalizedPath

    try {
      // Check if project has the agent framework installed
      // New format: minions.json exists at project root
      // Legacy format: minions/config.json exists
      const projectFormat = this.getProjectFormat(projectPath)
      const needsInstall = projectFormat === 'none'
      log.info('Project format:', projectFormat)
      log.info('Project needs install:', needsInstall)

      const isGitRepo = existsSync(join(projectPath, '.git'))

      const project: ProjectState = {
        path: projectPath,
        name: basename(projectPath),
        lastOpened: new Date().toISOString(),
        needsInstall,
        isGitRepo
      }

      // Add to active projects if not present
      const active = this.store.get('activeProjects', [])
      const isNewProject = !active.find(p => p.path === projectPath)

      if (isNewProject) {
        const newActive = [...active, project]
        this.store.set('activeProjects', newActive)
        log.info('Added project to active list')
      }

      // Always switch to the selected/added project
      this.store.set('currentProjectPath', projectPath)
      log.info(isNewProject ? 'Switched to newly added project' : 'Switched to existing project')

      // Update recent projects
      const recent = this.store.get('recentProjects', [])
      const filtered = recent.filter((p) => p.path !== projectPath)
      this.store.set('recentProjects', [project, ...filtered].slice(0, 10))
      log.info('Updated recent projects list')

      // Ensure base branch agent exists (if not needing install, and is a git repo)
      if (this.agentService && !needsInstall && isGitRepo) {
        try {
          await this.agentService.ensureBaseBranchAgent(projectPath)
          log.info('Base branch agent ensured for project')
        } catch (error) {
          log.error('Error ensuring base branch agent:', error)
        }
      }

      log.info('Successfully added project:', projectPath)
      return project
    } catch (error: any) {
      log.error('Error adding project:', error.message)
      throw error
    }
  }

  removeProject(projectPath: string): void {
    const active = this.store.get('activeProjects', [])
    const newActive = active.filter(p => p.path !== projectPath)
    this.store.set('activeProjects', newActive)

    const current = this.store.get('currentProjectPath')
    if (current === projectPath) {
      // Switch to another project if available
      this.store.set('currentProjectPath', newActive.length > 0 ? newActive[newActive.length - 1].path : null)
    }
  }

  switchProject(projectPath: string): void {
    const active = this.store.get('activeProjects', [])
    if (active.find(p => p.path === projectPath)) {
      this.store.set('currentProjectPath', projectPath)
    }
  }

  getActiveProjects(): ProjectState[] {
    return this.store.get('activeProjects', [])
  }

  getCurrentProject(): ProjectState | null {
    const currentPath = this.store.get('currentProjectPath')
    if (!currentPath) return null

    // Prefer finding in active projects, fallback to recent/file check
    const active = this.store.get('activeProjects', [])
    const activeProject = active.find((p) => p.path === currentPath)
    if (activeProject) return activeProject

    // Fallback if state drifted (shouldn't happen due to validateActiveProjects)
    return null
  }

  getRecentProjects(): ProjectState[] {
    return this.store.get('recentProjects', [])
  }

  clearCurrentProject(): void {
    this.store.set('currentProjectPath', null)
  }

  /**
   * Install the framework using the new minimal structure.
   * Creates minions.json and .minions/ folder without copying scripts/rules.
   *
   * @param projectPath - Path to the project root
   */
  async installFramework(projectPath: string): Promise<void> {
    log.info('Installing framework (minimal structure) for:', projectPath)
    const isGitRepo = existsSync(join(projectPath, '.git'))

    try {
      // Get default config with auto-detected project info
      const config = this.minionsConfigService.getDefaultConfig(projectPath)
      log.info('Generated default config:', config.project.name)

      // Write minions.json
      this.minionsConfigService.writeConfig(projectPath, config)
      log.info('Created minions.json')

      // Initialize .minions/ folder structure
      this.minionsConfigService.initializeMinionsFolder(projectPath)
      log.info('Initialized .minions/ folder')

      // Update .gitignore to include .minions/ (only for git repos)
      if (isGitRepo) {
        this.minionsConfigService.updateGitignore(projectPath)
        log.info('Updated .gitignore')
      }

      // Ensure base branch agent exists after framework installation (only for git repos)
      if (this.agentService && isGitRepo) {
        try {
          await this.agentService.ensureBaseBranchAgent(projectPath)
          log.info('Base branch agent ensured after installation')
        } catch (error) {
          log.error('Error ensuring base branch agent after installation:', error)
        }
      }

      log.info('Framework installation completed successfully')
    } catch (error: any) {
      const errorMsg = `Failed to install framework: ${error.message}`
      log.error('Installation error:', errorMsg)
      log.error('Error details:', error)
      throw new Error(errorMsg)
    }
  }

  /**
   * Install the framework using the legacy structure (copies minions/ folder).
   * @deprecated Use installFramework() for new projects.
   *
   * @param projectPath - Path to the project root
   */
  async installFrameworkLegacy(projectPath: string): Promise<void> {
    log.info('Installing framework (legacy) for:', projectPath)
    const isGitRepo = existsSync(join(projectPath, '.git'))

    const minionsSrc = this.getMinionsSourcePath()
    const minionsDest = join(projectPath, 'minions')

    log.info('Framework source:', minionsSrc)
    log.info('Framework destination:', minionsDest)

    if (!existsSync(minionsSrc)) {
      const error = `Framework assets not found at ${minionsSrc}`
      log.error('Error:', error)
      throw new Error(error)
    }

    try {
      // Copy minions directory
      log.info('Copying framework files...')
      cpSync(minionsSrc, minionsDest, { recursive: true })
      log.info('Framework files copied successfully')

      // Remove dashboard.sh from the installed copy (users should use main app)
      const dashboardScript = join(minionsDest, 'bin', 'dashboard.sh')
      if (existsSync(dashboardScript)) {
        const { unlinkSync } = require('fs')
        try {
          unlinkSync(dashboardScript)
          log.info('Removed dashboard.sh')
        } catch (e) {
          log.warn('Failed to remove dashboard.sh:', e)
        }
      }

      // Configure project name in config.sh
      log.info('Configuring project name...')
      const configPath = join(minionsDest, 'bin', 'config.sh')
      const projectName = basename(projectPath)

      if (existsSync(configPath)) {
        let config = readFileSync(configPath, 'utf-8')
        config = config.replace(/PROJECT_NAME=".*"/, `PROJECT_NAME="${projectName}"`)
        writeFileSync(configPath, config)
        log.info('Updated config.sh with project name:', projectName)
      } else {
        log.warn('config.sh not found at:', configPath)
      }

      // Configure project name in config.json
      log.info('Configuring project name in config.json...')
      const configJsonPath = join(minionsDest, 'config.json')

      if (existsSync(configJsonPath)) {
        try {
          const configJson = JSON.parse(readFileSync(configJsonPath, 'utf-8'))
          configJson.project = configJson.project || {}
          configJson.project.name = projectName
          writeFileSync(configJsonPath, JSON.stringify(configJson, null, 2))
          log.info('Updated config.json with project name:', projectName)
        } catch (e) {
          log.warn('Failed to update config.json:', e)
        }
      } else {
        log.warn('config.json not found at:', configJsonPath)
      }

      // Add to .gitignore
      log.info('Updating .gitignore...')
      const gitignorePath = join(projectPath, '.gitignore')
      const ignoreContent = '\n# Agent Framework\n.agent-info\n.minions-base-info\n'
      if (existsSync(gitignorePath)) {
        const currentIgnore = readFileSync(gitignorePath, 'utf-8')
        if (!currentIgnore.includes('.agent-info')) {
          writeFileSync(gitignorePath, currentIgnore + ignoreContent)
          log.info('Added .agent-info and .minions-base-info to .gitignore')
        } else if (!currentIgnore.includes('.minions-base-info')) {
          writeFileSync(gitignorePath, currentIgnore + '\n.minions-base-info\n')
          log.info('Added .minions-base-info to .gitignore')
        } else {
          log.info('Agent files already in .gitignore')
        }
      } else {
        writeFileSync(gitignorePath, ignoreContent)
        log.info('Created .gitignore with agent files')
      }

      // Ensure base branch agent exists after framework installation (only for git repos)
      if (this.agentService && isGitRepo) {
        try {
          await this.agentService.ensureBaseBranchAgent(projectPath)
          log.info('Base branch agent ensured after installation')
        } catch (error) {
          log.error('Error ensuring base branch agent after installation:', error)
        }
      }

      log.info('Framework installation completed successfully')
    } catch (error: any) {
      const errorMsg = `Failed to install framework: ${error.message}`
      log.error('Installation error:', errorMsg)
      log.error('Error details:', error)
      throw new Error(errorMsg)
    }
  }

  private getMinionsSourcePath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'minions')
    } else {
      return join(__dirname, '../../../minions')
    }
  }
}
