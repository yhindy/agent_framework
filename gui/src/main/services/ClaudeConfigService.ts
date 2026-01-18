import { homedir } from 'os'
import { join, basename } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import {
  ImportedSubagentType,
  ImportSource,
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

  /**
   * Set the main window for sending IPC events.
   */
  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Check if Claude Code is installed (i.e., ~/.claude/ exists).
   */
  isClaudeCodeInstalled(): boolean {
    return existsSync(this.claudeDir)
  }

  /**
   * Get the path to the plugins cache directory.
   */
  private getPluginsCachePath(): string {
    return join(this.claudeDir, 'plugins', 'cache')
  }

  /**
   * Scan Claude Code configuration and discover plugins.
   */
  scanConfigs(): ClaudeConfigScanResult {
    const errors: ScanError[] = []
    const plugins: PluginInfo[] = []
    const importedTypes: ImportedSubagentType[] = []

    if (!this.isClaudeCodeInstalled()) {
      const result: ClaudeConfigScanResult = {
        isInstalled: false,
        plugins: [],
        importedTypes: [],
        conflicts: [],
        errors: [],
        lastScanned: new Date().toISOString()
      }
      this.cachedScanResult = result
      return result
    }

    const cachePath = this.getPluginsCachePath()
    if (!existsSync(cachePath)) {
      log.debug('Plugins cache directory does not exist:', cachePath)
      const result: ClaudeConfigScanResult = {
        isInstalled: true,
        plugins: [],
        importedTypes: [],
        conflicts: [],
        errors: [],
        lastScanned: new Date().toISOString()
      }
      this.cachedScanResult = result
      return result
    }

    // Scan marketplace directories
    try {
      const marketplaces = readdirSync(cachePath)
        .filter(name => {
          const path = join(cachePath, name)
          return statSync(path).isDirectory()
        })

      for (const marketplace of marketplaces) {
        const marketplacePath = join(cachePath, marketplace)
        this.scanMarketplace(marketplacePath, marketplace, plugins, importedTypes, errors)
      }
    } catch (error) {
      log.error('Failed to scan plugins cache:', error)
      errors.push({
        type: 'read',
        path: cachePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }

    // Detect conflicts with built-in agents
    const conflicts = this.detectConflicts(importedTypes)

    const result: ClaudeConfigScanResult = {
      isInstalled: true,
      plugins,
      importedTypes,
      conflicts,
      errors,
      lastScanned: new Date().toISOString()
    }

    this.cachedScanResult = result
    return result
  }

  /**
   * Scan a marketplace directory for plugins.
   */
  private scanMarketplace(
    marketplacePath: string,
    marketplace: string,
    plugins: PluginInfo[],
    importedTypes: ImportedSubagentType[],
    errors: ScanError[]
  ): void {
    try {
      const pluginNames = readdirSync(marketplacePath)
        .filter(name => {
          const path = join(marketplacePath, name)
          return statSync(path).isDirectory()
        })

      for (const pluginName of pluginNames) {
        const pluginPath = join(marketplacePath, pluginName)
        this.scanPlugin(pluginPath, pluginName, marketplace, plugins, importedTypes, errors)
      }
    } catch (error) {
      log.error(`Failed to scan marketplace ${marketplace}:`, error)
      errors.push({
        type: 'read',
        path: marketplacePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Scan a plugin directory (may have multiple versions).
   */
  private scanPlugin(
    pluginPath: string,
    pluginName: string,
    marketplace: string,
    plugins: PluginInfo[],
    importedTypes: ImportedSubagentType[],
    errors: ScanError[]
  ): void {
    try {
      // Get all version directories
      const versions = readdirSync(pluginPath)
        .filter(name => {
          const path = join(pluginPath, name)
          return statSync(path).isDirectory()
        })
        .sort((a, b) => {
          // Sort versions descending (latest first)
          return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
        })

      // Use the latest version
      if (versions.length === 0) {
        return
      }

      const latestVersion = versions[0]
      const versionPath = join(pluginPath, latestVersion)
      this.scanPluginVersion(versionPath, pluginName, latestVersion, marketplace, plugins, importedTypes, errors)
    } catch (error) {
      log.error(`Failed to scan plugin ${pluginName}:`, error)
      errors.push({
        type: 'read',
        path: pluginPath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Scan a specific plugin version for agents and skills.
   */
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
        errors.push({
          type: 'parse',
          path: pluginJsonPath,
          message: error instanceof Error ? error.message : String(error)
        })
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

  /**
   * Scan an agents directory for agent .md files.
   */
  private scanAgentsDirectory(
    agentsDir: string,
    pluginInfo: PluginInfo,
    errors: ScanError[]
  ): ImportedSubagentType[] {
    const agents: ImportedSubagentType[] = []

    try {
      const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'))

      for (const file of files) {
        const filePath = join(agentsDir, file)
        try {
          const content = readFileSync(filePath, 'utf-8')
          const { frontmatter, body } = this.parseMarkdownFrontmatter<AgentFrontmatter>(content)

          const agentName = frontmatter?.name || basename(file, '.md')
          const agentId = `imported:${pluginInfo.id}:${this.slugify(agentName)}`

          const source: ImportSource = {
            type: 'plugin-agent',
            pluginId: pluginInfo.id,
            pluginName: pluginInfo.name,
            pluginVersion: pluginInfo.version,
            marketplace: pluginInfo.marketplace
          }

          agents.push({
            id: agentId,
            name: agentName,
            description: frontmatter?.description || this.extractFirstParagraph(body),
            source,
            filePath,
            promptContent: body
          })
        } catch (error) {
          log.warn(`Failed to parse agent file ${file}:`, error)
          errors.push({
            type: 'parse',
            path: filePath,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      log.error(`Failed to scan agents directory:`, error)
      errors.push({
        type: 'read',
        path: agentsDir,
        message: error instanceof Error ? error.message : String(error)
      })
    }

    return agents
  }

  /**
   * Scan a skills directory for SKILL.md files.
   */
  private scanSkillsDirectory(
    skillsDir: string,
    pluginInfo: PluginInfo,
    errors: ScanError[]
  ): ImportedSubagentType[] {
    const skills: ImportedSubagentType[] = []

    try {
      const dirs = readdirSync(skillsDir).filter(name => {
        const path = join(skillsDir, name)
        return statSync(path).isDirectory()
      })

      for (const skillName of dirs) {
        const skillPath = join(skillsDir, skillName)
        const skillMdPath = join(skillPath, 'SKILL.md')

        if (!existsSync(skillMdPath)) {
          continue
        }

        try {
          const content = readFileSync(skillMdPath, 'utf-8')
          const { frontmatter, body } = this.parseMarkdownFrontmatter<SkillFrontmatter>(content)

          const displayName = frontmatter?.name || skillName
          const skillId = `imported:${pluginInfo.id}:skill:${this.slugify(skillName)}`

          const source: ImportSource = {
            type: 'plugin-skill',
            pluginId: pluginInfo.id,
            pluginName: pluginInfo.name,
            pluginVersion: pluginInfo.version,
            marketplace: pluginInfo.marketplace
          }

          skills.push({
            id: skillId,
            name: displayName,
            description: frontmatter?.description || this.extractFirstParagraph(body),
            source,
            filePath: skillMdPath,
            promptContent: body
          })
        } catch (error) {
          log.warn(`Failed to parse skill ${skillName}:`, error)
          errors.push({
            type: 'parse',
            path: skillMdPath,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      log.error(`Failed to scan skills directory:`, error)
      errors.push({
        type: 'read',
        path: skillsDir,
        message: error instanceof Error ? error.message : String(error)
      })
    }

    return skills
  }

  /**
   * Parse YAML frontmatter from a markdown file.
   */
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
        let value: unknown = trimmed.slice(colonIndex + 1).trim()

        // Handle quoted strings
        if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
          value = (value as string).slice(1, -1)
        } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
          value = (value as string).slice(1, -1)
        }
        // Handle arrays (simple format: [item1, item2])
        else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
          value = (value as string)
            .slice(1, -1)
            .split(',')
            .map(v => v.trim().replace(/^["']|["']$/g, ''))
        }
        // Handle booleans
        else if (value === 'true') {
          value = true
        } else if (value === 'false') {
          value = false
        }
        // Handle numbers
        else if (!isNaN(Number(value)) && (value as string) !== '') {
          value = Number(value)
        }

        frontmatter[key] = value
      }

      return { frontmatter: frontmatter as T, body }
    } catch {
      return { frontmatter: null, body: content }
    }
  }

  /**
   * Extract the first paragraph from markdown content as a description.
   */
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

    // Limit to ~200 characters
    if (paragraph.length > 200) {
      return paragraph.slice(0, 197) + '...'
    }

    return paragraph || 'No description available'
  }

  /**
   * Convert a name to a URL-safe slug.
   */
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

  /**
   * Get the display name for a built-in agent ID.
   */
  private getBuiltInName(id: string): string {
    const names: Record<string, string> = {
      explore: 'Explorer',
      plan: 'Planner',
      review: 'Reviewer',
      implement: 'Implementer',
      test: 'Tester',
      debug: 'Debugger',
      document: 'Documenter',
      simplify: 'Simplifier'
    }
    return names[id] || id
  }

  /**
   * Get the cached scan result, or scan if not cached.
   */
  getScanResult(): ClaudeConfigScanResult {
    if (!this.cachedScanResult) {
      return this.scanConfigs()
    }
    return this.cachedScanResult
  }

  /**
   * Force a refresh of the scan.
   */
  refresh(): ClaudeConfigScanResult {
    const result = this.scanConfigs()

    // Notify the renderer if window is available
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('claudeConfig:updated', result)
    }

    return result
  }

  /**
   * Get current settings.
   */
  getSettings(): ClaudeConfigSettings {
    return { ...this.settings }
  }

  /**
   * Update settings.
   */
  updateSettings(updates: Partial<ClaudeConfigSettings>): ClaudeConfigSettings {
    this.settings = { ...this.settings, ...updates }
    return this.settings
  }

  /**
   * Get enabled imported types based on current settings.
   */
  getEnabledImports(): ImportedSubagentType[] {
    if (!this.settings.enabled) {
      return []
    }

    const result = this.getScanResult()

    return result.importedTypes.filter(imported => {
      // Check if plugin is enabled (empty list means all enabled)
      if (this.settings.enabledPlugins.length > 0) {
        if (!this.settings.enabledPlugins.includes(imported.source.pluginId)) {
          return false
        }
      }

      // Check if this specific agent is disabled
      if (this.settings.disabledAgentIds.includes(imported.id)) {
        return false
      }

      return true
    })
  }

  /**
   * Start watching for config changes.
   */
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

    this.watcher.on('add', (path) => {
      log.debug('File added in plugins cache:', path)
      this.handleConfigChange()
    })

    this.watcher.on('change', (path) => {
      log.debug('File changed in plugins cache:', path)
      this.handleConfigChange()
    })

    this.watcher.on('unlink', (path) => {
      log.debug('File removed from plugins cache:', path)
      this.handleConfigChange()
    })

    this.watcher.on('error', (error) => {
      log.error('Watcher error:', error)
    })
  }

  /**
   * Handle a config change by refreshing and notifying.
   */
  private handleConfigChange(): void {
    // Debounce rapid changes
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
    }

    this.refreshTimeout = setTimeout(() => {
      this.refresh()
    }, 1000)
  }

  /**
   * Stop watching for config changes.
   */
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

  /**
   * Clean up resources on app shutdown.
   */
  cleanup(): void {
    this.stopWatching()
    this.cachedScanResult = null
  }
}
