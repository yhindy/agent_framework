/**
 * Type definitions for the Skills Library feature.
 *
 * This module defines types for managing skills from multiple sources:
 * - Vercel skills (~/.claude/skills/)
 * - Project-local skills ({project}/.claude/skills/)
 * - Claude Code plugins (via ClaudeConfigService)
 */

import { ScanError } from './ClaudeConfigTypes'

/**
 * Source types for skills.
 */
export type SkillSourceType =
  | 'claude-plugin'   // From ~/.claude/plugins/cache/
  | 'vercel-skill'    // From ~/.claude/skills/
  | 'project-skill'   // From {project}/.claude/skills/

/**
 * Source information for a skill.
 */
export interface SkillSource {
  type: SkillSourceType
  name: string              // Source name (e.g., "vercel-labs/agent-skills", "my-project")
  path: string              // Base path of the source
}

/**
 * A script bundled with a skill (Vercel-style).
 */
export interface SkillScript {
  name: string              // Script name without extension
  filename: string          // Full filename (e.g., "deploy.sh")
  path: string              // Full path to the script
  content: string           // Script content (passed as context to agent)
  description?: string      // Optional description from comment
}

/**
 * A reference file bundled with a skill.
 */
export interface SkillReference {
  name: string              // Filename
  path: string              // Full path
  content: string           // File content
}

/**
 * Complete skill definition from any source.
 */
export interface SkillDefinition {
  id: string                // Unique ID (e.g., 'vercel:deploy', 'project:my-skill')
  name: string              // Human-readable name
  description: string       // Skill description
  source: SkillSource       // Where this skill came from
  filePath: string          // Path to the SKILL.md file
  promptContent: string     // Main prompt/instruction content
  scripts: SkillScript[]    // Bundled scripts
  references: SkillReference[] // Additional reference files
  overrides?: string        // ID of skill this overrides (for project skills)
}

/**
 * Frontmatter parsed from SKILL.md files.
 */
export interface SkillMdFrontmatter {
  name?: string
  description?: string
  triggers?: string[]       // Keywords that activate this skill
  model?: string            // Preferred model
  tools?: string[]          // Required tools
  [key: string]: unknown    // Allow additional fields
}

/**
 * Result of scanning the skills library.
 */
export interface SkillsLibraryScanResult {
  vercelSkills: SkillDefinition[]     // From ~/.claude/skills/
  projectSkills: SkillDefinition[]    // From project/.claude/skills/
  errors: ScanError[]                 // Any errors during scanning
  lastScanned: string                 // ISO timestamp
}

// Re-export SkillsLibrarySettings from shared types
export type { SkillsLibrarySettings } from '../../../shared/types/settings'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'

/**
 * Default settings for Skills Library.
 */
export const DEFAULT_SKILLS_LIBRARY_SETTINGS = DEFAULT_SETTINGS.skillsLibrary

/**
 * Unified skill representation for the UI and WorkflowService.
 * Combines skills from all sources into a consistent format.
 */
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
  overrides?: string              // ID of skill this overrides
  isOverridden?: boolean          // True if another skill overrides this one
  overriddenBy?: string           // ID of skill that overrides this one
  enabled: boolean                // Based on settings
}

/**
 * Grouped skills by source type for UI display.
 */
export interface SkillsBySource {
  claudePlugins: UnifiedSkill[]
  vercelSkills: UnifiedSkill[]
  projectSkills: UnifiedSkill[]
}

/**
 * Complete scan result combining all sources.
 */
export interface UnifiedSkillsScanResult {
  skills: UnifiedSkill[]
  skillsBySource: SkillsBySource
  overrides: SkillOverride[]      // List of override relationships
  errors: ScanError[]
  lastScanned: string
}

/**
 * Represents an override relationship between skills.
 */
export interface SkillOverride {
  overridingSkillId: string       // The project skill that overrides
  overriddenSkillId: string       // The global skill being overridden
  overridingName: string
  overriddenName: string
}
