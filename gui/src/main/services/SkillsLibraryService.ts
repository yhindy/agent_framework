/**
 * Service for discovering and managing skills from the Skills Library.
 *
 * Scans skills from:
 * - Vercel skills: ~/.claude/skills/
 * - Project-local skills: {project}/.claude/skills/
 *
 * Vercel skill structure:
 *   skills/{skill-name}/
 *   ├── SKILL.md           # Skill definition with frontmatter
 *   ├── scripts/           # Optional executable scripts
 *   │   └── *.sh
 *   └── references/        # Optional reference files
 *       └── *.md
 */

import { homedir } from 'os'
import { join, basename } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import {
  SkillDefinition,
  SkillSource,
  SkillScript,
  SkillReference,
  SkillMdFrontmatter,
  SkillsLibraryScanResult,
  SkillsLibrarySettings,
  DEFAULT_SKILLS_LIBRARY_SETTINGS
} from './types/SkillsLibraryTypes'
import { ScanError } from './types/ClaudeConfigTypes'

const log = createLogger('SkillsLibraryService')

const DESCRIPTION_MAX_LENGTH = 200
const DEBOUNCE_MS = 1000

/** Get subdirectories of a given path. */
function getSubdirectories(dirPath: string): string[] {
  if (!existsSync(dirPath)) return []
  return readdirSync(dirPath).filter(name => {
    const fullPath = join(dirPath, name)
    try {
      return statSync(fullPath).isDirectory()
    } catch {
      return false
    }
  })
}

/** Get files with a specific extension in a directory. */
function getFilesWithExtension(dirPath: string, ext: string): string[] {
  if (!existsSync(dirPath)) return []
  return readdirSync(dirPath).filter(name => {
    const fullPath = join(dirPath, name)
    try {
      return statSync(fullPath).isFile() && name.endsWith(ext)
    } catch {
      return false
    }
  })
}

