/**
 * Type definitions for Claude Code config import feature.
 *
 * This module defines types for importing Claude Code plugins from ~/.claude/
 * as workflow subagent types in the Agent Framework GUI.
 */

/**
 * Represents an imported subagent type from a Claude Code plugin.
 * These are discovered from plugin.json files in ~/.claude/plugins/cache/
 */
export interface ImportedSubagentType {
  id: string              // Unique ID (e.g., 'imported:plugin-name:agent-name')
  name: string            // Human-readable display name
  description: string     // Description of what the agent does
  source: ImportSource    // Where this agent type came from
  filePath?: string       // Path to the source file (agent .md or skill SKILL.md)
  promptContent?: string  // The actual prompt/instructions content
}

/**
 * Source information for an imported subagent type.
 */
export interface ImportSource {
  type: 'plugin-agent' | 'plugin-skill'
  pluginId: string        // Plugin identifier
  pluginName: string      // Human-readable plugin name
  pluginVersion: string   // Semantic version
  marketplace?: string    // Marketplace source (e.g., 'anthropic', 'community')
}

/**
 * Conflict information when an imported agent ID collides with a built-in.
 */
export interface AgentConflict {
  importedId: string      // The conflicting imported ID
  builtInId: string       // The built-in ID it conflicts with
  importedName: string    // Name of the imported agent
  builtInName: string     // Name of the built-in agent
  resolution: 'skip' | 'rename'  // How the conflict was resolved
  resolvedId?: string     // New ID after rename (if renamed)
}

/**
 * Result of scanning Claude Code configuration.
 */
export interface ClaudeConfigScanResult {
  isInstalled: boolean                  // Whether ~/.claude/ exists
  plugins: PluginInfo[]                 // Discovered plugins
  importedTypes: ImportedSubagentType[] // All discovered agent/skill types
  conflicts: AgentConflict[]            // Any conflicts with built-ins
  errors: ScanError[]                   // Any errors during scanning
  lastScanned: string                   // ISO timestamp of last scan
}

/**
 * Information about a discovered Claude Code plugin.
 */
export interface PluginInfo {
  id: string              // Plugin identifier
  name: string            // Plugin display name
  version: string         // Semantic version
  description?: string    // Plugin description
  marketplace?: string    // Marketplace source
  cachePath: string       // Full path to plugin cache directory
  agentCount: number      // Number of agents discovered
  skillCount: number      // Number of skills discovered
}

/**
 * Error encountered during scanning.
 */
export interface ScanError {
  type: 'parse' | 'read' | 'permission' | 'unknown'
  path: string            // Path where error occurred
  message: string         // Error description
}

/**
 * User settings for Claude Code config import.
 */
export interface ClaudeConfigSettings {
  enabled: boolean                      // Master toggle for imports
  enabledPlugins: string[]              // List of enabled plugin IDs
  disabledAgentIds: string[]            // Specific agent IDs to skip
  autoRefresh: boolean                  // Watch for config changes
  refreshIntervalMs: number             // Polling interval if watching
}

/**
 * Default settings for Claude Code config import.
 */
export const DEFAULT_CLAUDE_CONFIG_SETTINGS: ClaudeConfigSettings = {
  enabled: true,
  enabledPlugins: [],    // Empty means all plugins enabled
  disabledAgentIds: [],
  autoRefresh: true,
  refreshIntervalMs: 30000  // 30 seconds
}

/**
 * Plugin metadata from plugin.json file.
 */
export interface PluginManifest {
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  repository?: string
  agents?: string[]       // Paths to agent .md files
  skills?: string[]       // Paths to skill directories
}

/**
 * Agent frontmatter parsed from agent .md files.
 */
export interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  tools?: string[]
  [key: string]: unknown  // Allow additional fields
}

/**
 * Skill metadata parsed from SKILL.md files.
 */
export interface SkillFrontmatter {
  name?: string
  description?: string
  triggers?: string[]
  [key: string]: unknown  // Allow additional fields
}

/**
 * Built-in agent IDs that should be checked for conflicts.
 */
export const BUILT_IN_AGENT_IDS = [
  'explore',
  'plan',
  'review',
  'implement',
  'test',
  'debug',
  'document',
  'simplify'
] as const

export type BuiltInAgentId = typeof BUILT_IN_AGENT_IDS[number]

/**
 * Check if an ID conflicts with a built-in agent ID.
 */
export function isBuiltInAgentId(id: string): id is BuiltInAgentId {
  return BUILT_IN_AGENT_IDS.includes(id as BuiltInAgentId)
}
