import * as fs from 'fs'
import * as path from 'path'

export interface FileCopyResult {
  success: boolean
  copied: Array<{ source: string; destination: string }>
  skipped: Array<{ source: string; reason: string }>
  errors: Array<{ source: string; error: string }>
}

/**
 * Parse filesToCopy configuration entries
 * Supports two formats:
 * - Simple string: "backend/.env" (source and destination are the same)
 * - Colon-separated: "src/config.json:app/config.json" (different source and destination)
 */
export function parseFileCopyEntry(entry: string): { source: string; destination: string } {
  if (typeof entry !== 'string') {
    throw new Error(`Invalid file copy entry: must be a string, got ${typeof entry}`)
  }

  if (entry.includes(':')) {
    const [source, destination] = entry.split(':', 2)
    if (!source || !destination) {
      throw new Error(`Invalid file copy entry: "${entry}" - both source and destination required`)
    }
    return { source, destination }
  }

  return { source: entry, destination: entry }
}

/**
 * Copy files from source to destination based on configuration
 * @param filesToCopy Array of file paths (can be "path" or "src:dest")
 * @param repoRoot Root directory of the repository
 * @param worktreePath Path to the worktree where files will be copied
 * @returns Result object with copied, skipped, and errored files
 */
export function copyFiles(
  filesToCopy: string[],
  repoRoot: string,
  worktreePath: string
): FileCopyResult {
  const result: FileCopyResult = {
    success: true,
    copied: [],
    skipped: [],
    errors: [],
  }

  if (!Array.isArray(filesToCopy)) {
    result.success = false
    result.errors.push({
      source: 'filesToCopy',
      error: 'filesToCopy must be an array',
    })
    return result
  }

  for (const entry of filesToCopy) {
    try {
      const { source, destination } = parseFileCopyEntry(entry)

      const sourcePath = path.join(repoRoot, source)
      const destPath = path.join(worktreePath, destination)

      // Check if source file exists
      if (!fs.existsSync(sourcePath)) {
        result.skipped.push({
          source,
          reason: `File not found at ${sourcePath}`,
        })
        continue
      }

      // Check if source is a file (not a directory)
      if (!fs.statSync(sourcePath).isFile()) {
        result.skipped.push({
          source,
          reason: 'Source is not a file (is a directory or special file)',
        })
        continue
      }

      // Create destination directory
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }

      // Copy the file
      fs.copyFileSync(sourcePath, destPath)
      result.copied.push({ source, destination })
    } catch (error) {
      result.success = false
      result.errors.push({
        source: entry,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

/**
 * Validate filesToCopy configuration
 */
export function validateFilesToCopy(filesToCopy: unknown): string[] {
  if (!Array.isArray(filesToCopy)) {
    throw new Error('filesToCopy must be an array')
  }

  for (const entry of filesToCopy) {
    if (typeof entry !== 'string') {
      throw new Error(`Each entry in filesToCopy must be a string, got ${typeof entry}`)
    }

    // Validate format
    if (entry.includes(':')) {
      const parts = entry.split(':')
      if (parts.length !== 2) {
        throw new Error(`Invalid format: "${entry}" - use "source:destination" format`)
      }
      if (!parts[0].trim() || !parts[1].trim()) {
        throw new Error(`Invalid format: "${entry}" - both source and destination required`)
      }
    }

    // Basic path validation
    if (!entry.trim()) {
      throw new Error('File path cannot be empty')
    }
  }

  return filesToCopy
}
