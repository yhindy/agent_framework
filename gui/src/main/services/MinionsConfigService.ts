import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, cpSync } from 'fs'
import { rm } from 'fs/promises'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import type { MinionsConfig } from './types/MinionsConfig'

// Re-export MinionsConfig for consumers of this module
export type { MinionsConfig } from './types/MinionsConfig'

/**
 * Legacy config format (v1.0) from minions/config.json
 */
interface LegacyConfig {
  project: {
    name: string
    defaultBaseBranch: string
  }
  setup: {
    filesToCopy: Array<string | { source: string; destination?: string }>
    postSetupCommands: string[]
    requiredFiles?: string[]
    preflightCommands?: string[]
  }
  assignments?: unknown[]
  testEnvironments?: unknown[]
}

/**
 * Service for managing minions.json configuration files
 *
 * Handles:
 * - Reading/writing the new minions.json format
 * - Migration from legacy minions/config.json
 * - Project type detection
 * - .minions/ folder initialization
 * - .gitignore updates
 */
export class MinionsConfigService {
  /**
   * Read config from minions.json
   * @param projectPath - Path to the project root
   * @returns MinionsConfig or null if not found/invalid
   */
  readConfig(projectPath: string): MinionsConfig | null {
    const configPath = join(projectPath, 'minions.json')

    if (!existsSync(configPath)) {
      return null
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      return JSON.parse(content) as MinionsConfig
    } catch (error) {
      console.error('[MinionsConfigService] Failed to read config:', error)
      return null
    }
  }

  /**
   * Write config to minions.json
   * @param projectPath - Path to the project root
   * @param config - Configuration to write
   */
  writeConfig(projectPath: string, config: MinionsConfig): void {
    const configPath = join(projectPath, 'minions.json')
    writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  /**
   * Check if minions.json exists
   * @param projectPath - Path to the project root
   * @returns true if minions.json exists
   */
  hasConfig(projectPath: string): boolean {
    return existsSync(join(projectPath, 'minions.json'))
  }

  /**
   * Check if legacy minions/config.json exists
   * @param projectPath - Path to the project root
   * @returns true if legacy config exists
   */
  hasLegacyConfig(projectPath: string): boolean {
    return existsSync(join(projectPath, 'minions', 'config.json'))
  }

  /**
   * Migrate from legacy config.json to minions.json
   * Implements atomic migration with backup and rollback
   *
   * @param projectPath - Path to the project root
   * @returns The migrated MinionsConfig
   * @throws Error if migration fails (with automatic rollback)
   */
  async migrateFromLegacy(projectPath: string): Promise<MinionsConfig> {
    const backupDir = join(projectPath, '.minions-migration-backup')
    const stateFile = join(projectPath, '.minions-migration-state.json')
    const legacyConfigPath = join(projectPath, 'minions', 'config.json')
    const newConfigPath = join(projectPath, 'minions.json')

    try {
      // Step 1: Create backup
      await this.createMigrationBackup(projectPath, backupDir, legacyConfigPath)

      // Step 2: Write migration state file
      writeFileSync(stateFile, JSON.stringify({ step: 'started', timestamp: Date.now() }))

      // Step 3: Read and transform legacy config
      const legacyContent = readFileSync(legacyConfigPath, 'utf-8')
      const legacyConfig: LegacyConfig = JSON.parse(legacyContent)

      const newConfig: MinionsConfig = {
        version: '2.0',
        project: {
          name: legacyConfig.project.name,
          defaultBaseBranch: legacyConfig.project.defaultBaseBranch,
        },
        setup: {
          filesToCopy: this.transformFilesToCopy(legacyConfig.setup.filesToCopy || []),
          postSetupCommands: legacyConfig.setup.postSetupCommands || [],
          preflightCommands: legacyConfig.setup.preflightCommands,
          requiredFiles: legacyConfig.setup.requiredFiles,
        },
      }

      // Step 4: Initialize .minions folder
      this.initializeMinionsFolder(projectPath)

      // Step 5: Write new config
      this.writeConfig(projectPath, newConfig)

      // Step 6: Migrate agent info files
      await this.migrateAgentInfoFiles(projectPath)

      // Step 7: Update .gitignore
      this.updateGitignore(projectPath)

      // Step 8: Update state
      writeFileSync(stateFile, JSON.stringify({ step: 'completed', timestamp: Date.now() }))

      // Step 9: Cleanup backup and state file on success
      await rm(backupDir, { recursive: true, force: true })
      await rm(stateFile, { force: true })

      return newConfig
    } catch (error) {
      // Rollback on failure
      await this.rollbackMigration(projectPath, backupDir, newConfigPath)
      throw error
    }
  }

  /**
   * Get default config with auto-detected project info
   * @param projectPath - Path to the project root
   * @returns Default MinionsConfig with detected settings
   */
  getDefaultConfig(projectPath: string): MinionsConfig {
    const projectName = basename(projectPath)
    const defaultBranch = this.detectDefaultBranch(projectPath)
    const detected = this.detectProjectType(projectPath)

    const project: import('./types/MinionsConfig').MinionsConfigProject = {
      name: projectName,
    }
    if (defaultBranch !== undefined) {
      project.defaultBaseBranch = defaultBranch
    }

    const config: MinionsConfig = {
      version: '2.0',
      project,
      setup: {
        filesToCopy: [],
        postSetupCommands: [],
        buildCommand: detected.buildCommand,
        testCommand: detected.testCommand,
        lintCommand: detected.lintCommand,
      },
    }

    if (detected.language) {
      config.detected = {
        language: detected.language,
        framework: detected.framework,
        packageManager: detected.packageManager,
        detectedAt: new Date().toISOString(),
      }
    }

    return config
  }

  /**
   * Initialize .minions/ folder structure
   * @param projectPath - Path to the project root
   */
  initializeMinionsFolder(projectPath: string): void {
    const minionsDir = join(projectPath, '.minions')
    const agentsDir = join(minionsDir, 'agents')
    const cacheDir = join(minionsDir, 'cache')
    const archiveDir = join(minionsDir, 'archive')

    mkdirSync(minionsDir, { recursive: true })
    mkdirSync(agentsDir, { recursive: true })
    mkdirSync(cacheDir, { recursive: true })
    mkdirSync(archiveDir, { recursive: true })
  }

  /**
   * Update .gitignore to include .minions/
   * @param projectPath - Path to the project root
   */
  updateGitignore(projectPath: string): void {
    // Skip for non-git projects
    if (!existsSync(join(projectPath, '.git'))) {
      return
    }

    const gitignorePath = join(projectPath, '.gitignore')
    const minionsEntry = '.minions/'
    const sectionComment = '# Minions (AI Agent Framework)'

    let content = ''
    let exists = false

    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf-8')
      exists = true

      // Check if .minions/ is already in .gitignore
      if (content.includes(minionsEntry)) {
        return // Already present, nothing to do
      }
    }

    // Add the minions section
    const addition = `\n${sectionComment}\n${minionsEntry}\n`
    const newContent = exists ? content + addition : `${sectionComment}\n${minionsEntry}\n`

    writeFileSync(gitignorePath, newContent)
  }

