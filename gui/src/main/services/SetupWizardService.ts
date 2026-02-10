import { existsSync, readdirSync, rmdirSync } from 'fs'
import { join, basename } from 'path'
import type { AgentService } from './AgentService'
import type { TerminalService } from './TerminalService'
import type { MinionsConfigService } from './MinionsConfigService'
import type { MinionsConfig, WizardSession } from './types/MinionsConfig'
import { isValidMinionsConfig, DEFAULT_WIZARD_TIMEOUT_MS } from './types/MinionsConfig'

/**
 * Parse wizard output to extract configuration JSON between markers.
 *
 * @param output - Terminal output to parse
 * @returns MinionsConfig or null if not found/invalid
 */
function parseConfigFromOutput(output: string): MinionsConfig | null {
  const startIdx = output.indexOf(CONFIG_START_MARKER)
  const endIdx = output.indexOf(CONFIG_END_MARKER)

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return null
  }

  const jsonStr = output.slice(startIdx + CONFIG_START_MARKER.length, endIdx).trim()

  try {
    return JSON.parse(jsonStr) as MinionsConfig
  } catch {
    return null
  }
}

/**
 * Configuration markers used by the wizard agent to output structured data.
 */
const CONFIG_START_MARKER = '===MINIONS_CONFIG_START==='
const CONFIG_END_MARKER = '===MINIONS_CONFIG_END==='

/**
 * WizardOutputBuffer - Helper class for buffered output parsing.
 *
 * Accumulates terminal output and detects when the wizard agent outputs
 * a complete configuration between the designated markers.
 *
 * @see Section 11.1 of the engineering design document for buffered output handling.
 */
export class WizardOutputBuffer {
  private buffer: string = ''
  private configReady: boolean = false
  private timeoutHandle: NodeJS.Timeout | null = null
  private readonly timeoutMs: number

  constructor(
    private onConfigReady: (config: MinionsConfig) => void,
    private onTimeout?: () => void,
    timeoutMs: number = DEFAULT_WIZARD_TIMEOUT_MS
  ) {
    this.timeoutMs = timeoutMs
  }

  /**
   * Append data to the buffer and check for complete config.
   */
  append(data: string): void {
    this.buffer += data
    this.checkForConfig()
  }

  /**
   * Get the current buffer contents.
   */
  getBuffer(): string {
    return this.buffer
  }

  /**
   * Check if the buffer contains a complete configuration.
   */
  private checkForConfig(): void {
    if (this.configReady) return

    const config = parseConfigFromOutput(this.buffer)
    if (config && isValidMinionsConfig(config)) {
      this.configReady = true
      this.clearTimeout()
      this.onConfigReady(config)
    }
  }

  /**
   * Start the timeout timer.
   */
  startTimeout(): void {
    if (this.timeoutHandle) return

    this.timeoutHandle = setTimeout(() => {
      if (!this.configReady && this.onTimeout) {
        this.onTimeout()
      }
    }, this.timeoutMs)
  }

  /**
   * Clear the timeout timer.
   */
  clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }

  /**
   * Check if config has been received.
   */
  isConfigReady(): boolean {
    return this.configReady
  }
}

/**
 * SetupWizardService - Manages the setup wizard agent lifecycle.
 *
 * The setup wizard is a Claude agent that analyzes a project and generates
 * the minions.json configuration through natural language interaction.
 *
 * @see Section 3 of the engineering design document for wizard design.
 */
export class SetupWizardService {
  private activeSessions: Map<string, WizardSession> = new Map()
  private projectToSession: Map<string, string> = new Map()
  private outputBuffers: Map<string, WizardOutputBuffer> = new Map()

  constructor(
    private readonly agentService: AgentService,
    private readonly terminalService: TerminalService,
    private readonly minionsConfigService: MinionsConfigService
  ) {}

  /**
   * Get the project name using AgentService.
   * Falls back to directory basename if AgentService is not configured.
   */
  private getProjectName(projectPath: string): string {
    return this.agentService.getProjectName(projectPath) || basename(projectPath)
  }

