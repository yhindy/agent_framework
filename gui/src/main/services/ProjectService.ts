import Store from 'electron-store'
import { join, basename } from 'path'
import { existsSync } from 'fs'

interface ProjectState {
  path: string
  name: string
  lastOpened: string
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
    const agentsPath = join(projectPath, 'docs', 'agents')
    if (!existsSync(agentsPath)) {
      throw new Error('Not a valid agent framework project. Missing docs/agents directory.')
    }

    const project: ProjectState = {
      path: projectPath,
      name: basename(projectPath),
      lastOpened: new Date().toISOString()
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
}

