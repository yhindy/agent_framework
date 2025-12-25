#!/usr/bin/env node

/**
 * CLI interface for file copying functionality
 * Usage: npx ts-node cli-copy-files.ts <configPath> <repoRoot> <worktreePath>
 *
 * Environment variables:
 * - VERBOSE: Set to "1" or "true" for detailed logging
 */

import * as fs from 'fs'
import * as path from 'path'
import { copyFiles, validateFilesToCopy } from './fileCopy'

interface Config {
  setup?: {
    filesToCopy?: unknown
  }
}

function logInfo(message: string): void {
  console.log(`ℹ  ${message}`)
}

function logSuccess(message: string): void {
  console.log(`✓ ${message}`)
}

function logWarn(message: string): void {
  console.log(`⚠  ${message}`)
}

function logError(message: string): void {
  console.error(`✗ ${message}`)
}

function isVerbose(): boolean {
  return process.env.VERBOSE === '1' || process.env.VERBOSE === 'true'
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 3) {
    logError('Usage: cli-copy-files.ts <configPath> <repoRoot> <worktreePath>')
    process.exit(1)
  }

  const [configPath, repoRoot, worktreePath] = args

  try {
    // Validate paths exist
    if (!fs.existsSync(configPath)) {
      logError(`Config file not found: ${configPath}`)
      process.exit(1)
    }

    if (!fs.existsSync(repoRoot)) {
      logError(`Repository root not found: ${repoRoot}`)
      process.exit(1)
    }

    if (!fs.existsSync(worktreePath)) {
      logError(`Worktree path not found: ${worktreePath}`)
      process.exit(1)
    }

    // Load config
    let config: Config
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8')
      config = JSON.parse(configContent)
    } catch (error) {
      logError(`Failed to parse config file: ${configPath}`)
      if (error instanceof Error) {
        logError(error.message)
      }
      process.exit(1)
    }

    // Get filesToCopy from config
    const filesToCopy = config.setup?.filesToCopy
    if (!filesToCopy) {
      logInfo('No files to copy (filesToCopy is empty or not defined)')
      process.exit(0)
    }

    // Validate filesToCopy format
    try {
      validateFilesToCopy(filesToCopy)
    } catch (error) {
      logError('Invalid filesToCopy configuration')
      if (error instanceof Error) {
        logError(error.message)
      }
      process.exit(1)
    }

    // Copy files
    logInfo(`Copying files from ${repoRoot} to ${worktreePath}`)
    const result = copyFiles(filesToCopy as string[], repoRoot, worktreePath)

    // Log results
    if (result.copied.length > 0) {
      logSuccess(`Copied ${result.copied.length} file(s)`)
      if (isVerbose()) {
        result.copied.forEach(({ source, destination }) => {
          if (source === destination) {
            logInfo(`  ${source}`)
          } else {
            logInfo(`  ${source} → ${destination}`)
          }
        })
      }
    }

    if (result.skipped.length > 0) {
      logWarn(`Skipped ${result.skipped.length} file(s)`)
      if (isVerbose()) {
        result.skipped.forEach(({ source, reason }) => {
          logWarn(`  ${source}: ${reason}`)
        })
      }
    }

    if (result.errors.length > 0) {
      logError(`Failed to copy ${result.errors.length} file(s)`)
      result.errors.forEach(({ source, error }) => {
        logError(`  ${source}: ${error}`)
      })
    }

    // Exit with appropriate code
    if (result.success) {
      process.exit(0)
    } else {
      process.exit(1)
    }
  } catch (error) {
    logError('Unexpected error during file copying')
    if (error instanceof Error) {
      logError(error.message)
      if (isVerbose()) {
        logError(error.stack || '')
      }
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
