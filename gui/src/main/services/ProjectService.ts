import Store from 'electron-store'
import { join, basename } from 'path'
import { existsSync, cpSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { AgentService } from './AgentService'
import { createLogger } from './logger'

const log = createLogger('ProjectService')

export interface ProjectState {
  path: string
  name: string
  lastOpened: string
  needsInstall?: boolean
}

interface StoreSchema {
  currentProjectPath: string | null
  activeProjects: ProjectState[]
  recentProjects: ProjectState[]
}

export class ProjectService {
  private store: Store<StoreSchema>
  private agentService: AgentService | null = null

  constructor(agentService?: AgentService) {
    this.store = new Store<StoreSchema>({
      defaults: {
        currentProjectPath: null,
        activeProjects: [],
        recentProjects: []
      }
    })

    this.agentService = agentService || null
    this.validateActiveProjects()
  }

  setAgentService(agentService: AgentService): void {
    this.agentService = agentService
  }

  // Validate active projects on startup (robustness)
  private validateActiveProjects() {
    const active = this.store.get('activeProjects', [])
    const validProjects = active.filter(p => existsSync(p.path))
    
    if (validProjects.length !== active.length) {
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

    // Validate project path
    if (!existsSync(projectPath)) {
      const error = `Project path does not exist: ${projectPath}`
      log.error('Error:', error)
      throw new Error(error)
    }

    try {
      // Check if it has the agent framework
      const agentsPath = join(projectPath, 'minions')
      const needsInstall = !existsSync(agentsPath)
      log.info('Project needs install:', needsInstall)

      const project: ProjectState = {
        path: projectPath,
        name: basename(projectPath),
        lastOpened: new Date().toISOString(),
        needsInstall
      }

      // Add to active projects if not present
      const active = this.store.get('activeProjects', [])
      const isNewProject = !active.find(p => p.path === projectPath)

      if (isNewProject) {
        const newActive = [...active, project]
        this.store.set('activeProjects', newActive)
        log.info('Added project to active list')

        // If this is the first project, make it current
        if (active.length === 0) {
          this.store.set('currentProjectPath', projectPath)
          log.info('Set as first project (current)')
        } else {
          // Auto-switch to newly added project
          this.store.set('currentProjectPath', projectPath)
          log.info('Switched to newly added project')
        }
      } else {
        // If already active, just switch to it
        this.store.set('currentProjectPath', projectPath)
        log.info('Project already active, switched to it')
      }

      // Update recent projects
      const recent = this.store.get('recentProjects', [])
      const filtered = recent.filter((p) => p.path !== projectPath)
      this.store.set('recentProjects', [project, ...filtered].slice(0, 10))
      log.info('Updated recent projects list')

      // Ensure base branch agent exists (if not needing install)
      if (this.agentService && !needsInstall) {
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

  async installFramework(projectPath: string): Promise<void> {
    log.info('Installing framework for:', projectPath)

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

      // Ensure base branch agent exists after framework installation
      if (this.agentService) {
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