  // --- Private helper methods ---

  /**
   * Transform legacy filesToCopy format to new simplified string array
   */
  private transformFilesToCopy(
    legacyFiles: Array<string | { source: string; destination?: string }>
  ): string[] {
    return legacyFiles.map((f) => (typeof f === 'string' ? f : f.source))
  }

  /**
   * Create backup of files before migration
   */
  private async createMigrationBackup(
    projectPath: string,
    backupDir: string,
    legacyConfigPath: string
  ): Promise<void> {
    mkdirSync(backupDir, { recursive: true })

    // Backup legacy config
    if (existsSync(legacyConfigPath)) {
      cpSync(legacyConfigPath, join(backupDir, 'config.json'))
    }

    // Backup existing base info file
    const baseInfoPath = join(projectPath, '.minions-base-info')
    if (existsSync(baseInfoPath)) {
      cpSync(baseInfoPath, join(backupDir, '.minions-base-info'))
    }
  }

  /**
   * Rollback migration on failure
   */
  private async rollbackMigration(
    projectPath: string,
    _backupDir: string, // Available for future restoration logic
    newConfigPath: string
  ): Promise<void> {
    console.error('[MinionsConfigService] Rolling back migration due to failure')

    // Remove partially created files
    if (existsSync(newConfigPath)) {
      unlinkSync(newConfigPath)
    }

    const newMinionsDir = join(projectPath, '.minions')
    if (existsSync(newMinionsDir)) {
      await rm(newMinionsDir, { recursive: true, force: true })
    }

    // Note: We don't restore backups since original files are NOT deleted
    // during migration until success
  }

