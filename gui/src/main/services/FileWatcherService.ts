import { BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import { join } from 'path'

export class FileWatcherService {
  private mainWindow: BrowserWindow
  private watcher: chokidar.FSWatcher | null = null

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  watchProject(projectPath: string): void {
    // Stop existing watcher
    if (this.watcher) {
      this.watcher.close()
    }

    // Watch assignments.json
    const assignmentsPath = join(projectPath, 'docs', 'agents', 'assignments.json')
    
    // Watch agent worktree directories for .agent-info changes
    const projectName = projectPath.split('/').pop() || 'project'
    const parentDir = join(projectPath, '..')
    const agentWorktreePattern = join(parentDir, `${projectName}-agent-*`, '.agent-info')

    this.watcher = chokidar.watch([assignmentsPath, agentWorktreePattern], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    this.watcher.on('change', (path) => {
      if (path.endsWith('assignments.json')) {
        this.mainWindow.webContents.send('assignments:updated')
      } else if (path.endsWith('.agent-info')) {
        this.mainWindow.webContents.send('agents:updated')
      }
    })

    this.watcher.on('add', (path) => {
      if (path.endsWith('.agent-info')) {
        this.mainWindow.webContents.send('agents:updated')
      }
    })

    this.watcher.on('unlink', (path) => {
      if (path.endsWith('.agent-info')) {
        this.mainWindow.webContents.send('agents:updated')
      }
    })
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}

