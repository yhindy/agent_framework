import { homedir } from 'os'
import { join, basename } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import {
  ImportedSubagentType,
  AgentConflict,
  ClaudeConfigScanResult,
  ClaudeConfigSettings,
  DEFAULT_CLAUDE_CONFIG_SETTINGS,
  PluginInfo,
  PluginManifest,
  AgentFrontmatter,
  SkillFrontmatter,
  ScanError,
  BUILT_IN_AGENT_IDS
} from './types/ClaudeConfigTypes'

const log = createLogger('ClaudeConfigService')

const DESCRIPTION_MAX_LENGTH = 200
const DEBOUNCE_MS = 1000

/** Get subdirectories of a given path. */
function getSubdirectories(dirPath: string): string[] {
  return readdirSync(dirPath).filter(name => {
    const fullPath = join(dirPath, name)
    return statSync(fullPath).isDirectory()
  })
}

/** Built-in agent display names. */
const BUILT_IN_NAMES: Record<string, string> = {
  explore: 'Explorer',
  plan: 'Planner',
  review: 'Reviewer',
  implement: 'Implementer',
  test: 'Tester',
  debug: 'Debugger',
  document: 'Documenter',
  simplify: 'Simplifier'
}

/**
 * Service for reading Claude Code configuration and plugins.
 *
 * Discovers installed plugins from ~/.claude/plugins/cache/ and extracts
 * agent and skill definitions that can be used as subagent types in workflows.
 */
