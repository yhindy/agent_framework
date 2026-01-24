// Extract descriptive part from branch name
// Handles various formats:
// - Simple branch: "my-feature" -> "my-feature"
// - Prefixed: "fix/auth-bug" -> "auth-bug"
// - Legacy feature format: "feature/project-id/branch-name" -> "branch-name"
// - Agent handoff format: "agent-id/branch-name" -> "branch-name"
export function extractBranchName(branch?: string): string | null {
  if (!branch) return null

  const parts = branch.split('/')

  // Simple branch name with no slashes
  if (parts.length === 1) {
    return branch
  }

  // Two-part format: prefix/branch-name -> branch-name
  if (parts.length === 2) {
    return parts[1] || branch
  }

  // Three+ parts: return last segment(s) after the first two
  // e.g., "feature/project-id/branch-name" -> "branch-name"
  // e.g., "agent-id/ui/button-fix" -> "ui/button-fix"
  return parts.slice(2).join('/')
}
