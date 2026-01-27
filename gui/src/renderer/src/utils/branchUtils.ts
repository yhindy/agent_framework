// Centralized branch name utilities
// All branch-related logic lives here for consistency

// Reserved branch names that conflict with special agents or git references
export const RESERVED_BRANCH_NAMES = ['base', 'main', 'master', 'origin', 'head']

/**
 * Extract the last segment of a branch name.
 * e.g., "fix/auth-bug" -> "auth-bug"
 * e.g., "my-feature" -> "my-feature"
 */
export function extractBranchSuffix(branch: string): string {
  return branch.split('/').pop() || branch
}

/**
 * Extract descriptive part from branch name for display.
 * Handles various formats:
 * - Simple: "my-feature" -> "my-feature"
 * - Prefixed: "fix/auth-bug" -> "auth-bug"
 * - Legacy: "feature/project-id/branch-name" -> "branch-name"
 * - Handoff: "agent-id/ui/button-fix" -> "ui/button-fix"
 */
export function extractBranchName(branch?: string): string | null {
  if (!branch) return null

  const parts = branch.split('/')

  if (parts.length === 1) return branch
  if (parts.length === 2) return parts[1] || branch

  // 3+ parts: return everything after first two segments
  return parts.slice(2).join('/')
}

/**
 * Sanitize a string for use in branch names.
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters (keeps alphanumeric, hyphens, underscores)
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 */
export function sanitizeBranchName(name: string): string {
  if (!name) return ''

  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Validate a branch name against reserved names.
 * Returns error message if invalid, null if valid.
 */
export function validateBranchName(name: string): string | null {
  const suffix = extractBranchSuffix(name).toLowerCase()
  if (RESERVED_BRANCH_NAMES.includes(suffix)) {
    return `"${name}" is reserved. Reserved names: ${RESERVED_BRANCH_NAMES.join(', ')}`
  }
  return null
}

/**
 * Build a handoff branch name from agent ID and suffix.
 */
export function buildHandoffBranch(agentId: string, suffix: string): string {
  return `${agentId}/${suffix}`
}
