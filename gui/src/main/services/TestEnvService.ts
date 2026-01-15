import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createLogger } from './logger'

const log = createLogger('TestEnvService')

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

  setWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  /**
   * Load test environment configuration from minions.json (new format) or minions/config.json (legacy)
   */
  loadConfig(projectPath: string): TestEnvConfig {
    const configPath = this.findConfigPath(projectPath)
    if (!configPath) {
      return { defaultCommands: [] }
    }

    try {
      const config = JSON.parse(readFileSync(configPath.path, 'utf-8'))
      const testEnvs = configPath.isNewFormat
        ? (config.setup?.testEnvironments || config.testEnvironments || [])
        : (config.testEnvironments || [])

      return { defaultCommands: testEnvs }
    } catch (error) {
      log.error('Error loading config:', error)
      return { defaultCommands: [] }
    }
  }

  private findConfigPath(projectPath: string): { path: string; isNewFormat: boolean } | null {
    const newConfigPath = join(projectPath, 'minions.json')
    const legacyConfigPath = join(projectPath, 'minions', 'config.json')

    if (existsSync(newConfigPath)) {
      log.debug('Loading config from:', newConfigPath, '(new format)')
      return { path: newConfigPath, isNewFormat: true }
    }

    if (existsSync(legacyConfigPath)) {
      log.debug('Loading config from:', legacyConfigPath, '(legacy format)')
      return { path: legacyConfigPath, isNewFormat: false }
    }

    log.debug('No config file found at:', newConfigPath, 'or', legacyConfigPath)
    return null
  }

  /**
   * Get commands from config, with optional per-assignment overrides
   */
  getCommands(projectPath: string, assignmentOverrides?: TestEnvCommand[]): TestEnvCommand[] {
    return assignmentOverrides?.length ? assignmentOverrides : this.loadConfig(projectPath).defaultCommands
  }

  /**
   * Start a specific test environment command
   */
  async startCommand(
    _projectPath: string,
    agentId: string,
    worktreePath: string,
    command: TestEnvCommand
  ): Promise<void> {
    const agentProcesses = this.getOrCreateProcessMap(agentId)

    if (agentProcesses.has(command.id)) {
      this.stopCommand(agentId, command.id)
    }

    const cwd = command.cwd ? join(worktreePath, command.cwd) : worktreePath
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

    const terminal = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd,
      env: process.env as any
    })

    const processInfo: TestEnvProcess = {
      pty: terminal,
      commandId: command.id,
      name: command.name,
      startedAt: new Date(),
      isRunning: true
    }
    agentProcesses.set(command.id, processInfo)

    terminal.write(`${command.command}\r`)

    terminal.onData((data) => {
      this.safeSendIPC('testEnv:output', agentId, command.id, data)
    })

    terminal.onExit((exitCode) => {
      log.debug(`Test env process ${command.name} exited with code ${exitCode.exitCode}`)
      processInfo.isRunning = false
      this.safeSendIPC('testEnv:exited', agentId, command.id, exitCode.exitCode)
    })

    this.safeSendIPC('testEnv:started', agentId, command.id)
  }

  private getOrCreateProcessMap(agentId: string): Map<string, TestEnvProcess> {
    if (!this.processes.has(agentId)) {
      this.processes.set(agentId, new Map())
    }
    return this.processes.get(agentId)!
  }

  private safeSendIPC(channel: string, ...args: unknown[]): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args)
      }
    } catch (error) {
      log.debug(`Failed to send IPC on ${channel}`, error)
    }
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
    const process = this.processes.get(agentId)?.get(commandId)
    if (!process) return

    try {
      process.pty.kill()
    } catch (error) {
      log.debug(`Failed to kill PTY for test env ${commandId} (likely already exited)`, error)
    }

    process.isRunning = false
    this.processes.get(agentId)?.delete(commandId)
    this.safeSendIPC('testEnv:stopped', agentId, commandId)
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
    this.processes.get(agentId)?.get(commandId)?.pty.write(data)
  }

  /**
   * Resize a test environment terminal
   */
  resize(agentId: string, commandId: string, cols: number, rows: number): void {
    const process = this.processes.get(agentId)?.get(commandId)
    if (!process?.isRunning) return

    try {
      process.pty.resize(cols, rows)
    } catch (error) {
      log.warn(`Failed to resize terminal ${commandId}:`, error)
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

