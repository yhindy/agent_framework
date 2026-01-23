import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import { ClaudeConfigService } from './ClaudeConfigService'
import { SkillsLibraryService } from './SkillsLibraryService'
import { ImportedSubagentType, ScanError } from './types/ClaudeConfigTypes'
import {
  UnifiedSkill, SkillsBySource, UnifiedSkillsScanResult, SkillOverride,
  SkillDefinition, SkillSourceType
} from './types/SkillsLibraryTypes'
import { SubagentType } from './types/WorkflowTypes'

const log = createLogger('UnifiedSkillsService')
const PRIORITY: Record<SkillSourceType, number> = { 'project-skill': 0, 'vercel-skill': 1, 'claude-plugin': 2 }

export class UnifiedSkillsService {
  private mainWindow: BrowserWindow | null = null
  private cachedResult: UnifiedSkillsScanResult | null = null

  constructor(private claudeConfig: ClaudeConfigService, private skillsLib: SkillsLibraryService) {}

  setWindow(w: BrowserWindow) { this.mainWindow = w; this.claudeConfig.setWindow(w); this.skillsLib.setWindow(w) }
  setProjectPath(p: string | null) { this.skillsLib.setProjectPath(p); this.cachedResult = null }
  getScanResult(p?: string) { return this.cachedResult || this.scan(p) }

  scan(projectPath?: string): UnifiedSkillsScanResult {
    const errors: ScanError[] = []
    const libResult = this.skillsLib.getScanResult(projectPath)
    errors.push(...libResult.errors)

    const allSkills: UnifiedSkill[] = [
      ...this.getClaudePluginSkills(),
      ...this.toUnified(libResult.vercelSkills, 'vercel-skill'),
      ...this.toUnified(libResult.projectSkills, 'project-skill')
    ]

    const { skills, overrides } = this.resolveOverrides(allSkills)
    const skillsBySource = this.groupBySource(skills)

    return this.cachedResult = { skills, skillsBySource, overrides, errors, lastScanned: new Date().toISOString() }
  }

  private getClaudePluginSkills(): UnifiedSkill[] {
    const { disabledAgentIds } = this.claudeConfig.getSettings()
    return this.claudeConfig.getEnabledImports().map(i => ({
      id: i.id, name: i.name, description: i.description, sourceType: 'claude-plugin' as const,
      sourceName: i.source.pluginName, filePath: i.filePath || '', promptContent: i.promptContent || '',
      scripts: [], references: [], enabled: !disabledAgentIds.includes(i.id)
    }))
  }

  private toUnified(skills: SkillDefinition[], sourceType: SkillSourceType): UnifiedSkill[] {
    const { disabledSkillIds } = this.skillsLib.getSettings()
    return skills.map(s => ({
      id: s.id, name: s.name, description: s.description, sourceType, sourceName: s.source.name,
      filePath: s.filePath, promptContent: s.promptContent, scripts: s.scripts, references: s.references,
      enabled: !disabledSkillIds.includes(s.id)
    }))
  }

  private resolveOverrides(skills: UnifiedSkill[]): { skills: UnifiedSkill[]; overrides: SkillOverride[] } {
    const overrides: SkillOverride[] = []
    const byName = new Map<string, UnifiedSkill[]>()
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    for (const s of skills) {
      const key = norm(s.name)
      byName.set(key, [...(byName.get(key) || []), s])
    }

    const resolved = [...byName.values()].flatMap(group => {
      if (group.length === 1) return group
      const sorted = [...group].sort((a, b) => PRIORITY[a.sourceType] - PRIORITY[b.sourceType])
      const [winner, ...losers] = sorted

      for (const loser of losers) {
        overrides.push({ overridingSkillId: winner.id, overriddenSkillId: loser.id, overridingName: winner.name, overriddenName: loser.name })
      }

      return [
        { ...winner, overrides: losers[0]?.id },
        ...losers.map(l => ({ ...l, isOverridden: true, overriddenBy: winner.id }))
      ]
    })

    return { skills: resolved, overrides }
  }

  private groupBySource(skills: UnifiedSkill[]): SkillsBySource {
    return {
      claudePlugins: skills.filter(s => s.sourceType === 'claude-plugin'),
      vercelSkills: skills.filter(s => s.sourceType === 'vercel-skill'),
      projectSkills: skills.filter(s => s.sourceType === 'project-skill')
    }
  }

  refresh(projectPath?: string): UnifiedSkillsScanResult {
    this.claudeConfig.refresh(); this.skillsLib.refresh(projectPath)
    const result = this.scan(projectPath)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('unifiedSkills:updated', result)
    }
    return result
  }

  getEnabledSkills(p?: string) { return this.getScanResult(p).skills.filter(s => s.enabled && !s.isOverridden) }
  getEnabledSkillsAsSubagentTypes(p?: string): SubagentType[] {
    return this.getEnabledSkills(p).map(({ id, name, description }) => ({ id, name, description }))
  }
  getSkillById(id: string, p?: string) { return this.getScanResult(p).skills.find(s => s.id === id) }

  setSkillEnabled(skillId: string, enabled: boolean) {
    const toggle = (ids: string[]) => enabled ? ids.filter(id => id !== skillId) : [...ids, skillId]

    if (skillId.startsWith('vercel:') || skillId.startsWith('project:')) {
      const s = this.skillsLib.getSettings()
      this.skillsLib.updateSettings({ disabledSkillIds: toggle(s.disabledSkillIds) })
    } else if (skillId.startsWith('imported:')) {
      const s = this.claudeConfig.getSettings()
      this.claudeConfig.updateSettings({ disabledAgentIds: toggle(s.disabledAgentIds) })
    } else {
      log.warn(`Unknown skill ID format: ${skillId}`)
    }
    this.cachedResult = null
  }

  startWatching() { this.claudeConfig.startWatching(); this.skillsLib.startWatching() }
  stopWatching() { this.claudeConfig.stopWatching(); this.skillsLib.stopWatching() }
  cleanup() { this.stopWatching(); this.cachedResult = null; this.claudeConfig.cleanup(); this.skillsLib.cleanup() }
}