  /**
   * Check if a project needs the setup wizard.
   *
   * Returns true if the project has neither minions.json nor legacy config.
   *
   * @param projectPath - Path to the project root
   * @returns true if wizard is needed
   */
  needsWizard(projectPath: string): boolean {
    // Already has new config
    if (existsSync(join(projectPath, 'minions.json'))) {
      return false
    }

    // Has legacy structure - should offer migration, not full wizard
    if (existsSync(join(projectPath, 'minions', 'config.json'))) {
      return false
    }

    // Fresh project - needs wizard
    return true
  }

  /**
   * Check if a project has the legacy minions/ structure.
   *
   * @param projectPath - Path to the project root
   * @returns true if legacy config exists
   */
  hasLegacyStructure(projectPath: string): boolean {
    return existsSync(join(projectPath, 'minions', 'config.json'))
  }

  /**
   * Quick setup for a project - creates minimal config without starting Claude.
   *
   * Use this when user wants to skip auto-setup and configure manually.
   * Works for both git and non-git projects.
   *
   * @param projectPath - Path to the project root
   */
  async quickSetup(projectPath: string): Promise<void> {
    const isGitRepo = this.agentService.isGitRepo(projectPath)

    // For git repos, ensure base branch agent exists
    if (isGitRepo) {
      try {
        await this.agentService.ensureBaseBranchAgent(projectPath)
      } catch (error: any) {
        console.error('[SetupWizardService] Failed to validate project for quick setup:', error.message)
        throw error
      }
    }

    // Create minimal config
    const minimalConfig = this.minionsConfigService.getDefaultConfig(projectPath)
    this.minionsConfigService.initializeMinionsFolder(projectPath)
    this.minionsConfigService.writeConfig(projectPath, minimalConfig)
    this.minionsConfigService.updateGitignore(projectPath)
    console.log(`[SetupWizardService] Created minimal config via quick setup (isGitRepo: ${isGitRepo})`)
  }