  /**
   * Migrate agent info files from legacy locations
   */
  private async migrateAgentInfoFiles(projectPath: string): Promise<void> {
    const minionsDir = join(projectPath, '.minions')
    const agentsDir = join(minionsDir, 'agents')

    mkdirSync(agentsDir, { recursive: true })

    // Migrate base agent info
    const baseInfoPath = join(projectPath, '.minions-base-info')
    if (existsSync(baseInfoPath)) {
      const content = readFileSync(baseInfoPath, 'utf-8')
      writeFileSync(join(minionsDir, 'base-agent.json'), content)
      unlinkSync(baseInfoPath)
    }

    // Note: Worktree agent info files will be migrated by AgentService
    // when it encounters them, since we don't have worktree listing here
  }

  /**
   * Detect the default git branch (main or master)
   */
  private detectDefaultBranch(projectPath: string): string | undefined {
    // Non-git projects don't have a default branch
    if (!existsSync(join(projectPath, '.git'))) {
      return undefined
    }

    try {
      const result = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s@^refs/remotes/origin/@@"', {
        cwd: projectPath,
        encoding: 'utf-8',
      })
      const branch = result.trim()
      if (branch === 'main' || branch === 'master') {
        return branch
      }
    } catch {
      // Git command failed, try alternative approach
    }

    // Try to detect from local branches
    try {
      const result = execSync('git branch --list main master 2>/dev/null', {
        cwd: projectPath,
        encoding: 'utf-8',
      })
      if (result.includes('main')) return 'main'
      if (result.includes('master')) return 'master'
    } catch {
      // Git command failed
    }

    // Default to main
    return 'main'
  }

  /**
   * Detect project type and suggest commands
   */
  private detectProjectType(projectPath: string): {
    language?: string
    framework?: string
    packageManager?: string
    buildCommand?: string
    testCommand?: string
    lintCommand?: string
  } {
    // Check for Node.js project
    const packageJsonPath = join(projectPath, 'package.json')
    if (existsSync(packageJsonPath)) {
      return this.detectNodeProject(projectPath, packageJsonPath)
    }

    // Check for Python project
    if (
      existsSync(join(projectPath, 'requirements.txt')) ||
      existsSync(join(projectPath, 'pyproject.toml'))
    ) {
      return {
        language: 'python',
        packageManager: 'pip',
        testCommand: 'pytest',
      }
    }

    // Check for Go project
    if (existsSync(join(projectPath, 'go.mod'))) {
      return {
        language: 'go',
        packageManager: 'go mod',
        buildCommand: 'go build ./...',
        testCommand: 'go test ./...',
        lintCommand: 'golangci-lint run',
      }
    }

    // Check for Rust project
    if (existsSync(join(projectPath, 'Cargo.toml'))) {
      return {
        language: 'rust',
        packageManager: 'cargo',
        buildCommand: 'cargo build',
        testCommand: 'cargo test',
        lintCommand: 'cargo clippy',
      }
    }

    // Unknown project type
    return {}
  }

  /**
   * Detect Node.js/TypeScript project details
   */
  private detectNodeProject(
    projectPath: string,
    packageJsonPath: string
  ): {
    language: string
    framework?: string
    packageManager: string
    buildCommand?: string
    testCommand?: string
    lintCommand?: string
  } {
    let packageJson: {
      name?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    } = {}

    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    } catch {
      // Failed to parse package.json
    }

    // Detect package manager
    let packageManager = 'npm'
    if (existsSync(join(projectPath, 'yarn.lock'))) {
      packageManager = 'yarn'
    } else if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm'
    }

    // Detect language (TypeScript vs JavaScript)
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const isTypeScript = 'typescript' in deps || existsSync(join(projectPath, 'tsconfig.json'))
    const language = isTypeScript ? 'typescript' : 'javascript'

    // Detect framework
    let framework: string | undefined
    if (deps.react) {
      framework = 'react'
    } else if (deps.vue) {
      framework = 'vue'
    } else if (deps.angular) {
      framework = 'angular'
    } else if (deps.express) {
      framework = 'express'
    } else if (deps.next) {
      framework = 'next'
    }

    // Detect commands from package.json scripts
    const scripts = packageJson.scripts || {}
    const runCmd = packageManager === 'npm' ? 'npm run' : packageManager

    return {
      language,
      framework,
      packageManager,
      buildCommand: scripts.build ? `${runCmd} build` : undefined,
      testCommand: scripts.test ? `${packageManager} test` : undefined,
      lintCommand: scripts.lint ? `${runCmd} lint` : undefined,
    }
  }
}