export class ClaudeConfigService {
  private claudeDir: string
  private watcher: chokidar.FSWatcher | null = null
  private mainWindow: BrowserWindow | null = null
  private cachedScanResult: ClaudeConfigScanResult | null = null
  private settings: ClaudeConfigSettings = DEFAULT_CLAUDE_CONFIG_SETTINGS
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir || join(homedir(), '.claude')
  }

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  isClaudeCodeInstalled(): boolean {
    return existsSync(this.claudeDir)
  }

  private getPluginsCachePath(): string {
    return join(this.claudeDir, 'plugins', 'cache')
  }

  private createScanResult(
    isInstalled: boolean,
    plugins: PluginInfo[] = [],
    importedTypes: ImportedSubagentType[] = [],
    errors: ScanError[] = []
  ): ClaudeConfigScanResult {
    const result: ClaudeConfigScanResult = {
      isInstalled,
      plugins,
      importedTypes,
      conflicts: isInstalled ? this.detectConflicts(importedTypes) : [],
      errors,
      lastScanned: new Date().toISOString()
    }
    this.cachedScanResult = result
    return result
  }

  /**
   * Scan Claude Code configuration and discover plugins.
   */
  scanConfigs(): ClaudeConfigScanResult {
    if (!this.isClaudeCodeInstalled()) {
      return this.createScanResult(false)
    }

    const cachePath = this.getPluginsCachePath()
    if (!existsSync(cachePath)) {
      log.debug('Plugins cache directory does not exist:', cachePath)
      return this.createScanResult(true)
    }

    const errors: ScanError[] = []
    const plugins: PluginInfo[] = []
    const importedTypes: ImportedSubagentType[] = []

    // Scan marketplace directories
    try {
      for (const marketplace of getSubdirectories(cachePath)) {
        const marketplacePath = join(cachePath, marketplace)
        this.scanMarketplace(marketplacePath, marketplace, plugins, importedTypes, errors)
      }
    } catch (error) {
      log.error('Failed to scan plugins cache:', error)
      errors.push(this.createScanError('read', cachePath, error))
    }

    return this.createScanResult(true, plugins, importedTypes, errors)
  }

  private createScanError(type: ScanError['type'], path: string, error: unknown): ScanError {
    const message = error instanceof Error ? error.message : String(error)
    return { type, path, message }
  }

  private scanMarketplace(
    marketplacePath: string,
    marketplace: string,
    plugins: PluginInfo[],
    importedTypes: ImportedSubagentType[],
    errors: ScanError[]
  ): void {
    try {
      for (const pluginName of getSubdirectories(marketplacePath)) {
        const pluginPath = join(marketplacePath, pluginName)
        this.scanPlugin(pluginPath, pluginName, marketplace, plugins, importedTypes, errors)
      }
    } catch (error) {
      log.error(`Failed to scan marketplace ${marketplace}:`, error)
      errors.push(this.createScanError('read', marketplacePath, error))
    }
  }

  private scanPlugin(
    pluginPath: string,
    pluginName: string,
    marketplace: string,
    plugins: PluginInfo[],
    importedTypes: ImportedSubagentType[],
    errors: ScanError[]
  ): void {
    try {
      // Get latest version directory (sorted descending)
      const versions = getSubdirectories(pluginPath)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))

      if (versions.length === 0) return

      const versionPath = join(pluginPath, versions[0])
      this.scanPluginVersion(versionPath, pluginName, versions[0], marketplace, plugins, importedTypes, errors)
    } catch (error) {
      log.error(`Failed to scan plugin ${pluginName}:`, error)
      errors.push(this.createScanError('read', pluginPath, error))
    }
  }

  private scanPluginVersion(
    versionPath: string,
    pluginName: string,
    version: string,
    marketplace: string,
    plugins: PluginInfo[],
    importedTypes: ImportedSubagentType[],
    errors: ScanError[]
  ): void {
    const pluginJsonPath = join(versionPath, '.claude-plugin', 'plugin.json')

    // Try to read plugin.json
    let manifest: PluginManifest | null = null
    if (existsSync(pluginJsonPath)) {
      try {
        const content = readFileSync(pluginJsonPath, 'utf-8')
        manifest = JSON.parse(content) as PluginManifest
      } catch (error) {
        log.warn(`Failed to parse plugin.json for ${pluginName}:`, error)
        errors.push(this.createScanError('parse', pluginJsonPath, error))
      }
    }

    const pluginInfo: PluginInfo = {
      id: `${marketplace}/${pluginName}`,
      name: manifest?.name || pluginName,
      version: version,
      description: manifest?.description,
      marketplace,
      cachePath: versionPath,
      agentCount: 0,
      skillCount: 0
    }

    // Scan agents directory (at root of version path, not inside .claude-plugin)
    const agentsDir = join(versionPath, 'agents')
    if (existsSync(agentsDir)) {
      const agents = this.scanAgentsDirectory(agentsDir, pluginInfo, errors)
      importedTypes.push(...agents)
      pluginInfo.agentCount = agents.length
    }

    // Scan skills directory (at root of version path, not inside .claude-plugin)
    const skillsDir = join(versionPath, 'skills')
    if (existsSync(skillsDir)) {
      const skills = this.scanSkillsDirectory(skillsDir, pluginInfo, errors)
      importedTypes.push(...skills)
      pluginInfo.skillCount = skills.length
    }

    // Only add plugin if it has any agents or skills
    if (pluginInfo.agentCount > 0 || pluginInfo.skillCount > 0) {
      plugins.push(pluginInfo)
    }
  }

  private scanAgentsDirectory(
    agentsDir: string,
    pluginInfo: PluginInfo,
    errors: ScanError[]
  ): ImportedSubagentType[] {
    const agents: ImportedSubagentType[] = []

    try {
      const mdFiles = readdirSync(agentsDir).filter(f => f.endsWith('.md'))

      for (const file of mdFiles) {
        const filePath = join(agentsDir, file)
        try {
          const content = readFileSync(filePath, 'utf-8')
          const { frontmatter, body } = this.parseMarkdownFrontmatter<AgentFrontmatter>(content)
          const agentName = frontmatter?.name || basename(file, '.md')

          agents.push({
            id: `imported:${pluginInfo.id}:${this.slugify(agentName)}`,
            name: agentName,
            description: frontmatter?.description || this.extractFirstParagraph(body),
            source: {
              type: 'plugin-agent',
              pluginId: pluginInfo.id,
              pluginName: pluginInfo.name,
              pluginVersion: pluginInfo.version,
              marketplace: pluginInfo.marketplace
            },
            filePath,
            promptContent: body
          })
        } catch (error) {
          log.warn(`Failed to parse agent file ${file}:`, error)
          errors.push(this.createScanError('parse', filePath, error))
        }
      }
    } catch (error) {
      log.error(`Failed to scan agents directory:`, error)
      errors.push(this.createScanError('read', agentsDir, error))
    }

    return agents
  }

  private scanSkillsDirectory(
    skillsDir: string,
    pluginInfo: PluginInfo,
    errors: ScanError[]
  ): ImportedSubagentType[] {
    const skills: ImportedSubagentType[] = []

    try {
      for (const skillName of getSubdirectories(skillsDir)) {
        const skillMdPath = join(skillsDir, skillName, 'SKILL.md')
        if (!existsSync(skillMdPath)) continue

        try {
          const content = readFileSync(skillMdPath, 'utf-8')
          const { frontmatter, body } = this.parseMarkdownFrontmatter<SkillFrontmatter>(content)

          skills.push({
            id: `imported:${pluginInfo.id}:skill:${this.slugify(skillName)}`,
            name: frontmatter?.name || skillName,
            description: frontmatter?.description || this.extractFirstParagraph(body),
            source: {
              type: 'plugin-skill',
              pluginId: pluginInfo.id,
              pluginName: pluginInfo.name,
              pluginVersion: pluginInfo.version,
              marketplace: pluginInfo.marketplace
            },
            filePath: skillMdPath,
            promptContent: body
          })
        } catch (error) {
          log.warn(`Failed to parse skill ${skillName}:`, error)
          errors.push(this.createScanError('parse', skillMdPath, error))
        }
      }
    } catch (error) {
      log.error(`Failed to scan skills directory:`, error)
      errors.push(this.createScanError('read', skillsDir, error))
    }

    return skills
  }

  private parseMarkdownFrontmatter<T>(content: string): { frontmatter: T | null; body: string } {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
    const match = content.match(frontmatterRegex)

    if (!match) {
      return { frontmatter: null, body: content }
    }

    const yamlContent = match[1]
    const body = content.slice(match[0].length)

    // Simple YAML parsing for basic key-value pairs
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

  /**
   * Detect conflicts between imported agents and built-in agents.
   */
  detectConflicts(importedTypes: ImportedSubagentType[]): AgentConflict[] {
    const conflicts: AgentConflict[] = []

    for (const imported of importedTypes) {
      // Check if the base name conflicts with a built-in
      const baseName = imported.name.toLowerCase()

      for (const builtInId of BUILT_IN_AGENT_IDS) {
        // Check for exact name match or exact ID segment match
        // Use word boundaries to avoid partial matches (e.g., "test" shouldn't match "test-plugin")
        const idRegex = new RegExp(`:${builtInId}(?:$|:)`)
        if (baseName === builtInId || idRegex.test(imported.id)) {
          conflicts.push({
            importedId: imported.id,
            builtInId,
            importedName: imported.name,
            builtInName: this.getBuiltInName(builtInId),
            resolution: 'rename',
            resolvedId: `${imported.id}-imported`
          })
          break
        }
      }
    }

    return conflicts
  }

  private getBuiltInName(id: string): string {
    return BUILT_IN_NAMES[id] || id
  }

  getScanResult(): ClaudeConfigScanResult {
    if (!this.cachedScanResult) {
      return this.scanConfigs()
    }
    return this.cachedScanResult
  }

  refresh(): ClaudeConfigScanResult {
    const result = this.scanConfigs()

    // Notify the renderer if window is available
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('claudeConfig:updated', result)
    }

    return result
  }

  getSettings(): ClaudeConfigSettings {
    return { ...this.settings }
  }

  updateSettings(updates: Partial<ClaudeConfigSettings>): ClaudeConfigSettings {
    this.settings = { ...this.settings, ...updates }
    return this.settings
  }

  getEnabledImports(): ImportedSubagentType[] {
    if (!this.settings.enabled) {
      return []
    }

    const { importedTypes } = this.getScanResult()
    const { enabledPlugins, disabledAgentIds } = this.settings

    return importedTypes.filter(imported => {
      const pluginEnabled = enabledPlugins.length === 0 || enabledPlugins.includes(imported.source.pluginId)
      const agentEnabled = !disabledAgentIds.includes(imported.id)
      return pluginEnabled && agentEnabled
    })
  }

  startWatching(): void {
    if (this.watcher) {
      return // Already watching
    }

    if (!this.isClaudeCodeInstalled()) {
      log.debug('Claude Code not installed, skipping watch')
      return
    }

    const cachePath = this.getPluginsCachePath()
    if (!existsSync(cachePath)) {
      log.debug('Plugins cache does not exist, skipping watch')
      return
    }

    log.info('Starting to watch Claude config:', cachePath)

    this.watcher = chokidar.watch(cachePath, {
      persistent: true,
      ignoreInitial: true,
      depth: 5, // Go deep enough to catch plugin changes
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })

    const handleChange = (event: string) => (path: string) => {
      log.debug(`File ${event} in plugins cache:`, path)
      this.handleConfigChange()
    }

    this.watcher
      .on('add', handleChange('added'))
      .on('change', handleChange('changed'))
      .on('unlink', handleChange('removed'))
      .on('error', (error) => log.error('Watcher error:', error))
  }

  private handleConfigChange(): void {
    // Debounce rapid changes
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
    }

    this.refreshTimeout = setTimeout(() => {
      this.refresh()
    }, DEBOUNCE_MS)
  }

  stopWatching(): void {
    if (this.watcher) {
      log.info('Stopping Claude config watcher')
      this.watcher.close()
      this.watcher = null
    }

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
      this.refreshTimeout = null
    }
  }

  cleanup(): void {
    this.stopWatching()
    this.cachedScanResult = null
  }
}
