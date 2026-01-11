/**
 * Default configuration for agent creation
 *
 * Model selection: Using opus for all agents by default for maximum intelligence.
 * Can be overridden per-agent if needed.
 */

export const DEFAULT_MODEL = 'opus'

/**
 * Hierarchy level constants
 * Lower number = higher in hierarchy
 */
export const HIERARCHY_LEVELS = {
  DIRECTOR: 0,    // Strategic decisions, delegates everything
  MANAGER: 1,     // Coordinates teams, approves work
  LEAD: 2,        // Technical leadership, reviews architecture
  SENIOR: 3,      // Experienced engineer, mentors others
  ENGINEER: 4,    // Standard implementation work
  REVIEWER: 5,    // Read-only analysis, code review
} as const

export type HierarchyLevel = typeof HIERARCHY_LEVELS[keyof typeof HIERARCHY_LEVELS]

/**
 * Get human-readable name for hierarchy level
 */
export function getHierarchyLevelName(level: number): string {
  const names: Record<number, string> = {
    0: 'Director',
    1: 'Manager',
    2: 'Lead',
    3: 'Senior Engineer',
    4: 'Engineer',
    5: 'Reviewer',
  }
  return names[level] ?? `Level ${level}`
}

/**
 * Default agent configuration
 */
export const AGENT_DEFAULTS = {
  model: DEFAULT_MODEL,
  tool: 'claude',
  mode: 'auto' as const,
  hierarchyLevel: HIERARCHY_LEVELS.ENGINEER,  // Default to engineer level
  chrome: true,
  yolo: false,
}
