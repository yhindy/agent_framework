import { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { app } from 'electron'

/**
 * Configuration for test budget settings
 */
export interface TestBudgetConfig {
  maxConcurrentLocalTests: number  // Default: 1
  enableCloudOverflow: boolean     // Default: true - automatically spawn cloud agents when budget exceeded
}

/**
 * Represents an active test run
 */
export interface ActiveTestRun {
  id: string
  agentId: string
  projectPath: string
  worktreePath: string
  command: string
  startedAt: Date
  isCloud: boolean
  cloudProcessId?: string  // For tracking background agent processes
}

/**
 * Result from a cloud agent test run
 */
export interface CloudTestResult {
  testRunId: string
  agentId: string
  exitCode: number
  stdout: string
  stderr: string
  completedAt: Date
}

/**
 * TestBudgetService manages concurrent test execution with local budget limits
 * and cloud overflow capability.
 *
 * When the local test budget is exhausted, tests are automatically sent to
 * Claude Code's cloud background agents using `claude --background`.
 */
export class TestBudgetService {
  private config: TestBudgetConfig
  private activeLocalTests: Map<string, ActiveTestRun>
  private activeCloudTests: Map<string, ActiveTestRun>
  private cloudResults: Map<string, CloudTestResult>
  private mainWindow: BrowserWindow | null
  private configPath: string

  // Event callbacks
  private onTestCompleteCallbacks: Array<(result: CloudTestResult) => void> = []
  private onBudgetChangeCallbacks: Array<(local: number, cloud: number) => void> = []

  constructor(mainWindow?: BrowserWindow) {
    this.mainWindow = mainWindow || null
    this.activeLocalTests = new Map()
    this.activeCloudTests = new Map()
    this.cloudResults = new Map()

    // Store config in user data directory
    const userDataPath = app.isPackaged ? app.getPath('userData') : join(__dirname, '../../../../.test-budget')
    this.configPath = join(userDataPath, 'test-budget-config.json')

    // Load or initialize config
    this.config = this.loadConfig()
  }

  setWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  /**
   * Load configuration from disk or use defaults
   */
  private loadConfig(): TestBudgetConfig {
    const defaults: TestBudgetConfig = {
      maxConcurrentLocalTests: 1,
      enableCloudOverflow: true
    }

    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8')
        const saved = JSON.parse(content)
        return { ...defaults, ...saved }
      }
    } catch (error) {
      console.error('[TestBudgetService] Error loading config:', error)
    }

    return defaults
  }

  /**
   * Save configuration to disk
   */
  private saveConfig(): void {
    try {
      const dir = join(this.configPath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (error) {
      console.error('[TestBudgetService] Error saving config:', error)
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TestBudgetConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  setConfig(updates: Partial<TestBudgetConfig>): void {
    this.config = { ...this.config, ...updates }
    this.saveConfig()
    this.notifyBudgetChange()
  }

  /**
   * Get current budget status
   */
  getBudgetStatus(): {
    maxLocal: number
    activeLocal: number
    activeCloud: number
    availableLocal: number
    isLocalBudgetExhausted: boolean
  } {
    const activeLocal = this.activeLocalTests.size
    const maxLocal = this.config.maxConcurrentLocalTests

    return {
      maxLocal,
      activeLocal,
      activeCloud: this.activeCloudTests.size,
      availableLocal: Math.max(0, maxLocal - activeLocal),
      isLocalBudgetExhausted: activeLocal >= maxLocal
    }
  }

  /**
   * Check if a test can run locally
   */
  canRunLocally(): boolean {
    return this.activeLocalTests.size < this.config.maxConcurrentLocalTests
  }

  /**
   * Request to run a test. Returns whether it will run locally or in cloud.
   * If budget is exhausted and cloud overflow is disabled, throws an error.
   */
  async requestTestRun(
    agentId: string,
    projectPath: string,
    worktreePath: string,
    command: string
  ): Promise<{ isCloud: boolean; testRunId: string }> {
    const testRunId = `test-${agentId}-${Date.now()}`

    if (this.canRunLocally()) {
      // Run locally
      const testRun: ActiveTestRun = {
        id: testRunId,
        agentId,
        projectPath,
        worktreePath,
        command,
        startedAt: new Date(),
        isCloud: false
      }
      this.activeLocalTests.set(testRunId, testRun)
      this.notifyBudgetChange()

      console.log(`[TestBudgetService] Running test locally: ${testRunId}`)
      return { isCloud: false, testRunId }
    }

    // Budget exhausted - check if cloud overflow is enabled
    if (!this.config.enableCloudOverflow) {
      throw new Error(
        `Local test budget exhausted (${this.activeLocalTests.size}/${this.config.maxConcurrentLocalTests}). ` +
        'Cloud overflow is disabled. Wait for a test to complete or enable cloud overflow.'
      )
    }

    // Spawn cloud agent
    console.log(`[TestBudgetService] Local budget exhausted, spawning cloud agent for: ${testRunId}`)
    const cloudProcessId = await this.spawnCloudAgent(testRunId, agentId, worktreePath, command)

    const testRun: ActiveTestRun = {
      id: testRunId,
      agentId,
      projectPath,
      worktreePath,
      command,
      startedAt: new Date(),
      isCloud: true,
      cloudProcessId
    }
    this.activeCloudTests.set(testRunId, testRun)
    this.notifyBudgetChange()

    return { isCloud: true, testRunId }
  }

  /**
   * Spawn a cloud background agent using Claude Code's --background flag
   */
  private async spawnCloudAgent(
    testRunId: string,
    _agentId: string,
    worktreePath: string,
    command: string
  ): Promise<string> {
    // Create a prompt that runs the test command and reports results
    const prompt = `Run the following test command and report the results:
\`\`\`
${command}
\`\`\`

After the tests complete:
1. Report whether tests passed or failed
2. If there are failures, summarize the failing tests
3. Write the exit code to .test-result-${testRunId}.json in the following format:
   {"exitCode": <number>, "summary": "<brief summary>"}

Work in the directory: ${worktreePath}`

    // Use claude with --background flag for cloud execution
    // The --print flag ensures we get the conversation ID back
    const claudeArgs = [
      '--background',
      '--print',
      '--message', prompt,
      '--cwd', worktreePath
    ]

    return new Promise((resolve, reject) => {
      const process = spawn('claude', claudeArgs, {
        cwd: worktreePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true
      })

      let stdout = ''
      let stderr = ''

      process.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      process.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      process.on('error', (error) => {
        console.error(`[TestBudgetService] Failed to spawn cloud agent: ${error.message}`)
        reject(new Error(`Failed to spawn cloud agent: ${error.message}`))
      })

      // For background agents, the process exits quickly after spawning
      // We track it by the testRunId and poll for results
      process.on('close', (code) => {
        if (code === 0) {
          // Extract conversation ID from stdout if available
          const conversationIdMatch = stdout.match(/conversation[:\s]+([a-zA-Z0-9-]+)/i)
          const processId = conversationIdMatch ? conversationIdMatch[1] : testRunId

          console.log(`[TestBudgetService] Cloud agent spawned successfully: ${processId}`)

          // Start polling for results
          this.pollCloudResult(testRunId, worktreePath)

          resolve(processId)
        } else {
          const errorMsg = stderr || `Cloud agent spawn failed with code ${code}`
          console.error(`[TestBudgetService] Cloud agent spawn failed: ${errorMsg}`)
          reject(new Error(errorMsg))
        }
      })

      // Unref to allow the main process to exit even if the background agent is still running
      process.unref()
    })
  }

  /**
   * Poll for cloud test results by checking for the result file
   */
  private pollCloudResult(testRunId: string, worktreePath: string): void {
    const resultFile = join(worktreePath, `.test-result-${testRunId}.json`)
    const maxAttempts = 60 * 10  // Poll for up to 10 minutes (every second)
    let attempts = 0

    const pollInterval = setInterval(async () => {
      attempts++

      try {
        if (existsSync(resultFile)) {
          const content = readFileSync(resultFile, 'utf-8')
          const result = JSON.parse(content)

          clearInterval(pollInterval)

          // Clean up result file
          try {
            require('fs').unlinkSync(resultFile)
          } catch (e) {
            // Ignore cleanup errors
          }

          // Mark test as complete
          this.completeCloudTest(testRunId, result.exitCode, result.summary || '', '')

          return
        }
      } catch (error) {
        // File might not exist yet or be invalid, continue polling
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval)
        console.warn(`[TestBudgetService] Cloud test ${testRunId} timed out after ${maxAttempts}s`)
        this.completeCloudTest(testRunId, -1, '', 'Cloud test timed out')
      }
    }, 1000)
  }

  /**
   * Mark a local test as complete
   */
  completeLocalTest(testRunId: string): void {
    const testRun = this.activeLocalTests.get(testRunId)
    if (testRun) {
      this.activeLocalTests.delete(testRunId)
      this.notifyBudgetChange()
      console.log(`[TestBudgetService] Local test completed: ${testRunId}`)
    }
  }

  /**
   * Mark a cloud test as complete and store result
   */
  completeCloudTest(testRunId: string, exitCode: number, stdout: string, stderr: string): void {
    const testRun = this.activeCloudTests.get(testRunId)
    if (testRun) {
      this.activeCloudTests.delete(testRunId)

      const result: CloudTestResult = {
        testRunId,
        agentId: testRun.agentId,
        exitCode,
        stdout,
        stderr,
        completedAt: new Date()
      }

      this.cloudResults.set(testRunId, result)

      // Notify callbacks
      for (const callback of this.onTestCompleteCallbacks) {
        try {
          callback(result)
        } catch (error) {
          console.error('[TestBudgetService] Error in test complete callback:', error)
        }
      }

      // Notify frontend
      this.mainWindow?.webContents.send('testBudget:cloudTestComplete', result)
      this.notifyBudgetChange()

      console.log(`[TestBudgetService] Cloud test completed: ${testRunId} (exit: ${exitCode})`)
    }
  }

  /**
   * Get result from a completed cloud test
   */
  getCloudResult(testRunId: string): CloudTestResult | null {
    return this.cloudResults.get(testRunId) || null
  }

  /**
   * Get all active tests (local and cloud)
   */
  getActiveTests(): {
    local: ActiveTestRun[]
    cloud: ActiveTestRun[]
  } {
    return {
      local: Array.from(this.activeLocalTests.values()),
      cloud: Array.from(this.activeCloudTests.values())
    }
  }

  /**
   * Register callback for test completion
   */
  onTestComplete(callback: (result: CloudTestResult) => void): () => void {
    this.onTestCompleteCallbacks.push(callback)
    return () => {
      const index = this.onTestCompleteCallbacks.indexOf(callback)
      if (index >= 0) {
        this.onTestCompleteCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Register callback for budget changes
   */
  onBudgetChange(callback: (local: number, cloud: number) => void): () => void {
    this.onBudgetChangeCallbacks.push(callback)
    return () => {
      const index = this.onBudgetChangeCallbacks.indexOf(callback)
      if (index >= 0) {
        this.onBudgetChangeCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Notify about budget changes
   */
  private notifyBudgetChange(): void {
    const status = this.getBudgetStatus()

    // Notify callbacks
    for (const callback of this.onBudgetChangeCallbacks) {
      try {
        callback(status.activeLocal, status.activeCloud)
      } catch (error) {
        console.error('[TestBudgetService] Error in budget change callback:', error)
      }
    }

    // Notify frontend
    this.mainWindow?.webContents.send('testBudget:statusChanged', status)
  }

  /**
   * Cleanup - cancel any pending cloud test polling
   */
  cleanup(): void {
    // Clear all active tests
    this.activeLocalTests.clear()
    this.activeCloudTests.clear()
    this.cloudResults.clear()
    this.onTestCompleteCallbacks = []
    this.onBudgetChangeCallbacks = []
  }
}
