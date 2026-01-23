import { ScanError } from './ClaudeConfigTypes'
export type { SkillsLibrarySettings } from '../../../shared/types/settings'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'

export type SkillSourceType = 'claude-plugin' | 'vercel-skill' | 'project-skill'

export interface SkillSource {
  type: SkillSourceType
  name: string
  path: string
}

export interface SkillScript {
  name: string
  filename: string
  path: string
  content: string
  description?: string
}

export interface SkillReference {
  name: string
  path: string
  content: string
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  source: SkillSource
  filePath: string
  promptContent: string
  scripts: SkillScript[]
  references: SkillReference[]
  overrides?: string
}

export interface SkillMdFrontmatter {
  name?: string
  description?: string
  triggers?: string[]
  model?: string
  tools?: string[]
  [key: string]: unknown
}

export interface SkillsLibraryScanResult {
  vercelSkills: SkillDefinition[]
  projectSkills: SkillDefinition[]
  errors: ScanError[]
  lastScanned: string
}

export interface UnifiedSkill {
  id: string
  name: string
  description: string
  sourceType: SkillSourceType
  sourceName: string
  filePath: string
  promptContent: string
  scripts: SkillScript[]
  references: SkillReference[]
  overrides?: string
  isOverridden?: boolean
  overriddenBy?: string
  enabled: boolean
}

export interface SkillsBySource {
  claudePlugins: UnifiedSkill[]
  vercelSkills: UnifiedSkill[]
  projectSkills: UnifiedSkill[]
}

export interface SkillOverride {
  overridingSkillId: string
  overriddenSkillId: string
  overridingName: string
  overriddenName: string
}

export interface UnifiedSkillsScanResult {
  skills: UnifiedSkill[]
  skillsBySource: SkillsBySource
  overrides: SkillOverride[]
  errors: ScanError[]
  lastScanned: string
}

export const DEFAULT_SKILLS_LIBRARY_SETTINGS = DEFAULT_SETTINGS.skillsLibrary
