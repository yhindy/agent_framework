import Store from 'electron-store'
import { join, basename } from 'path'
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

interface ProjectState {
  path: string
  name: string
  lastOpened: string
  needsInstall?: boolean
}

interface StoreSchema {
  currentProject: string | null
  recentProjects: ProjectState[]
}

export class ProjectService {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: {
        currentProject: null,
        recentProjects: []
      }
    })
  }

  selectProject(projectPath: string): ProjectState {
    // Validate project path
    if (!existsSync(projectPath)) {
      throw new Error('Project path does not exist')
    }

    // Check if it has the agent framework
    const agentsPath = join(projectPath, 'minions')
    const needsInstall = !existsSync(agentsPath)

    const project: ProjectState = {
      path: projectPath,
      name: basename(projectPath),
      lastOpened: new Date().toISOString(),
      needsInstall
    }

    // Update current project
    this.store.set('currentProject', projectPath)

    // Update recent projects
    const recent = this.store.get('recentProjects', [])
    const filtered = recent.filter((p) => p.path !== projectPath)
    this.store.set('recentProjects', [project, ...filtered].slice(0, 10))

    return project
  }

  getCurrentProject(): ProjectState | null {
    const currentPath = this.store.get('currentProject')
    if (!currentPath) return null

    const recent = this.store.get('recentProjects', [])
    return recent.find((p) => p.path === currentPath) || null
  }

  getRecentProjects(): ProjectState[] {
    return this.store.get('recentProjects', [])
  }

  clearCurrentProject(): void {
    this.store.set('currentProject', null)
  }

  async installFramework(projectPath: string): Promise<void> {
    const minionsSrc = this.getMinionsSourcePath()
    const minionsDest = join(projectPath, 'minions')

    if (!existsSync(minionsSrc)) {
      throw new Error(`Framework assets not found at ${minionsSrc}`)
    }

    try {
      // Copy minions directory
      cpSync(minionsSrc, minionsDest, { recursive: true })
      
      // Remove dashboard.sh from the installed copy (users should use main app)
      const dashboardScript = join(minionsDest, 'bin', 'dashboard.sh')
      if (existsSync(dashboardScript)) {
        // We can't easily unlink in cpSync, so just remove it after copy
        // But since we might not have unlink imported, let's skip for now or use node fs
        // Actually, we can just leave it or remove it. Let's try to remove it.
        // We need 'rmSync' or 'unlinkSync'
        const { unlinkSync } = require('fs')
        try { unlinkSync(dashboardScript) } catch (e) {}
      }

      // Configure project name in config.sh
      const configPath = join(minionsDest, 'bin', 'config.sh')
      if (existsSync(configPath)) {
        let config = readFileSync(configPath, 'utf-8')
        config = config.replace(/PROJECT_NAME=".*"/, `PROJECT_NAME="${basename(projectPath)}"`)
        writeFileSync(configPath, config)
      }

      // Add to .gitignore
      const gitignorePath = join(projectPath, '.gitignore')
      const ignoreContent = '\n# Agent Framework\n.agent-info\n'
      if (existsSync(gitignorePath)) {
        const currentIgnore = readFileSync(gitignorePath, 'utf-8')
        if (!currentIgnore.includes('.agent-info')) {
          writeFileSync(gitignorePath, currentIgnore + ignoreContent)
        }
      } else {
        writeFileSync(gitignorePath, ignoreContent)
      }
      
    } catch (error: any) {
      throw new Error(`Failed to install framework: ${error.message}`)
    }
  }

  private getMinionsSourcePath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'minions')
    } else {
      return join(__dirname, '../../../../minions')
    }
  }
}

