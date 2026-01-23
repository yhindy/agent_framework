import { homedir } from 'os'
import { join, basename } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import {
  SkillDefinition, SkillSource, SkillScript, SkillReference,
  SkillMdFrontmatter, SkillsLibraryScanResult, SkillsLibrarySettings,
  DEFAULT_SKILLS_LIBRARY_SETTINGS
} from './types/SkillsLibraryTypes'
import { ScanError } from './types/ClaudeConfigTypes'

const log = createLogger('SkillsLibraryService')
const MAX_DESC_LEN = 200

const safeReadDir = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  try { return readdirSync(dir) } catch { return [] }
}

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }

export class SkillsLibraryService {
  private claudeDir: string
  private watcher: chokidar.FSWatcher | null = null
  private mainWindow: BrowserWindow | null = null
  private cachedResult: SkillsLibraryScanResult | null = null
  private settings: SkillsLibrarySettings = DEFAULT_SKILLS_LIBRARY_SETTINGS
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null
  private currentProjectPath: string | null = null

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir || join(homedir(), '.claude')
  }

  setWindow(window: BrowserWindow) { this.mainWindow = window }
  setProjectPath(projectPath: string | null) { this.currentProjectPath = projectPath; this.cachedResult = null }
  getVercelSkillsPath() { return join(this.claudeDir, 'skills') }
  getProjectSkillsPath(p?: string) { const path = p || this.currentProjectPath; return path ? join(path, '.claude', 'skills') : null }
  getSettings() { return { ...this.settings } }
  updateSettings(updates: Partial<SkillsLibrarySettings>) { this.settings = { ...this.settings, ...updates }; return this.settings }

  scan(projectPath?: string): SkillsLibraryScanResult {
    const errors: ScanError[] = []
    const vercelSkills: SkillDefinition[] = []
    const projectSkills: SkillDefinition[] = []

    if (this.settings.vercelSkillsEnabled) {
      const p = this.getVercelSkillsPath()
      if (existsSync(p)) {
        const r = this.scanDir(p, { type: 'vercel-skill', name: 'Vercel Skills', path: p })
        vercelSkills.push(...r.skills); errors.push(...r.errors)
      }
    }

    if (this.settings.projectSkillsEnabled) {
      const p = this.getProjectSkillsPath(projectPath)
      if (p && existsSync(p)) {
        const name = basename(projectPath || this.currentProjectPath || 'project')
        const r = this.scanDir(p, { type: 'project-skill', name, path: p })
        projectSkills.push(...r.skills); errors.push(...r.errors)
      }
    }

    this.cachedResult = { vercelSkills, projectSkills, errors, lastScanned: new Date().toISOString() }
    return this.cachedResult
  }

  private scanDir(dir: string, source: SkillSource): { skills: SkillDefinition[]; errors: ScanError[] } {
    const skills: SkillDefinition[] = []
    const errors: ScanError[] = []

    try {
      for (const name of safeReadDir(dir).filter(n => isDir(join(dir, n)))) {
        const skillPath = join(dir, name)
        const mdPath = join(skillPath, 'SKILL.md')
        if (!existsSync(mdPath)) continue

        try {
          const content = readFileSync(mdPath, 'utf-8')
          const { frontmatter, body } = this.parseFrontmatter<SkillMdFrontmatter>(content)
          const id = `${source.type === 'project-skill' ? 'project' : 'vercel'}:${this.slugify(name)}`

          skills.push({
            id,
            name: frontmatter?.name || this.titleCase(name),
            description: frontmatter?.description || this.extractDesc(body),
            source,
            filePath: mdPath,
            promptContent: body,
            scripts: this.scanScripts(skillPath),
            references: this.scanRefs(skillPath)
          })
        } catch (e) {
          errors.push({ type: 'parse', path: mdPath, message: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      errors.push({ type: 'read', path: dir, message: e instanceof Error ? e.message : String(e) })
    }
    return { skills, errors }
  }

  private scanScripts(skillPath: string): SkillScript[] {
    const dir = join(skillPath, 'scripts')
    return safeReadDir(dir)
      .filter(f => f.endsWith('.sh') && isFile(join(dir, f)))
      .map(f => {
        const p = join(dir, f)
        const content = readFileSync(p, 'utf-8')
        const desc = content.split('\n').find(l => l.trim().startsWith('#') && !l.startsWith('#!'))?.slice(1).trim()
        return { name: basename(f, '.sh'), filename: f, path: p, content, description: desc }
      })
  }

  private scanRefs(skillPath: string): SkillReference[] {
    const dir = join(skillPath, 'references')
    return safeReadDir(dir)
      .filter(f => isFile(join(dir, f)))
      .map(f => ({ name: f, path: join(dir, f), content: readFileSync(join(dir, f), 'utf-8') }))
  }

  private parseFrontmatter<T>(content: string): { frontmatter: T | null; body: string } {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
    if (!m) return { frontmatter: null, body: content }

    const fm: Record<string, unknown> = {}
    for (const line of m[1].split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf(':')
      if (i === -1) continue
      const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim()
      fm[k] = v.startsWith('[') ? v.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, ''))
        : v === 'true' ? true : v === 'false' ? false
        : (v.startsWith('"') || v.startsWith("'")) ? v.slice(1, -1)
        : !isNaN(Number(v)) && v !== '' ? Number(v) : v
    }
    return { frontmatter: fm as T, body: content.slice(m[0].length) }
  }

  private extractDesc(content: string): string {
    const lines = content.split('\n').filter(l => !l.trim().startsWith('#'))
    const para: string[] = []
    for (const l of lines) {
      const t = l.trim()
      if (!t && para.length) break
      if (t) para.push(t)
    }
    const d = para.join(' ')
    return d.length > MAX_DESC_LEN ? d.slice(0, MAX_DESC_LEN - 3) + '...' : d || 'No description available'
  }

  private slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  private titleCase = (s: string) => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

  getScanResult(projectPath?: string) { return this.cachedResult || this.scan(projectPath) }

  refresh(projectPath?: string) {
    const result = this.scan(projectPath)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('skillsLibrary:updated', result)
    }
    return result
  }

  getEnabledSkills(projectPath?: string) {
    const { vercelSkills, projectSkills } = this.getScanResult(projectPath)
    return [...vercelSkills, ...projectSkills].filter(s => !this.settings.disabledSkillIds.includes(s.id))
  }

  startWatching() {
    if (this.watcher) return
    const paths = [this.getVercelSkillsPath(), this.getProjectSkillsPath()].filter(p => p && existsSync(p)) as string[]
    if (!paths.length) return

    this.watcher = chokidar.watch(paths, { persistent: true, ignoreInitial: true, depth: 3 })
      .on('all', () => { clearTimeout(this.refreshTimeout!); this.refreshTimeout = setTimeout(() => this.refresh(), 1000) })
      .on('error', e => log.error('Watcher error:', e))
  }

  stopWatching() {
    this.watcher?.close(); this.watcher = null
    clearTimeout(this.refreshTimeout!); this.refreshTimeout = null
  }

  cleanup() { this.stopWatching(); this.cachedResult = null }
}