/**
 * Service for managing skills from the Skills Library.
 */
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

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  setProjectPath(projectPath: string | null): void {
    this.currentProjectPath = projectPath
    // Clear cache when project changes
    this.cachedResult = null
  }

  getVercelSkillsPath(): string {
    return join(this.claudeDir, 'skills')
  }

  getProjectSkillsPath(projectPath?: string): string | null {
    const path = projectPath || this.currentProjectPath
    if (!path) return null
    return join(path, '.claude', 'skills')
  }

  /**
   * Scan all skills sources.
   */
  scan(projectPath?: string): SkillsLibraryScanResult {
    const errors: ScanError[] = []
    const vercelSkills: SkillDefinition[] = []
    const projectSkills: SkillDefinition[] = []

    // Scan Vercel skills (~/.claude/skills/)
    if (this.settings.vercelSkillsEnabled) {
      const vercelPath = this.getVercelSkillsPath()
      if (existsSync(vercelPath)) {
        const { skills, errors: vercelErrors } = this.scanSkillsDirectory(
          vercelPath,
          { type: 'vercel-skill', name: 'Vercel Skills', path: vercelPath }
        )
        vercelSkills.push(...skills)
        errors.push(...vercelErrors)
      }
    }

    // Scan project skills ({project}/.claude/skills/)
    if (this.settings.projectSkillsEnabled) {
      const projPath = this.getProjectSkillsPath(projectPath)
      if (projPath && existsSync(projPath)) {
        const projectName = basename(projectPath || this.currentProjectPath || 'project')
        const { skills, errors: projectErrors } = this.scanSkillsDirectory(
          projPath,
          { type: 'project-skill', name: projectName, path: projPath }
        )
        projectSkills.push(...skills)
        errors.push(...projectErrors)
      }
    }

    const result: SkillsLibraryScanResult = {
      vercelSkills,
      projectSkills,
      errors,
      lastScanned: new Date().toISOString()
    }

    this.cachedResult = result
    return result
  }

  /**
   * Scan a skills directory for skill definitions.
   */
  private scanSkillsDirectory(
    skillsDir: string,
    source: SkillSource
  ): { skills: SkillDefinition[]; errors: ScanError[] } {
    const skills: SkillDefinition[] = []
    const errors: ScanError[] = []

    try {
      const skillDirs = getSubdirectories(skillsDir)

      for (const skillName of skillDirs) {
        const skillPath = join(skillsDir, skillName)
        const skillMdPath = join(skillPath, 'SKILL.md')

        if (!existsSync(skillMdPath)) {
          log.debug(`No SKILL.md found in ${skillPath}, skipping`)
          continue
        }

        try {
          const skill = this.parseSkill(skillPath, skillName, source)
          if (skill) {
            skills.push(skill)
          }
        } catch (error) {
          log.warn(`Failed to parse skill ${skillName}:`, error)
          errors.push(this.createScanError('parse', skillMdPath, error))
        }
      }
    } catch (error) {
      log.error(`Failed to scan skills directory ${skillsDir}:`, error)
      errors.push(this.createScanError('read', skillsDir, error))
    }

    return { skills, errors }
  }

  /**
   * Parse a single skill from its directory.
   */
  private parseSkill(
    skillPath: string,
    skillName: string,
    source: SkillSource
  ): SkillDefinition | null {
    const skillMdPath = join(skillPath, 'SKILL.md')
    const content = readFileSync(skillMdPath, 'utf-8')
    const { frontmatter, body } = this.parseMarkdownFrontmatter<SkillMdFrontmatter>(content)

    const scripts = this.scanScripts(skillPath)
    const references = this.scanReferences(skillPath)

    const id = this.createSkillId(source.type, skillName)

    return {
      id,
      name: frontmatter?.name || this.formatSkillName(skillName),
      description: frontmatter?.description || this.extractFirstParagraph(body),
      source,
      filePath: skillMdPath,
      promptContent: body,
      scripts,
      references
    }
  }

  /**
   * Scan the scripts/ directory for executable scripts.
   */
  private scanScripts(skillPath: string): SkillScript[] {
    const scriptsDir = join(skillPath, 'scripts')
    if (!existsSync(scriptsDir)) return []

    const scripts: SkillScript[] = []
    const scriptFiles = getFilesWithExtension(scriptsDir, '.sh')

    for (const filename of scriptFiles) {
      const scriptPath = join(scriptsDir, filename)
      try {
        const content = readFileSync(scriptPath, 'utf-8')
        const description = this.extractScriptDescription(content)
        scripts.push({
          name: basename(filename, '.sh'),
          filename,
          path: scriptPath,
          content,
          description
        })
      } catch (error) {
        log.warn(`Failed to read script ${scriptPath}:`, error)
      }
    }

    return scripts
  }

  /**
   * Scan the references/ directory for reference files.
   */
  private scanReferences(skillPath: string): SkillReference[] {
    const refsDir = join(skillPath, 'references')
    if (!existsSync(refsDir)) return []

    const references: SkillReference[] = []

    try {
      const refFiles = readdirSync(refsDir).filter(f => {
        const fullPath = join(refsDir, f)
        try {
          return statSync(fullPath).isFile()
        } catch {
          return false
        }
      })

      for (const filename of refFiles) {
        const refPath = join(refsDir, filename)
        try {
          const content = readFileSync(refPath, 'utf-8')
          references.push({
            name: filename,
            path: refPath,
            content
          })
        } catch (error) {
          log.warn(`Failed to read reference ${refPath}:`, error)
        }
      }
    } catch (error) {
      log.warn(`Failed to scan references directory:`, error)
    }

    return references
  }

  /**
   * Extract description from script comment at the top.
   */
  private extractScriptDescription(content: string): string | undefined {
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip shebang
      if (trimmed.startsWith('#!')) continue
      // Found a comment
      if (trimmed.startsWith('#')) {
        return trimmed.slice(1).trim()
      }
      // Non-comment, non-empty line - stop
      if (trimmed) break
    }
    return undefined
  }

  /**
   * Create a unique skill ID based on source type and name.
   */
  private createSkillId(sourceType: string, skillName: string): string {
    const prefix = sourceType === 'project-skill' ? 'project' : 'vercel'
    return `${prefix}:${this.slugify(skillName)}`
  }

  /**
   * Format a skill name from directory name.
   */
  private formatSkillName(dirName: string): string {
    return dirName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  /**
   * Parse YAML frontmatter from markdown content.
   */
  private parseMarkdownFrontmatter<T>(content: string): { frontmatter: T | null; body: string } {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
    const match = content.match(frontmatterRegex)

    if (!match) {
      return { frontmatter: null, body: content }
    }

    const yamlContent = match[1]
    const body = content.slice(match[0].length)

    try {
      const frontmatter: Record<string, unknown> = {}
      const lines = yamlContent.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const colonIndex = trimmed.indexOf(':')
        if (colonIndex === -1) continue

        const key = trimmed.slice(0, colonIndex).trim()
        const rawValue = trimmed.slice(colonIndex + 1).trim()

        frontmatter[key] = this.parseYamlValue(rawValue)
      }

      return { frontmatter: frontmatter as T, body }
    } catch {
      return { frontmatter: null, body: content }
    }
  }

  private parseYamlValue(raw: string): unknown {
    // Handle quoted strings
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1)
    }

    // Handle arrays (simple format: [item1, item2])
    if (raw.startsWith('[') && raw.endsWith(']')) {
      return raw
        .slice(1, -1)
        .split(',')
        .map(v => v.trim().replace(/^["']|["']$/g, ''))
    }

    // Handle booleans
    if (raw === 'true') return true
    if (raw === 'false') return false

    // Handle numbers
    if (raw !== '' && !isNaN(Number(raw))) {
      return Number(raw)
    }

    return raw
  }

  private extractFirstParagraph(content: string): string {
    const lines = content.split('\n')
    const paragraphLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip headings
      if (trimmed.startsWith('#')) continue

      // Stop at empty line after we have content
      if (trimmed === '' && paragraphLines.length > 0) break

      // Skip empty lines before content
      if (trimmed === '') continue

      paragraphLines.push(trimmed)
    }

    const paragraph = paragraphLines.join(' ').trim()

    if (paragraph.length > DESCRIPTION_MAX_LENGTH) {
      return paragraph.slice(0, DESCRIPTION_MAX_LENGTH - 3) + '...'
    }

    return paragraph || 'No description available'
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  private createScanError(type: ScanError['type'], path: string, error: unknown): ScanError {
    const message = error instanceof Error ? error.message : String(error)
    return { type, path, message }
  }

  /**
   * Get cached scan result, or perform a new scan if not cached.
   */
  getScanResult(projectPath?: string): SkillsLibraryScanResult {
    if (!this.cachedResult) {
      return this.scan(projectPath)
    }
    return this.cachedResult
  }

  /**
   * Force a refresh of the scan.
   */
  refresh(projectPath?: string): SkillsLibraryScanResult {
    const result = this.scan(projectPath)

    // Notify the renderer if window is available
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('skillsLibrary:updated', result)
    }

    return result
  }

  /**
   * Get current settings.
   */
  getSettings(): SkillsLibrarySettings {
    return { ...this.settings }
  }

  /**
   * Update settings.
   */
  updateSettings(updates: Partial<SkillsLibrarySettings>): SkillsLibrarySettings {
    this.settings = { ...this.settings, ...updates }
    return this.settings
  }

  /**
   * Get enabled skills (filtered by settings).
   */
  getEnabledSkills(projectPath?: string): SkillDefinition[] {
    const { vercelSkills, projectSkills } = this.getScanResult(projectPath)
    const { disabledSkillIds } = this.settings

    const allSkills = [...vercelSkills, ...projectSkills]

    return allSkills.filter(skill => !disabledSkillIds.includes(skill.id))
  }

  /**
   * Start watching for changes to skills directories.
   */
  startWatching(): void {
    if (this.watcher) {
      return // Already watching
    }

    const watchPaths: string[] = []

    const vercelPath = this.getVercelSkillsPath()
    if (existsSync(vercelPath)) {
      watchPaths.push(vercelPath)
    }

    const projectPath = this.getProjectSkillsPath()
    if (projectPath && existsSync(projectPath)) {
      watchPaths.push(projectPath)
    }

    if (watchPaths.length === 0) {
      log.debug('No skills directories to watch')
      return
    }

    log.info('Starting to watch skills directories:', watchPaths)

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })

    const handleChange = (event: string) => (path: string) => {
      log.debug(`File ${event} in skills directory:`, path)
      this.handleChange()
    }

    this.watcher
      .on('add', handleChange('added'))
      .on('change', handleChange('changed'))
      .on('unlink', handleChange('removed'))
      .on('error', (error) => log.error('Skills watcher error:', error))
  }

  private handleChange(): void {
    // Debounce rapid changes
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
    }

    this.refreshTimeout = setTimeout(() => {
      this.refresh()
    }, DEBOUNCE_MS)
  }

  /**
   * Stop watching for changes.
   */
  stopWatching(): void {
    if (this.watcher) {
      log.info('Stopping skills watcher')
      this.watcher.close()
      this.watcher = null
    }

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
      this.refreshTimeout = null
    }
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    this.stopWatching()
    this.cachedResult = null
  }
}
