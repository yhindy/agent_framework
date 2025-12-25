import Store from 'electron-store'
import { join, basename } from 'path'
import { existsSync, cpSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

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

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: {
        currentProjectPath: null,
        activeProjects: [],
        recentProjects: []
      }
    })

    this.validateActiveProjects()
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
  selectProject(projectPath: string): ProjectState {
    return this.addProject(projectPath)
  }

  addProject(projectPath: string): ProjectState {
    console.log('[ProjectService] Adding project:', projectPath)

    // Validate project path
    if (!existsSync(projectPath)) {
      const error = `Project path does not exist: ${projectPath}`
      console.error('[ProjectService] Error:', error)
      throw new Error(error)
    }

    try {
      // Check if it has the agent framework
      const agentsPath = join(projectPath, 'minions')
      const needsInstall = !existsSync(agentsPath)
      console.log('[ProjectService] Project needs install:', needsInstall)

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
        console.log('[ProjectService] Added project to active list')

        // If this is the first project, make it current
        if (active.length === 0) {
          this.store.set('currentProjectPath', projectPath)
          console.log('[ProjectService] Set as first project (current)')
        } else {
          // Auto-switch to newly added project
          this.store.set('currentProjectPath', projectPath)
          console.log('[ProjectService] Switched to newly added project')
        }
      } else {
        // If already active, just switch to it
        this.store.set('currentProjectPath', projectPath)
        console.log('[ProjectService] Project already active, switched to it')
      }

      // Update recent projects
      const recent = this.store.get('recentProjects', [])
      const filtered = recent.filter((p) => p.path !== projectPath)
      this.store.set('recentProjects', [project, ...filtered].slice(0, 10))
      console.log('[ProjectService] Updated recent projects list')

      console.log('[ProjectService] Successfully added project:', projectPath)
      return project
    } catch (error: any) {
      console.error('[ProjectService] Error adding project:', error.message)
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
    console.log('[ProjectService] Installing framework for:', projectPath)

    const minionsSrc = this.getMinionsSourcePath()
    const minionsDest = join(projectPath, 'minions')

    console.log('[ProjectService] Framework source:', minionsSrc)
    console.log('[ProjectService] Framework destination:', minionsDest)

    if (!existsSync(minionsSrc)) {
      const error = `Framework assets not found at ${minionsSrc}`
      console.error('[ProjectService] Error:', error)
      throw new Error(error)
    }

    try {
      // Copy minions directory
      console.log('[ProjectService] Copying framework files...')
      cpSync(minionsSrc, minionsDest, { recursive: true })
      console.log('[ProjectService] Framework files copied successfully')

      // Remove dashboard.sh from the installed copy (users should use main app)
      const dashboardScript = join(minionsDest, 'bin', 'dashboard.sh')
      if (existsSync(dashboardScript)) {
        const { unlinkSync } = require('fs')
        try {
          unlinkSync(dashboardScript)
          console.log('[ProjectService] Removed dashboard.sh')
        } catch (e) {
          console.warn('[ProjectService] Failed to remove dashboard.sh:', e)
        }
      }

      // Configure project name in config.sh
      console.log('[ProjectService] Configuring project name...')
      const configPath = join(minionsDest, 'bin', 'config.sh')
      const projectName = basename(projectPath)

      if (existsSync(configPath)) {
        let config = readFileSync(configPath, 'utf-8')
        config = config.replace(/PROJECT_NAME=".*"/, `PROJECT_NAME="${projectName}"`)
        writeFileSync(configPath, config)
        console.log('[ProjectService] Updated config.sh with project name:', projectName)
      } else {
        console.warn('[ProjectService] config.sh not found at:', configPath)
      }

      // Add to .gitignore
      console.log('[ProjectService] Updating .gitignore...')
      const gitignorePath = join(projectPath, '.gitignore')
      const ignoreContent = '\n# Agent Framework\n.agent-info\n'
      if (existsSync(gitignorePath)) {
        const currentIgnore = readFileSync(gitignorePath, 'utf-8')
        if (!currentIgnore.includes('.agent-info')) {
          writeFileSync(gitignorePath, currentIgnore + ignoreContent)
          console.log('[ProjectService] Added .agent-info to .gitignore')
        } else {
          console.log('[ProjectService] .agent-info already in .gitignore')
        }
      } else {
        writeFileSync(gitignorePath, ignoreContent)
        console.log('[ProjectService] Created .gitignore with .agent-info')
      }

      console.log('[ProjectService] Framework installation completed successfully')
    } catch (error: any) {
      const errorMsg = `Failed to install framework: ${error.message}`
      console.error('[ProjectService] Installation error:', errorMsg)
      console.error('[ProjectService] Error details:', error)
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
