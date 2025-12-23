import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'

interface TestEnvCommand {
  id: string
  name: string
  command: string
  cwd?: string
  port?: number
}

interface TestEnvConfig {
  defaultCommands: TestEnvCommand[]
}

interface TestEnvProcess {
  pty: pty.IPty
  commandId: string
  name: string
  startedAt: Date
  isRunning: boolean
}

export class TestEnvService {
  private processes: Map<string, Map<string, TestEnvProcess>> // agentId -> commandId -> process
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.processes = new Map()
    this.mainWindow = mainWindow
  }

  /**
   * Load test environment configuration from docs/agents/
   */
  loadConfig(projectPath: string): TestEnvConfig {
    const configPath = join(projectPath, 'minions', 'test-env.config.json')
    
    console.log('[TestEnvService] Loading config from:', configPath)
    
    if (!existsSync(configPath)) {
      console.log('[TestEnvService] Config file not found at:', configPath)
      // Return empty config if file doesn't exist
      return { defaultCommands: [] }
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(content)
      console.log('[TestEnvService] Loaded config:', config)
      return config
    } catch (error) {
      console.error('[TestEnvService] Error loading test-env.config.json:', error)
      return { defaultCommands: [] }
    }
  }

  /**
   * Get commands from config, with optional per-assignment overrides
   */
  getCommands(projectPath: string, assignmentOverrides?: TestEnvCommand[]): TestEnvCommand[] {
    if (assignmentOverrides && assignmentOverrides.length > 0) {
      return assignmentOverrides
    }

    const config = this.loadConfig(projectPath)
    return config.defaultCommands
  }

  /**
   * Start a specific test environment command
   */
  async startCommand(
    projectPath: string,
    agentId: string,
    worktreePath: string,
    command: TestEnvCommand
  ): Promise<void> {
    // Get or create agent's process map
    if (!this.processes.has(agentId)) {
      this.processes.set(agentId, new Map())
    }
    const agentProcesses = this.processes.get(agentId)!

    // Stop existing process for this command if any
    if (agentProcesses.has(command.id)) {
      this.stopCommand(agentId, command.id)
    }

    // Determine working directory
    const cwd = command.cwd 
      ? join(worktreePath, command.cwd)
      : worktreePath

    // Spawn PTY
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    
    const terminal = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd,
      env: process.env as any
    })

    // Store process info
    const processInfo: TestEnvProcess = {
      pty: terminal,
      commandId: command.id,
      name: command.name,
      startedAt: new Date(),
      isRunning: true
    }
    agentProcesses.set(command.id, processInfo)

    // Send the command to the terminal
    terminal.write(`${command.command}\r`)

    // Handle output
    terminal.onData((data) => {
      this.mainWindow.webContents.send('testEnv:output', agentId, command.id, data)
    })

    // Handle exit
    terminal.onExit((exitCode) => {
      console.log(`Test env process ${command.name} exited with code ${exitCode.exitCode}`)
      processInfo.isRunning = false
      this.mainWindow.webContents.send('testEnv:exited', agentId, command.id, exitCode.exitCode)
    })

    // Notify frontend that process started
    this.mainWindow.webContents.send('testEnv:started', agentId, command.id)
  }

  /**
   * Start all test environment commands for an agent
   */
  async startAll(
    projectPath: string,
    agentId: string,
    worktreePath: string,
    commands?: TestEnvCommand[]
  ): Promise<void> {
    const commandsToRun = commands || this.getCommands(projectPath)
    
    for (const command of commandsToRun) {
      await this.startCommand(projectPath, agentId, worktreePath, command)
    }
  }

  /**
   * Stop a specific test environment command
   */
  stopCommand(agentId: string, commandId: string): void {
    const agentProcesses = this.processes.get(agentId)
    if (!agentProcesses) return

    const process = agentProcesses.get(commandId)
    if (process) {
      process.pty.kill()
      process.isRunning = false
      agentProcesses.delete(commandId)
      this.mainWindow.webContents.send('testEnv:stopped', agentId, commandId)
    }
  }

  /**
   * Stop all test environment commands for an agent
   */
  stopAll(agentId: string): void {
    const agentProcesses = this.processes.get(agentId)
    if (!agentProcesses) return

    for (const [commandId, _process] of agentProcesses) {
      this.stopCommand(agentId, commandId)
    }

    this.processes.delete(agentId)
  }

  /**
   * Get status of test environment processes for an agent
   */
  getStatus(agentId: string): Array<{ commandId: string; name: string; isRunning: boolean }> {
    const agentProcesses = this.processes.get(agentId)
    if (!agentProcesses) return []

    return Array.from(agentProcesses.values()).map(p => ({
      commandId: p.commandId,
      name: p.name,
      isRunning: p.isRunning
    }))
  }

  /**
   * Send input to a specific test environment terminal
   */
  sendInput(agentId: string, commandId: string, data: string): void {
    const agentProcesses = this.processes.get(agentId)
    if (!agentProcesses) return

    const process = agentProcesses.get(commandId)
    if (process) {
      process.pty.write(data)
    }
  }

  /**
   * Resize a test environment terminal
   */
  resize(agentId: string, commandId: string, cols: number, rows: number): void {
    const agentProcesses = this.processes.get(agentId)
    if (!agentProcesses) return

    const process = agentProcesses.get(commandId)
    if (process && process.isRunning) {
      try {
        process.pty.resize(cols, rows)
      } catch (error) {
        // Silently ignore resize errors - terminal may have exited
        console.warn(`[TestEnvService] Failed to resize terminal ${commandId}:`, error)
      }
    }
  }

  /**
   * Cleanup all test environment processes
   */
  cleanup(): void {
    for (const [agentId, _processes] of this.processes) {
      this.stopAll(agentId)
    }
  }
}

