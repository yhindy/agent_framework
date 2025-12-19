import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { ProjectService } from './services/ProjectService'
import { AgentService } from './services/AgentService'
import { TerminalService } from './services/TerminalService'
import { FileWatcherService } from './services/FileWatcherService'

let mainWindow: BrowserWindow | null = null
let services: {
  project: ProjectService
  agent: AgentService
  terminal: TerminalService
  fileWatcher: FileWatcherService
} | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    require('electron').shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function initializeServices(): void {
  if (!mainWindow) return

  services = {
    project: new ProjectService(),
    agent: new AgentService(),
    terminal: new TerminalService(mainWindow),
    fileWatcher: new FileWatcherService(mainWindow)
  }

  // Set up IPC handlers
  setupIPC()
}

function setupIPC(): void {
  if (!services) return

  // Project handlers
  ipcMain.handle('project:select', async (_event, projectPath: string) => {
    const project = services!.project.selectProject(projectPath)
    // Start watching the new project
    services!.fileWatcher.watchProject(projectPath)
    return project
  })

  ipcMain.handle('project:getRecent', async () => {
    return services!.project.getRecentProjects()
  })

  ipcMain.handle('project:getCurrent', async () => {
    return services!.project.getCurrentProject()
  })

  // Agent handlers
  ipcMain.handle('agents:list', async () => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) return []
    return services!.agent.listAgents(currentProject.path)
  })

  ipcMain.handle('agents:start', async (_event, agentId: string, tool: string, mode: string, prompt?: string, model?: string) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')
    return services!.terminal.startAgent(currentProject.path, agentId, tool, mode, prompt, model)
  })

  ipcMain.handle('agents:stop', async (_event, agentId: string) => {
    return services!.terminal.stopAgent(agentId)
  })

  ipcMain.handle('agents:openCursor', async (_event, agentId: string) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')
    return services!.agent.openInCursor(currentProject.path, agentId)
  })

  ipcMain.handle('agents:clearUnread', async (_event, agentId: string) => {
    return services!.agent.clearUnread(agentId)
  })

  // Terminal handlers
  ipcMain.on('terminal:input', (_event, agentId: string, data: string) => {
    services!.terminal.sendInput(agentId, data)
  })

  ipcMain.on('terminal:resize', (_event, agentId: string, cols: number, rows: number) => {
    services!.terminal.resize(agentId, cols, rows)
  })

  // Assignment handlers
  ipcMain.handle('assignments:get', async () => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) return { assignments: [], availableAgentIds: [] }
    return services!.agent.getAssignments(currentProject.path)
  })

  ipcMain.handle('assignments:create', async (_event, assignment: any) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')
    const result = await services!.agent.createAssignment(currentProject.path, assignment)
    
    // Trigger updates after worktree is created
    setTimeout(() => {
      mainWindow?.webContents.send('agents:updated')
      mainWindow?.webContents.send('assignments:updated')
    }, 1000)
    
    // Auto-start agent in planning mode if prompt is provided
    if (assignment.prompt && (assignment.mode === 'planning' || assignment.mode === 'dev')) {
      setTimeout(async () => {
        try {
          await services!.terminal.startAgent(
            currentProject.path, 
            assignment.agentId, 
            assignment.tool, 
            assignment.mode,
            assignment.prompt
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          console.error('Failed to auto-start agent:', error)
        }
      }, 2000) // Wait 2 seconds for worktree to be fully set up
    }
    
    return result
  })

  ipcMain.handle('assignments:update', async (_event, assignmentId: string, updates: any) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')
    return services!.agent.updateAssignment(currentProject.path, assignmentId, updates)
  })

  ipcMain.handle('assignments:merge', async (_event, assignmentId: string, tool?: string) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')

    console.log('[merge] Tool parameter received:', tool)
    const mergeAssignment = await services!.agent.initiateMerge(currentProject.path, assignmentId, tool)
    console.log('[merge] Merge assignment created with tool:', mergeAssignment.tool)

    mainWindow?.webContents.send('assignments:updated')
    mainWindow?.webContents.send('agents:updated')

    // Auto-start the merge agent after worktree is set up
    setTimeout(async () => {
      try {
        console.log('[merge] Starting agent with tool:', mergeAssignment.tool)
        await services!.terminal.startAgent(
          currentProject.path,
          mergeAssignment.agentId,
          mergeAssignment.tool,
          mergeAssignment.mode,
          mergeAssignment.prompt
        )
        mainWindow?.webContents.send('agents:updated')
      } catch (error) {
        console.error('Failed to auto-start merge agent:', error)
      }
    }, 2000)
  })

  // Cleanup handlers
  ipcMain.handle('agents:teardown', async (_event, agentId: string, force: boolean) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')
    
    // Stop agent if running
    try {
      await services!.terminal.stopAgent(agentId)
    } catch (error) {
      // Ignore if not running
    }
    
    await services!.agent.teardownAgent(currentProject.path, agentId, force)
    
    // Trigger updates
    mainWindow?.webContents.send('agents:updated')
    mainWindow?.webContents.send('assignments:updated')
  })

  ipcMain.handle('agents:unassign', async (_event, agentId: string) => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) throw new Error('No project selected')
    
    await services!.agent.unassignAgent(currentProject.path, agentId)
    
    // Trigger updates
    mainWindow?.webContents.send('agents:updated')
    mainWindow?.webContents.send('assignments:updated')
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.agent-orchestrator')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  initializeServices()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (services) {
    services.terminal.cleanup()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
