/**
 * Check if a project is a git repository based on its stored state.
 * Defaults to true when the project is not found or the field is not set,
 * preserving backward compatibility with projects added before isGitRepo tracking.
 *
 * @param activeProjects - List of active project states
 * @param projectPath - Path to look up, or null/undefined if unknown
 * @returns true if the project is a git repo or if the status is unknown
 */
export function isProjectGitRepo(activeProjects: Array<{ path: string; isGitRepo?: boolean }>, projectPath: string | null | undefined): boolean {
  if (!projectPath) return true
  const project = activeProjects.find(p => p.path === projectPath)
  return project?.isGitRepo !== false
}
