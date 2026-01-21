// Extract descriptive part from branch name
// Handles both new format (feature/branch-name) and legacy format (feature/project-id/branch-name)
export function extractBranchName(branch?: string): string | null {
  if (!branch) return null

  const parts = branch.split('/')

  // New format: feature/branch-name -> branch-name
  if (parts.length === 2 && parts[0] === 'feature') {
    return parts[1]
  }

  // Legacy format: feature/project-id/branch-name -> branch-name
  if (parts.length >= 3 && parts[0] === 'feature') {
    return parts.slice(2).join('/') // Handles nested paths
  }

  // Fallback: return full branch if format doesn't match
  return branch
}