  /**
   * Start the setup wizard for a project.
   *
   * Creates a Claude agent that analyzes the project and generates configuration.
   *
   * @param projectPath - Path to the project root
   * @returns The created WizardSession
   * @throws Error if wizard is already running for this project
   */
  async startWizard(projectPath: string): Promise<WizardSession> {
    // Check if wizard is already running for this project
    if (this.projectToSession.has(projectPath)) {
      throw new Error('Wizard already running for this project')
    }

    // Generate session ID and agent ID
    const sessionId = `wizard-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    // Use base agent pattern so it shows up in the base terminal (only for git repos)
    const projectName = this.getProjectName(projectPath)
    const isGitRepo = this.agentService.isGitRepo(projectPath)
    const agentId = isGitRepo ? `${projectName}-base` : `${projectName}-wizard-${Date.now()}`

    // For git repos, validate and ensure base branch agent FIRST before creating any files
    // This prevents leaving orphaned minions.json on failure
    if (isGitRepo) {
      try {
        await this.agentService.ensureBaseBranchAgent(projectPath)
      } catch (error: any) {
        console.error('[SetupWizardService] Failed to validate project:', error.message)
        throw error
      }
    }

    // Create a minimal config so the project can be selected
    // The wizard will update this with the full configuration
    const minimalConfig = this.minionsConfigService.getDefaultConfig(projectPath)
    this.minionsConfigService.initializeMinionsFolder(projectPath)
    this.minionsConfigService.writeConfig(projectPath, minimalConfig)
    this.minionsConfigService.updateGitignore(projectPath)
    console.log('[SetupWizardService] Created minimal config for wizard')

    // Create the wizard session
    const session: WizardSession = {
      id: sessionId,
      projectPath,
      agentId,
      status: 'analyzing',
      startedAt: new Date().toISOString(),
      timeoutMs: DEFAULT_WIZARD_TIMEOUT_MS,
    }

    // Store the session
    this.activeSessions.set(sessionId, session)
    this.projectToSession.set(projectPath, sessionId)

    // Create output buffer for parsing wizard responses
    const outputBuffer = new WizardOutputBuffer(
      (config) => this.handleConfigReady(sessionId, config),
      () => this.handleTimeout(sessionId),
      session.timeoutMs
    )
    this.outputBuffers.set(sessionId, outputBuffer)

    // Generate the wizard prompt
    const prompt = this.generateWizardPrompt(projectPath)

    // Start the Claude agent as the base branch agent
    // (ensureBaseBranchAgent was already called above for validation)
    await this.terminalService.startAgent(
      projectPath,
      agentId,
      'claude',
      'dev', // Use dev mode for file access
      prompt,
      'opus', // Use opus for best analysis
      false, // yolo
      true // chrome
    )

    // Start the timeout
    outputBuffer.startTimeout()

    return session
  }

  /**
   * Cancel an active wizard session.
   *
   * Updates status to 'cancelled', kills the terminal, and cleans up partial state.
   *
   * @param sessionId - ID of the wizard session to cancel
   */
  async cancelWizard(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (!session) return

    // Update status
    session.status = 'cancelled'

    // Kill the terminal
    this.terminalService.stopAgent(session.agentId)

    // Clear timeout
    const buffer = this.outputBuffers.get(sessionId)
    buffer?.clearTimeout()

    // Cleanup partial state
    await this.cleanupWizardSession(session)

    // Remove from active sessions
    this.activeSessions.delete(sessionId)
    this.projectToSession.delete(session.projectPath)
    this.outputBuffers.delete(sessionId)
  }

  /**
   * Parse wizard terminal output to extract configuration.
   *
   * Looks for ===MINIONS_CONFIG_START=== and ===MINIONS_CONFIG_END=== markers
   * and extracts the JSON between them.
   *
   * @param output - Terminal output to parse
   * @returns Partial MinionsConfig or null if not found/invalid
   */
  parseWizardOutput(output: string): Partial<MinionsConfig> | null {
    return parseConfigFromOutput(output)
  }

  /**
   * Finalize the setup by writing the config and completing initialization.
   *
   * - Validates the configuration
   * - Writes minions.json
   * - Initializes .minions/ folder
   * - Updates .gitignore
   *
   * @param projectPath - Path to the project root
   * @param config - Configuration to write
   * @throws Error if config is invalid
   */
  async finalizeSetup(projectPath: string, config: MinionsConfig): Promise<void> {
    // Validate the config
    if (!isValidMinionsConfig(config)) {
      throw new Error('Invalid configuration: missing required fields')
    }

    // Add wizard completion metadata
    const finalConfig: MinionsConfig = {
      ...config,
      wizard: {
        completedAt: new Date().toISOString(),
        agentSessionId: this.projectToSession.get(projectPath),
      },
    }

    // Initialize .minions folder
    this.minionsConfigService.initializeMinionsFolder(projectPath)

    // Write the config
    this.minionsConfigService.writeConfig(projectPath, finalConfig)

    // Update .gitignore
    this.minionsConfigService.updateGitignore(projectPath)
  }

  /**
   * Generate the wizard agent prompt.
   *
   * Creates a comprehensive prompt instructing the Claude agent on how to
   * analyze the project and generate the configuration.
   *
   * @param projectPath - Path to the project root
   * @returns The wizard prompt string
   */
  generateWizardPrompt(projectPath: string): string {
    const projectName = this.getProjectName(projectPath)

    return `You are the Minions Setup Wizard. Your job is to analyze this project and create a configuration file.

## Project Information
- Project path: ${projectPath}
- Project name: ${projectName}

## Your Tasks

1. EXPLORE the project to understand its structure:
   - Check for package.json, requirements.txt, go.mod, Cargo.toml, etc.
   - Identify the programming language and framework
   - Find existing build/test/lint scripts
   - Look for environment files that might need copying (.env.example, etc.)

2. ASK the user natural language questions to confirm:
   - "I see this is a [detected] project. Is that correct?"
   - "What command runs your tests?" (suggest detected command)
   - "What command builds the project?" (suggest detected command)
   - "Are there any environment files that should be copied to worktrees?"

3. GENERATE the minions.json configuration file with:
   - Project name and default branch
   - Build, test, and lint commands
   - Files to copy to worktrees
   - Post-setup commands if needed

4. OFFER to create a CLAUDE.md file:
   - If user agrees, create a project-specific CLAUDE.md
   - Include project overview, architecture notes, testing instructions

## Output Format

When you have gathered all information, output the configuration in this EXACT format:

===MINIONS_CONFIG_START===
{
  "version": "2.0",
  "project": {
    "name": "${projectName}",
    "defaultBaseBranch": "main",
    "description": "Brief project description"
  },
  "setup": {
    "filesToCopy": [".env.example"],
    "postSetupCommands": ["npm install"],
    "buildCommand": "npm run build",
    "testCommand": "npm test",
    "lintCommand": "npm run lint"
  },
  "detected": {
    "language": "typescript",
    "framework": "react",
    "packageManager": "npm",
    "detectedAt": "${new Date().toISOString()}"
  }
}
===MINIONS_CONFIG_END===

Then ask: "Would you like me to create a CLAUDE.md file for this project?"

## Important Guidelines

- Be conversational and helpful
- Suggest sensible defaults based on what you find
- Don't assume - ask if unsure about something important
- Keep the interaction short (3-5 questions max)
- The markers (===MINIONS_CONFIG_START=== and ===MINIONS_CONFIG_END===) MUST be on their own lines
- The JSON must be valid and complete

Start by exploring the project structure and then ask your first question.`
  }

  /**
   * Get an active wizard session by ID.
   *
   * @param sessionId - Session ID to look up
   * @returns The WizardSession or undefined if not found
   */
  getSession(sessionId: string): WizardSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  /**
   * Get an active wizard session by project path.
   *
   * @param projectPath - Project path to look up
   * @returns The WizardSession or undefined if not found
   */
  getSessionByProject(projectPath: string): WizardSession | undefined {
    const sessionId = this.projectToSession.get(projectPath)
    if (!sessionId) return undefined
    return this.activeSessions.get(sessionId)
  }

  /**
   * Process terminal output for a wizard session.
   *
   * Called by the terminal service when output is received.
   *
   * @param sessionId - Session ID
   * @param output - Terminal output data
   */
  processOutput(sessionId: string, output: string): void {
    const buffer = this.outputBuffers.get(sessionId)
    buffer?.append(output)
  }

  /**
   * Cleanup all active wizard sessions.
   */
  cleanup(): void {
    for (const [sessionId] of this.activeSessions) {
      const buffer = this.outputBuffers.get(sessionId)
      buffer?.clearTimeout()
    }
    this.activeSessions.clear()
    this.projectToSession.clear()
    this.outputBuffers.clear()
  }

  // --- Private helper methods ---

  /**
   * Handle when a valid config is detected from wizard output.
   */
  private handleConfigReady(sessionId: string, config: MinionsConfig): void {
    const session = this.activeSessions.get(sessionId)
    if (!session) return

    session.status = 'generating'
    session.config = config
    console.log(`[SetupWizardService] Config ready for session ${sessionId}`)

    // The config will be finalized when the user confirms
  }

  /**
   * Handle wizard timeout.
   */
  private handleTimeout(sessionId: string): void {
    const session = this.activeSessions.get(sessionId)
    if (!session) return

    session.status = 'timeout'
    session.error = 'Wizard timeout: No configuration received within the timeout period'
    console.warn(`[SetupWizardService] Wizard timed out for session ${sessionId}`)
  }

  /**
   * Cleanup partial state from a cancelled/failed wizard session.
   */
  private async cleanupWizardSession(session: WizardSession): Promise<void> {
    const minionsDir = join(session.projectPath, '.minions')

    // Remove partially created .minions folder if empty
    if (existsSync(minionsDir)) {
      try {
        const contents = readdirSync(minionsDir)
        if (contents.length === 0) {
          rmdirSync(minionsDir)
        }
      } catch (error) {
        console.error('[SetupWizardService] Failed to cleanup .minions folder:', error)
      }
    }
  }

}
