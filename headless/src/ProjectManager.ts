import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename, resolve, dirname } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'
import type { ProjectState } from './types'

const log = createLogger('ProjectManager')

interface ProjectStore {
  currentProjectPath: string | null
  activeProjects: ProjectState[]
  recentProjects: ProjectState[]
}

export class ProjectManager {
  private store: ProjectStore
  private storePath: string

  constructor(storePath?: string) {
    this.storePath = storePath || join(homedir(), '.agent-framework', 'projects.json')
    this.store = this.loadStore()
    // Remove projects whose paths no longer exist
    const before = this.store.activeProjects.length
    this.store.activeProjects = this.store.activeProjects.filter(p => existsSync(p.path))
    if (this.store.activeProjects.length !== before) {
      if (this.store.currentProjectPath && !this.store.activeProjects.find(p => p.path === this.store.currentProjectPath)) {
        this.store.currentProjectPath = this.store.activeProjects[0]?.path || null
      }
      this.saveStore()
    }
  }

  private loadStore(): ProjectStore {
    const defaults: ProjectStore = { currentProjectPath: null, activeProjects: [], recentProjects: [] }
    try {
      if (existsSync(this.storePath)) return { ...defaults, ...JSON.parse(readFileSync(this.storePath, 'utf-8')) }
    } catch (e) { log.warn('Failed to load project store', e) }
    return defaults
  }

  private saveStore(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true })
      writeFileSync(this.storePath, JSON.stringify(this.store, null, 2))
    } catch (e) { log.error('Failed to save project store', e) }
  }

  async addProject(projectPath: string): Promise<ProjectState> {
    log.info('Adding project:', projectPath)
    const normalized = resolve(projectPath)
    if (!existsSync(normalized)) throw new Error(`Project path does not exist: ${normalized}`)

    const needsInstall = !existsSync(join(normalized, 'minions.json')) && !existsSync(join(normalized, 'minions', 'config.json'))
    const project: ProjectState = { path: normalized, name: basename(normalized), lastOpened: new Date().toISOString(), needsInstall }

    if (!this.store.activeProjects.find(p => p.path === normalized)) {
      this.store.activeProjects.push(project)
    }
    this.store.currentProjectPath = normalized
    this.store.recentProjects = [project, ...this.store.recentProjects.filter(p => p.path !== normalized)].slice(0, 10)
    this.saveStore()
    log.info('Successfully added project:', normalized)
    return project
  }

  removeProject(projectPath: string): void {
    this.store.activeProjects = this.store.activeProjects.filter(p => p.path !== projectPath)
    if (this.store.currentProjectPath === projectPath) {
      this.store.currentProjectPath = this.store.activeProjects.at(-1)?.path || null
    }
    this.saveStore()
  }

  getActiveProjects(): ProjectState[] { return this.store.activeProjects }
  getCurrentProject(): ProjectState | null {
    return this.store.activeProjects.find(p => p.path === this.store.currentProjectPath) || null
  }

  switchProject(projectPath: string): void {
    if (this.store.activeProjects.find(p => p.path === projectPath)) {
      this.store.currentProjectPath = projectPath
      this.saveStore()
    }
  }
}
