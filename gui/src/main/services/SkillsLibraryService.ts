import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'
import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import {
  ItemDefinition, LibraryScanResult, SkillsLibrarySettings,
  SourceType, Scope, DEFAULT_SKILLS_LIBRARY_SETTINGS
} from './types/SkillsLibraryTypes'
import { ScanError } from './types/ClaudeConfigTypes'

const log = createLogger('SkillsLibraryService')
const MAX_DESC = 200

const safeRead = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  try { return readdirSync(dir).filter(f => f.endsWith('.md')) } catch { return [] }
}

export class SkillsLibraryService {
  private claudeDir: string
  private watcher: chokidar.FSWatcher | null = null
  private mainWindow: BrowserWindow | null = null
  private cachedResult: LibraryScanResult | null = null
  private settings: SkillsLibrarySettings = DEFAULT_SKILLS_LIBRARY_SETTINGS
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null
  private currentProjectPath: string | null = null

  constructor(claudeDir?: string) { this.claudeDir = claudeDir || join(homedir(), '.claude') }

  setWindow(w: BrowserWindow) { this.mainWindow = w }
  setProjectPath(p: string | null) { this.currentProjectPath = p; this.cachedResult = null }
  getSettings() { return { ...this.settings } }
  updateSettings(u: Partial<SkillsLibrarySettings>) { this.settings = { ...this.settings, ...u }; return this.settings }

  getCommandsPath(scope: Scope = 'global', project?: string) {
    return scope === 'global' ? join(this.claudeDir, 'commands') : join(project || this.currentProjectPath || '', '.claude', 'commands')
  }
  getAgentsPath(scope: Scope = 'global', project?: string) {
    return scope === 'global' ? join(this.claudeDir, 'agents') : join(project || this.currentProjectPath || '', '.claude', 'agents')
  }

  scan(projectPath?: string): LibraryScanResult {
    const errors: ScanError[] = []
    const project = projectPath || this.currentProjectPath

    const scanDir = (type: SourceType, scope: Scope): ItemDefinition[] => {
      const path = type === 'command' ? this.getCommandsPath(scope, project || undefined) : this.getAgentsPath(scope, project || undefined)
      if (!existsSync(path)) return []

      const items: ItemDefinition[] = []
      for (const file of safeRead(path)) {
        try {
          const filePath = join(path, file)
          const content = readFileSync(filePath, 'utf-8')
          const { frontmatter, body } = this.parseFrontmatter(content)
          const name = file.replace('.md', '')
          const prefix = scope === 'project' ? `project-${type}` : type

          items.push({
            id: `${prefix}:${name}`,
            name: frontmatter?.name || this.titleCase(name),
            description: frontmatter?.description || this.extractDesc(body),
            source: { type, scope, path },
            filePath,
            promptContent: body,
            model: frontmatter?.model,
            color: frontmatter?.color
          })
        } catch (e) {
          errors.push({ type: 'parse', path: join(path, file), message: e instanceof Error ? e.message : String(e) })
        }
      }
      return items
    }

    const commands = this.settings.commandsEnabled !== false ? scanDir('command', 'global') : []
    const agents = this.settings.agentsEnabled !== false ? scanDir('agent', 'global') : []
    const projectCommands = project && this.settings.projectSkillsEnabled ? scanDir('command', 'project') : []
    const projectAgents = project && this.settings.projectSkillsEnabled ? scanDir('agent', 'project') : []

    this.cachedResult = { commands, agents, projectCommands, projectAgents, errors, lastScanned: new Date().toISOString() }
    return this.cachedResult
  }

  private parseFrontmatter(content: string): { frontmatter: Record<string, string> | null; body: string } {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!m) return { frontmatter: null, body: content }

    const fm: Record<string, string> = {}
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':')
      if (i === -1) continue
      const k = line.slice(0, i).trim()
      let v = line.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      fm[k] = v
    }
    return { frontmatter: fm, body: content.slice(m[0].length) }
  }

  private extractDesc(content: string): string {
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    const d = lines.slice(0, 3).join(' ').trim()
    return d.length > MAX_DESC ? d.slice(0, MAX_DESC - 3) + '...' : d || 'No description'
  }

  private titleCase = (s: string) => s.split(/[-_]/).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ')

  getScanResult(p?: string) { return this.cachedResult || this.scan(p) }

  refresh(p?: string) {
    const result = this.scan(p)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('skillsLibrary:updated', result)
    }
    return result
  }

  getEnabledItems(p?: string) {
    const r = this.getScanResult(p)
    const all = [...r.commands, ...r.agents, ...r.projectCommands, ...r.projectAgents]
    return all.filter(i => !this.settings.disabledSkillIds.includes(i.id))
  }

  getEnabledSkills(p?: string) { return this.getEnabledItems(p) }

  startWatching() {
    if (this.watcher) return
    const paths = [
      this.getCommandsPath('global'), this.getAgentsPath('global'),
      ...(this.currentProjectPath ? [this.getCommandsPath('project'), this.getAgentsPath('project')] : [])
    ].filter(p => existsSync(p))
    if (!paths.length) return

    this.watcher = chokidar.watch(paths, { persistent: true, ignoreInitial: true, depth: 1 })
      .on('all', () => { clearTimeout(this.refreshTimeout!); this.refreshTimeout = setTimeout(() => this.refresh(), 500) })
      .on('error', e => log.error('Watcher error:', e))
  }

  stopWatching() {
    this.watcher?.close(); this.watcher = null
    clearTimeout(this.refreshTimeout!); this.refreshTimeout = null
  }

  cleanup() { this.stopWatching(); this.cachedResult = null }
}
