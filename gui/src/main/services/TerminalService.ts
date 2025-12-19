import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { join } from 'path'

// Simple ANSI strip function to avoid ESM issues
function stripAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

interface TerminalSession {
  pty: pty.IPty
  agentId: string
  tool: string
  mode: string
}

const SIGNAL_PATTERNS = [
  { pattern: '===SIGNAL:PLAN_READY===', signal: 'PLAN_READY' },
  { pattern: '===SIGNAL:DEV_COMPLETED===', signal: 'DEV_COMPLETED' },
  { pattern: '===SIGNAL:BLOCKER===', signal: 'BLOCKER' },
  { pattern: '===SIGNAL:QUESTION===', signal: 'QUESTION' },
  { pattern: '===SIGNAL:WORKING===', signal: 'WORKING' }
]

export class TerminalService {
  private terminals: Map<string, TerminalSession>
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.terminals = new Map()
    this.mainWindow = mainWindow
  }

  async startAgent(
    projectPath: string,
    agentId: string,
    tool: string,
    mode: string,
    prompt?: string,
    model?: string
  ): Promise<void> {
    // Stop existing terminal if any
    this.stopAgent(agentId)

    // Determine worktree path
    const projectName = projectPath.split('/').pop() || 'project'
    const worktreePath = join(projectPath, '..', `${projectName}-${agentId}`)

    // Determine command based on tool
    let command: string
    let args: string[]

    switch (tool) {
      case 'claude':
        command = 'claude'
        args = this.getClaudeArgs(mode, agentId, prompt, model)
        break
      case 'cursor-cli':
        command = 'cursor'
        args = ['--chat']
        break
      case 'cursor':
        // For regular cursor, we don't spawn a terminal
        // The user will use "Open in Cursor" button instead
        throw new Error('Use openInCursor for cursor tool')
      default:
        throw new Error(`Unknown tool: ${tool}`)
    }

    // Spawn PTY
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    
    const terminal = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: worktreePath,
      env: process.env as any
    })

    // Store terminal session
    const session: TerminalSession = {
      pty: terminal,
      agentId,
      tool,
      mode
    }
    this.terminals.set(agentId, session)

    // Send the command to the terminal
    terminal.write(`${command} ${args.join(' ')}\r`)

    // Handle output
    terminal.onData((data) => {
      this.handleOutput(agentId, data)
    })

    // Handle exit
    terminal.onExit(() => {
      this.terminals.delete(agentId)
      this.mainWindow.webContents.send('agents:updated')
    })
  }

  private getClaudeArgs(mode: string, _agentId: string, prompt?: string, model?: string): string[] {
    const args: string[] = []

    // Add model if specified
    if (model) {
      args.push('--model', model)
    }

    if (mode === 'planning') {
      // Use Claude's plan permission mode - shows plan before executing
      args.push('--permission-mode', 'plan')

      if (prompt) {
        // Prefix with planning instructions
        const planPrompt = `Create a plan for: ${prompt}`
        args.push(`"${planPrompt.replace(/"/g, '\\"')}"`)
      }
    } else if (mode === 'dev') {
      // Use acceptEdits mode - auto-approves file changes for faster development
      args.push('--permission-mode', 'acceptEdits')

      if (prompt) {
        args.push(`"${prompt.replace(/"/g, '\\"')}"`)
      }
    }

    return args
  }

  private handleOutput(agentId: string, data: string): void {
    // Send raw data to renderer for terminal display
    this.mainWindow.webContents.send('terminal:output', agentId, data)

    // Check for signals
    const stripped = stripAnsi(data)
    for (const { pattern, signal } of SIGNAL_PATTERNS) {
      if (stripped.includes(pattern)) {
        this.mainWindow.webContents.send('agent:signal', agentId, signal)
        break
      }
    }
  }

  stopAgent(agentId: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      session.pty.kill()
      this.terminals.delete(agentId)
      this.mainWindow.webContents.send('agents:updated')
    }
  }

  sendInput(agentId: string, data: string): void {
    const session = this.terminals.get(agentId)
    if (session) {
      session.pty.write(data)
    }
  }

  resize(agentId: string, cols: number, rows: number): void {
    const session = this.terminals.get(agentId)
    if (session) {
      session.pty.resize(cols, rows)
    }
  }

  cleanup(): void {
    for (const [agentId, _session] of this.terminals) {
      this.stopAgent(agentId)
    }
  }
}

