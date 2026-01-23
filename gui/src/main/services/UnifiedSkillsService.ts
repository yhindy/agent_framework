import { BrowserWindow } from 'electron'
import { createLogger } from './logger'
import { ClaudeConfigService } from './ClaudeConfigService'
import { SkillsLibraryService } from './SkillsLibraryService'
import { ScanError } from './types/ClaudeConfigTypes'
import { UnifiedItem, ItemsBySource, UnifiedScanResult, ItemDefinition, SourceType } from './types/SkillsLibraryTypes'
import { SubagentType } from './types/WorkflowTypes'

const log = createLogger('UnifiedSkillsService')
const PRIORITY: Record<string, number> = { 'project-command': 0, 'project-agent': 1, 'command': 2, 'agent': 3, 'plugin': 4 }

export class UnifiedSkillsService {
  private mainWindow: BrowserWindow | null = null
  private cachedResult: UnifiedScanResult | null = null

  constructor(private claudeConfig: ClaudeConfigService, private skillsLib: SkillsLibraryService) {}

  setWindow(w: BrowserWindow) { this.mainWindow = w; this.claudeConfig.setWindow(w); this.skillsLib.setWindow(w) }
  setProjectPath(p: string | null) { this.skillsLib.setProjectPath(p); this.cachedResult = null }
  getScanResult(p?: string) { return this.cachedResult || this.scan(p) }

  scan(projectPath?: string): UnifiedScanResult {
    const errors: ScanError[] = []
    const libResult = this.skillsLib.getScanResult(projectPath)
    errors.push(...libResult.errors)

    const toUnified = (items: ItemDefinition[], type: string): UnifiedItem[] => {
      const { disabledSkillIds } = this.skillsLib.getSettings()
      return items.map(i => ({ ...i, enabled: !disabledSkillIds.includes(i.id) }))
    }

    const allItems: UnifiedItem[] = [
      ...toUnified(libResult.commands, 'command'),
      ...toUnified(libResult.agents, 'agent'),
      ...toUnified(libResult.projectCommands, 'project-command'),
      ...toUnified(libResult.projectAgents, 'project-agent'),
      ...this.getPluginItems()
    ]

    const { items, overrides } = this.resolveOverrides(allItems)
    const itemsBySource = this.groupBySource(items)

    return this.cachedResult = { items, itemsBySource, overrides, errors, lastScanned: new Date().toISOString() }
  }

  private getPluginItems(): UnifiedItem[] {
    const { disabledAgentIds } = this.claudeConfig.getSettings()
    return this.claudeConfig.getEnabledImports().map(i => ({
      id: i.id, name: i.name, description: i.description,
      source: { type: 'plugin' as SourceType, scope: 'global' as const, path: i.filePath || '' },
      filePath: i.filePath || '', promptContent: i.promptContent || '',
      enabled: !disabledAgentIds.includes(i.id)
    }))
  }

  private resolveOverrides(items: UnifiedItem[]): { items: UnifiedItem[]; overrides: { overridingId: string; overriddenId: string }[] } {
    const overrides: { overridingId: string; overriddenId: string }[] = []
    const byName = new Map<string, UnifiedItem[]>()
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    for (const i of items) byName.set(norm(i.name), [...(byName.get(norm(i.name)) || []), i])

    const resolved = [...byName.values()].flatMap(group => {
      if (group.length === 1) return group
      const sorted = [...group].sort((a, b) => (PRIORITY[a.id.split(':')[0]] ?? 9) - (PRIORITY[b.id.split(':')[0]] ?? 9))
      const [winner, ...losers] = sorted

      for (const loser of losers) overrides.push({ overridingId: winner.id, overriddenId: loser.id })

      return [
        { ...winner, overrides: losers[0]?.id },
        ...losers.map(l => ({ ...l, isOverridden: true, overriddenBy: winner.id }))
      ]
    })

    return { items: resolved, overrides }
  }

  private groupBySource(items: UnifiedItem[]): ItemsBySource {
    return {
      commands: items.filter(i => i.id.startsWith('command:')),
      agents: items.filter(i => i.id.startsWith('agent:')),
      plugins: items.filter(i => i.id.startsWith('imported:')),
      projectCommands: items.filter(i => i.id.startsWith('project-command:')),
      projectAgents: items.filter(i => i.id.startsWith('project-agent:'))
    }
  }

  refresh(projectPath?: string): UnifiedScanResult {
    this.claudeConfig.refresh(); this.skillsLib.refresh(projectPath)
    const result = this.scan(projectPath)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('unifiedSkills:updated', result)
    }
    return result
  }

  getEnabledItems(p?: string) { return this.getScanResult(p).items.filter(i => i.enabled && !i.isOverridden) }
  getEnabledAsSubagentTypes(p?: string): SubagentType[] {
    return this.getEnabledItems(p).map(({ id, name, description }) => ({ id, name, description }))
  }
  getItemById(id: string, p?: string) { return this.getScanResult(p).items.find(i => i.id === id) }

  setItemEnabled(id: string, enabled: boolean) {
    const toggle = (ids: string[]) => enabled ? ids.filter(i => i !== id) : [...ids, id]

    if (id.startsWith('imported:')) {
      const s = this.claudeConfig.getSettings()
      this.claudeConfig.updateSettings({ disabledAgentIds: toggle(s.disabledAgentIds) })
    } else {
      const s = this.skillsLib.getSettings()
      this.skillsLib.updateSettings({ disabledSkillIds: toggle(s.disabledSkillIds) })
    }
    this.cachedResult = null
  }

  startWatching() { this.claudeConfig.startWatching(); this.skillsLib.startWatching() }
  stopWatching() { this.claudeConfig.stopWatching(); this.skillsLib.stopWatching() }
  cleanup() { this.stopWatching(); this.cachedResult = null; this.claudeConfig.cleanup(); this.skillsLib.cleanup() }
}
