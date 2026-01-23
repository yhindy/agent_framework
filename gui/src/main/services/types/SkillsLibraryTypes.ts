import { ScanError } from './ClaudeConfigTypes'
export type { SkillsLibrarySettings } from '../../../shared/types/settings'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'

export type SourceType = 'command' | 'agent' | 'plugin'
export type Scope = 'global' | 'project'

export interface ItemSource { type: SourceType; scope: Scope; path: string }

export interface ItemDefinition {
  id: string; name: string; description: string; source: ItemSource
  filePath: string; promptContent: string
  model?: string; color?: string
}

export interface UnifiedItem extends ItemDefinition {
  enabled: boolean
  overrides?: string; isOverridden?: boolean; overriddenBy?: string
}

export interface ItemsBySource {
  commands: UnifiedItem[]; agents: UnifiedItem[]; plugins: UnifiedItem[]
  projectCommands: UnifiedItem[]; projectAgents: UnifiedItem[]
}

export interface LibraryScanResult {
  commands: ItemDefinition[]; agents: ItemDefinition[]
  projectCommands: ItemDefinition[]; projectAgents: ItemDefinition[]
  errors: ScanError[]; lastScanned: string
}

export interface UnifiedScanResult {
  items: UnifiedItem[]; itemsBySource: ItemsBySource
  overrides: { overridingId: string; overriddenId: string }[]
  errors: ScanError[]; lastScanned: string
}

export const DEFAULT_SKILLS_LIBRARY_SETTINGS = DEFAULT_SETTINGS.skillsLibrary
