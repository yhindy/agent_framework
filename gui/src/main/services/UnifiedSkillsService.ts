/**
 * Service that unifies skills from all sources into a single API.
 *
 * Combines:
 * - Claude Code plugins (via ClaudeConfigService)
 * - Vercel skills (via SkillsLibraryService)
 * - Project-local skills (via SkillsLibraryService)
 *
 * Handles override resolution: project skills override global skills with the same name.
 */

import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import { ClaudeConfigService } from './ClaudeConfigService'
import { SkillsLibraryService } from './SkillsLibraryService'
import { ImportedSubagentType } from './types/ClaudeConfigTypes'
import {
  UnifiedSkill,
  SkillsBySource,
  UnifiedSkillsScanResult,
  SkillOverride,
  SkillDefinition,
  SkillSourceType
} from './types/SkillsLibraryTypes'
import { ScanError } from './types/ClaudeConfigTypes'
import { SubagentType } from './types/WorkflowTypes'

const log = createLogger('UnifiedSkillsService')

/**
 * Unified service for managing skills from all sources.
 */
export class UnifiedSkillsService {
  private mainWindow: BrowserWindow | null = null
  private cachedResult: UnifiedSkillsScanResult | null = null

  constructor(
    private claudeConfigService: ClaudeConfigService,
    private skillsLibraryService: SkillsLibraryService
  ) {}

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
    this.claudeConfigService.setWindow(window)
    this.skillsLibraryService.setWindow(window)
  }

  setProjectPath(projectPath: string | null): void {
    this.skillsLibraryService.setProjectPath(projectPath)
    // Clear cache when project changes
    this.cachedResult = null
  }

  /**
   * Scan all sources and return unified skills.
   */
  scan(projectPath?: string): UnifiedSkillsScanResult {
    const errors: ScanError[] = []
    const allSkills: UnifiedSkill[] = []

    // Get Claude Code plugin imports
    const claudePluginSkills = this.getClaudePluginSkills()
    allSkills.push(...claudePluginSkills)

    // Get Vercel and project skills
    const libraryResult = this.skillsLibraryService.getScanResult(projectPath)
    errors.push(...libraryResult.errors)

    const vercelSkills = this.convertToUnifiedSkills(
      libraryResult.vercelSkills,
      'vercel-skill'
    )
    allSkills.push(...vercelSkills)

    const projectSkills = this.convertToUnifiedSkills(
      libraryResult.projectSkills,
      'project-skill'
    )
    allSkills.push(...projectSkills)

    // Resolve overrides (project skills override global skills)
    const { skills: resolvedSkills, overrides } = this.resolveOverrides(allSkills)

    // Group by source for UI
    const skillsBySource = this.groupBySource(resolvedSkills)

    const result: UnifiedSkillsScanResult = {
      skills: resolvedSkills,
      skillsBySource,
      overrides,
      errors,
      lastScanned: new Date().toISOString()
    }

    this.cachedResult = result
    return result
  }

  /**
   * Convert Claude plugin imports to unified skills.
   */
  private getClaudePluginSkills(): UnifiedSkill[] {
    const imports = this.claudeConfigService.getEnabledImports()
    const settings = this.claudeConfigService.getSettings()

    return imports.map(imported => this.importedToUnified(imported, settings.disabledAgentIds))
  }

  /**
   * Convert an ImportedSubagentType to UnifiedSkill.
   */
  private importedToUnified(
    imported: ImportedSubagentType,
    disabledIds: string[]
  ): UnifiedSkill {
    return {
      id: imported.id,
      name: imported.name,
      description: imported.description,
      sourceType: 'claude-plugin',
      sourceName: imported.source.pluginName,
      filePath: imported.filePath || '',
      promptContent: imported.promptContent || '',
      scripts: [],
      references: [],
      enabled: !disabledIds.includes(imported.id)
    }
  }

  /**
   * Convert SkillDefinition array to UnifiedSkill array.
   */
  private convertToUnifiedSkills(
    skills: SkillDefinition[],
    sourceType: SkillSourceType
  ): UnifiedSkill[] {
    const librarySettings = this.skillsLibraryService.getSettings()

    return skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceType,
      sourceName: skill.source.name,
      filePath: skill.filePath,
      promptContent: skill.promptContent,
      scripts: skill.scripts,
      references: skill.references,
      enabled: !librarySettings.disabledSkillIds.includes(skill.id)
    }))
  }

  /**
   * Resolve override relationships.
   * Project skills override global skills with the same name.
   */
  private resolveOverrides(
    skills: UnifiedSkill[]
  ): { skills: UnifiedSkill[]; overrides: SkillOverride[] } {
    const overrides: SkillOverride[] = []
    const skillsByName = new Map<string, UnifiedSkill[]>()

    // Group skills by normalized name
    for (const skill of skills) {
      const normalizedName = this.normalizeName(skill.name)
      const existing = skillsByName.get(normalizedName) || []
      existing.push(skill)
      skillsByName.set(normalizedName, existing)
    }

    // Process each group to determine overrides
    const resolvedSkills: UnifiedSkill[] = []

    for (const [, group] of skillsByName) {
      if (group.length === 1) {
        resolvedSkills.push(group[0])
        continue
      }

      // Multiple skills with same name - determine override order
      // Priority: project-skill > vercel-skill > claude-plugin
      const sorted = [...group].sort((a, b) => {
        const priority = { 'project-skill': 0, 'vercel-skill': 1, 'claude-plugin': 2 }
        return priority[a.sourceType] - priority[b.sourceType]
      })

      const winner = sorted[0]
      const losers = sorted.slice(1)

      // Mark winner
      resolvedSkills.push({
        ...winner,
        overrides: losers.length > 0 ? losers[0].id : undefined
      })

      // Mark losers as overridden
      for (const loser of losers) {
        resolvedSkills.push({
          ...loser,
          isOverridden: true,
          overriddenBy: winner.id
        })

        overrides.push({
          overridingSkillId: winner.id,
          overriddenSkillId: loser.id,
          overridingName: winner.name,
          overriddenName: loser.name
        })
      }
    }

    return { skills: resolvedSkills, overrides }
  }

  /**
   * Normalize a skill name for comparison.
   */
  private normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  }

  /**
   * Group skills by source type.
   */
  private groupBySource(skills: UnifiedSkill[]): SkillsBySource {
    return {
      claudePlugins: skills.filter(s => s.sourceType === 'claude-plugin'),
      vercelSkills: skills.filter(s => s.sourceType === 'vercel-skill'),
      projectSkills: skills.filter(s => s.sourceType === 'project-skill')
    }
  }

  /**
   * Get cached result or perform new scan.
   */
  getScanResult(projectPath?: string): UnifiedSkillsScanResult {
    if (!this.cachedResult) {
      return this.scan(projectPath)
    }
    return this.cachedResult
  }

  /**
   * Force refresh from all sources.
   */
  refresh(projectPath?: string): UnifiedSkillsScanResult {
    // Refresh underlying services
    this.claudeConfigService.refresh()
    this.skillsLibraryService.refresh(projectPath)

    // Scan unified result
    const result = this.scan(projectPath)

    // Notify renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('unifiedSkills:updated', result)
    }

    return result
  }

  /**
   * Get all enabled skills (not overridden, enabled in settings).
   */
  getEnabledSkills(projectPath?: string): UnifiedSkill[] {
    const { skills } = this.getScanResult(projectPath)
    return skills.filter(skill => skill.enabled && !skill.isOverridden)
  }

  /**
   * Convert enabled skills to SubagentType array for WorkflowService.
   */
  getEnabledSkillsAsSubagentTypes(projectPath?: string): SubagentType[] {
    const enabledSkills = this.getEnabledSkills(projectPath)

    return enabledSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description
    }))
  }

  /**
   * Get a specific skill by ID.
   */
  getSkillById(skillId: string, projectPath?: string): UnifiedSkill | undefined {
    const { skills } = this.getScanResult(projectPath)
    return skills.find(s => s.id === skillId)
  }

  /**
   * Enable or disable a specific skill.
   */
  setSkillEnabled(skillId: string, enabled: boolean): void {
    // Determine which service owns this skill
    if (skillId.startsWith('vercel:') || skillId.startsWith('project:')) {
      const settings = this.skillsLibraryService.getSettings()
      const disabledIds = new Set(settings.disabledSkillIds)

      if (enabled) {
        disabledIds.delete(skillId)
      } else {
        disabledIds.add(skillId)
      }

      this.skillsLibraryService.updateSettings({
        disabledSkillIds: Array.from(disabledIds)
      })
    } else if (skillId.startsWith('imported:')) {
      const settings = this.claudeConfigService.getSettings()
      const disabledIds = new Set(settings.disabledAgentIds)

      if (enabled) {
        disabledIds.delete(skillId)
      } else {
        disabledIds.add(skillId)
      }

      this.claudeConfigService.updateSettings({
        disabledAgentIds: Array.from(disabledIds)
      })
    } else {
      log.warn(`Unknown skill ID format: ${skillId}`)
    }

    // Clear cache to reflect changes
    this.cachedResult = null
  }

  /**
   * Start watching all skill sources for changes.
   */
  startWatching(): void {
    this.claudeConfigService.startWatching()
    this.skillsLibraryService.startWatching()
  }

  /**
   * Stop watching all skill sources.
   */
  stopWatching(): void {
    this.claudeConfigService.stopWatching()
    this.skillsLibraryService.stopWatching()
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    this.stopWatching()
    this.cachedResult = null
    this.claudeConfigService.cleanup()
    this.skillsLibraryService.cleanup()
  }
}
