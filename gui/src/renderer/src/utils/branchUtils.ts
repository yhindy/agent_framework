// Extract descriptive part from format: feature/project-id/branch-name -> branch-name
export function extractBranchName(branch?: string): string | null {
  if (!branch) return null

  const parts = branch.split('/')
  if (parts.length >= 3) {
    // Return everything after feature/project-id/
    return parts.slice(2).join('/') // Handles nested paths
  }

  // Fallback: return full branch if format doesn't match
  return branch
}
