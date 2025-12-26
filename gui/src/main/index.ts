import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { ProjectService } from './services/ProjectService'
import { AgentService } from './services/AgentService'
import { TerminalService } from './services/TerminalService'
import { FileWatcherService } from './services/FileWatcherService'
import { TestEnvService } from './services/TestEnvService'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
let services: {
  project: ProjectService
  agent: AgentService
  terminal: TerminalService
  fileWatcher: FileWatcherService
  testEnv: TestEnvService
} | null = null

function createWindow(): void {
  // Always use PNG for BrowserWindow icon (cross-platform compatibility)
  const resourcesPath = join(__dirname, '../../resources')
  const iconPath = join(resourcesPath, 'icon.png')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Update window reference in services if they exist (handling reopen)
  if (services) {
    services.terminal.setWindow(mainWindow)
    services.testEnv.setWindow(mainWindow)
    services.fileWatcher.setWindow(mainWindow)
  }

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

  const agentService = new AgentService()
  const projectService = new ProjectService(agentService)
  const terminalService = new TerminalService(mainWindow)

  // Set AgentService reference in TerminalService for persistence
  terminalService.setAgentService(agentService)

  services = {
    project: projectService,
    agent: agentService,
    terminal: terminalService,
    fileWatcher: new FileWatcherService(mainWindow),
    testEnv: new TestEnvService(mainWindow)
  }

  // Migrate existing assignments from config.json to .agent-info files
  const activeProjects = services.project.getActiveProjects()
  for (const project of activeProjects) {
    services.agent.migrateAssignments(project.path)
      .catch(err => console.error(`Failed to migrate assignments for ${project.path}:`, err))

    // Ensure base branch agent exists for projects with framework installed
    if (!project.needsInstall) {
      services.agent.ensureBaseBranchAgentWithStartup(project.path)
        .then(result => {
          // Auto-start Claude for newly created base agents
          if (result.shouldStartClaude && result.agentInfo.prompt) {
            setTimeout(async () => {
              try {
                await services!.terminal.startAgent(
                  project.path,
                  result.agentInfo.agentId,
                  result.agentInfo.tool || 'claude',
                  result.agentInfo.mode || 'dev',
                  result.agentInfo.prompt,
                  result.agentInfo.model,
                  false
                )
                mainWindow?.webContents.send('agents:updated')
              } catch (error) {
                console.error('Failed to auto-start base agent Claude:', error)
              }
            }, 2000)
          }
        })
        .catch(err => console.error(`Failed to ensure base agent for ${project.path}:`, err))

      // NEW: Auto-resume existing Claude sessions on app startup
      services.agent.listAgents(project.path)
        .then(agents => {
          for (const agent of agents) {
            // Only auto-resume Claude sessions marked as active
            if (agent.claudeSessionActive && agent.tool === 'claude') {
              // Stagger resumes to avoid overwhelming
              const delay = 500 + Math.random() * 2000

              setTimeout(async () => {
                try {
                  await services!.terminal.startAgent(
                    project.path,
                    agent.id,
                    agent.tool || 'claude',
                    agent.mode || 'dev',
                    agent.prompt,
                    agent.model,
                    false
                  )

                  mainWindow?.webContents.send('agents:updated')

                  // Restore waiting notification if was waiting
                  if (agent.isWaitingForInput) {
                    mainWindow?.webContents.send('agent:waitingForInput',
                      agent.id,
                      'Claude is waiting for input'
                    )
                  }
                } catch (error) {
                  console.error(`Failed to resume agent ${agent.id}:`, error)

                  // Mark session inactive on resume failure
                  try {
                    await services!.agent.updateAgentInfo(agent.worktreePath, {
                      claudeSessionActive: false
                    })
                  } catch (err) {
                    console.error('Failed to mark session inactive:', err)
                  }
                }
              }, delay)
            }
          }
        })
        .catch(err => console.error(`Failed to auto-resume agents for ${project.path}:`, err))
    }
  }

  // Set up IPC handlers
  setupIPC()
}

function setupIPC(): void {
  if (!services) return

  // Helper function to find which project an agent belongs to
  const findProjectForAgent = async (agentId: string): Promise<string> => {
    const activeProjectPaths = services!.project.getActiveProjects().map(p => p.path)
    return services!.agent.findProjectForAgent(activeProjectPaths, agentId)
  }

  // Helper function to find which project an assignment belongs to
  const findProjectForAssignment = async (assignmentId: string): Promise<string> => {
    const activeProjectPaths = services!.project.getActiveProjects().map(p => p.path)
    return services!.agent.findProjectForAssignment(activeProjectPaths, assignmentId)
  }

  // Project handlers
  ipcMain.handle('project:select', async (_event, projectPath: string) => {
    try {
      console.log('[IPC] Handling project:select for:', projectPath)
      // Legacy wrapper calling addProject
      const project = await services!.project.addProject(projectPath)
      console.log('[IPC] Project selected successfully:', projectPath)

      if (!project.needsInstall) {
        services!.fileWatcher.watchProject(projectPath)
        console.log('[IPC] Started watching project:', projectPath)
      }
      return project
    } catch (error: any) {
      console.error('[IPC] Error in project:select:', error.message)
      throw error
    }
  })

  ipcMain.handle('project:add', async (_event, projectPath: string) => {
    try {
      console.log('[IPC] Handling project:add for:', projectPath)
      const project = await services!.project.addProject(projectPath)
      console.log('[IPC] Project added successfully:', projectPath)

      if (!project.needsInstall) {
        // If it became the current project (e.g. was first one), watch it
        const current = services!.project.getCurrentProject()
        if (current?.path === projectPath) {
          services!.fileWatcher.watchProject(projectPath)
          console.log('[IPC] Started watching project:', projectPath)
        }
      }
      return project
    } catch (error: any) {
      console.error('[IPC] Error in project:add:', error.message)
      throw error
    }
  })

  ipcMain.handle('project:remove', async (_event, projectPath: string) => {
    services!.project.removeProject(projectPath)
    // If current project changed, we might need to watch the new one
    const current = services!.project.getCurrentProject()
    if (current && !current.needsInstall) {
      services!.fileWatcher.watchProject(current.path)
    }
  })

  ipcMain.handle('project:switch', async (_event, projectPath: string) => {
    services!.project.switchProject(projectPath)
    const current = services!.project.getCurrentProject()
    if (current && !current.needsInstall) {
      // Ensure base agent exists
      try {
        const result = await services!.agent.ensureBaseBranchAgentWithStartup(current.path)
        // Auto-start Claude for newly created base agents
        if (result.shouldStartClaude && result.agentInfo.prompt) {
          setTimeout(async () => {
            try {
              await services!.terminal.startAgent(
                current.path,
                result.agentInfo.agentId,
                result.agentInfo.tool || 'claude',
                result.agentInfo.mode || 'dev',
                result.agentInfo.prompt,
                result.agentInfo.model,
                false
              )
              mainWindow?.webContents.send('agents:updated')
            } catch (error) {
              console.error('Failed to auto-start base agent Claude on project switch:', error)
            }
          }, 2000)
        }
      } catch (error) {
        console.error('Error ensuring base branch agent on project switch:', error)
      }
      services!.fileWatcher.watchProject(current.path)
    }
  })

  ipcMain.handle('project:getActive', async () => {
    return services!.project.getActiveProjects()
  })

  ipcMain.handle('project:install', async (_event, projectPath: string) => {
    try {
      console.log('[IPC] Handling project:install for:', projectPath)
      await services!.project.installFramework(projectPath)
      console.log('[IPC] Framework installed successfully')

      // Re-select (add) to update state
      const project = await services!.project.addProject(projectPath)
      console.log('[IPC] Project added after installation')

      services!.fileWatcher.watchProject(projectPath)
      console.log('[IPC] Started watching project after installation')

      return project
    } catch (error: any) {
      console.error('[IPC] Error in project:install:', error.message)
      console.error('[IPC] Installation failed for:', projectPath)
      throw error
    }
  })

  ipcMain.handle('project:clear', async () => {
    services!.project.clearCurrentProject()
    // Stop watching file changes? FileWatcherService doesn't have unwatch all, but it handles single project.
    // We can assume selecting a new project will overwrite the watcher.
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
    const agents = await services!.agent.listAgents(currentProject.path)
    
    // Merge in terminal PIDs from TerminalService
    const activeTerminals = services!.terminal.getActiveTerminals()
    return agents.map(agent => ({
      ...agent,
      terminalPid: activeTerminals.get(agent.id) ?? null
    }))
  })

  ipcMain.handle('agents:listForProject', async (_event, projectPath: string) => {
    const agents = await services!.agent.listAgents(projectPath)
    
    // Merge in terminal PIDs from TerminalService
    const activeTerminals = services!.terminal.getActiveTerminals()
    return agents.map(agent => ({
      ...agent,
      terminalPid: activeTerminals.get(agent.id) ?? null
    }))
  })

  ipcMain.handle('agents:stop', async (_event, agentId: string) => {
    return services!.terminal.stopAgent(agentId)
  })

  ipcMain.handle('agents:openCursor', async (_event, agentId: string) => {
    const projectPath = await findProjectForAgent(agentId)
    return services!.agent.openInCursor(projectPath, agentId)
  })

  ipcMain.handle('agents:clearUnread', async (_event, agentId: string) => {
    return services!.agent.clearUnread(agentId)
  })

  ipcMain.handle('agents:getSuperDetails', async (_event, agentId: string) => {
    const projectPath = await findProjectForAgent(agentId)
    return services!.agent.getSuperAgentDetails(projectPath, agentId)
  })

  ipcMain.handle('agents:approvePlan', async (_event, superAgentId: string, planId: string) => {
    const projectPath = await findProjectForAgent(superAgentId)
    const childAgent = await services!.agent.approvePlan(projectPath, superAgentId, planId)
    // Auto-start the child agent
    await services!.terminal.startAgent(projectPath, childAgent.agentId, childAgent.tool, childAgent.mode)
  })

  // Terminal handlers
  ipcMain.on('terminal:input', (_event, agentId: string, data: string) => {
    services!.terminal.sendInput(agentId, data)
  })

  ipcMain.on('terminal:resize', (_event, agentId: string, cols: number, rows: number) => {
    services!.terminal.resize(agentId, cols, rows)
  })

  // Plain terminal handlers
  ipcMain.handle('plainTerminal:start', async (_event, agentId: string, terminalId: string) => {
    console.log('[IPC] plainTerminal:start called with:', { agentId, terminalId })
    try {
      const projectPath = await findProjectForAgent(agentId)
      console.log('[IPC] Found project path for agent:', { agentId, projectPath })
      return services!.terminal.startPlainTerminal(projectPath, agentId, terminalId)
    } catch (error) {
      console.error('[IPC] Failed to start plain terminal:', error)
      throw error
    }
  })

  ipcMain.on('plainTerminal:input', (_event, terminalId: string, data: string) => {
    services!.terminal.sendPlainInput(terminalId, data)
  })

  ipcMain.on('plainTerminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
    services!.terminal.resizePlain(terminalId, cols, rows)
  })

  ipcMain.handle('plainTerminal:stop', async (_event, terminalId: string) => {
    return services!.terminal.stopPlainTerminal(terminalId)
  })

  // Assignment handlers
  ipcMain.handle('assignments:get', async () => {
    const currentProject = services!.project.getCurrentProject()
    if (!currentProject) return { assignments: [], availableAgentIds: [] }
    return services!.agent.getAssignments(currentProject.path)
  })

  ipcMain.handle('assignments:getForProject', async (_event, projectPath: string) => {
    return services!.agent.getAssignments(projectPath)
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
    // Note: 'cursor' tool cannot be auto-started - it requires manual "Open in Cursor"
    if (assignment.prompt && assignment.tool !== 'cursor' && (assignment.mode === 'planning' || assignment.mode === 'dev' || assignment.tool === 'cursor-cli')) {
      setTimeout(async () => {
        try {
          await services!.terminal.startAgent(
            currentProject.path,
            result.agentId,  // Use the auto-generated agentId from result
            assignment.tool,
            assignment.mode,
            assignment.prompt,
            assignment.model,
            assignment.yolo
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          console.error('Failed to auto-start agent:', error)
        }
      }, 2000) // Wait 2 seconds for worktree to be fully set up
    }
    
    return result
  })

  ipcMain.handle('assignments:createForProject', async (_event, projectPath: string, assignment: any) => {
    const result = await services!.agent.createAssignment(projectPath, assignment)
    
    // Trigger updates after worktree is created
    setTimeout(() => {
      mainWindow?.webContents.send('agents:updated')
      mainWindow?.webContents.send('assignments:updated')
    }, 1000)
    
    // Auto-start agent in planning mode if prompt is provided
    // Note: 'cursor' tool cannot be auto-started - it requires manual "Open in Cursor"
    if (assignment.prompt && assignment.tool !== 'cursor' && (assignment.mode === 'planning' || assignment.mode === 'dev' || assignment.tool === 'cursor-cli')) {
      setTimeout(async () => {
        try {
          await services!.terminal.startAgent(
            projectPath,
            result.agentId,  // Use the auto-generated agentId from result
            assignment.tool,
            assignment.mode,
            assignment.prompt,
            assignment.model,
            assignment.yolo
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          console.error('Failed to auto-start agent:', error)
        }
      }, 2000) // Wait 2 seconds for worktree to be fully set up
    }
    
    return result
  })

  ipcMain.handle('assignments:createSuper', async (_event, projectPath: string, assignment: any) => {
    const result = await services!.agent.createSuperAssignment(projectPath, assignment)
    
    // Trigger updates
    setTimeout(() => {
      mainWindow?.webContents.send('agents:updated')
      mainWindow?.webContents.send('assignments:updated')
    }, 1000)

    // Auto-start super minion in planning mode
    if (assignment.prompt && assignment.tool !== 'cursor') {
      setTimeout(async () => {
        try {
          await services!.terminal.startAgent(
            projectPath,
            result.agentId,
            assignment.tool,
            'planning',
            assignment.prompt,
            assignment.model
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          console.error('Failed to auto-start super minion:', error)
        }
      }, 2000)
    }
    
    return result
  })

  ipcMain.handle('assignments:update', async (_event, assignmentId: string, updates: any) => {
    const projectPath = await findProjectForAssignment(assignmentId)
    return services!.agent.updateAssignment(projectPath, assignmentId, updates)
  })

  ipcMain.handle('assignments:createPR', async (_event, assignmentId: string, autoCommit: boolean = false) => {
    const projectPath = await findProjectForAssignment(assignmentId)

    console.log('[PR] Creating pull request for assignment:', assignmentId, 'autoCommit:', autoCommit)
    const result = await services!.agent.createPullRequest(projectPath, assignmentId, autoCommit)
    console.log('[PR] Pull request created:', result.url)

    mainWindow?.webContents.send('assignments:updated')
    
    return result
  })

  ipcMain.handle('assignments:checkPR', async (_event, assignmentId: string) => {
    const projectPath = await findProjectForAssignment(assignmentId)

    console.log('[PR] Checking PR status for assignment:', assignmentId)
    const result = await services!.agent.checkPullRequestStatus(projectPath, assignmentId)
    console.log('[PR] PR status:', result.status)

    mainWindow?.webContents.send('assignments:updated')
    
    return result
  })

  ipcMain.handle('dependencies:check', async () => {
    return services!.agent.checkDependencies()
  })

  // Cleanup handlers
  ipcMain.handle('agents:teardown', async (_event, agentId: string, force: boolean) => {
    // Find the project this agent belongs to by searching all active projects
    const activeProjects = services!.project.getActiveProjects()
    let projectPath: string | null = null
    let agent: any = null

    for (const project of activeProjects) {
      const agents = await services!.agent.listAgents(project.path)
      const found = agents.find(a => a.id === agentId)
      if (found) {
        projectPath = project.path
        agent = found
        break
      }
    }

    if (!projectPath) throw new Error(`Agent ${agentId} not found in any active project`)

    // Prevent teardown of base branch agents
    if (agent && agent.isBaseBranchAgent) {
      throw new Error('Cannot teardown base branch agent')
    }

    // Stop agent if running
    try {
      await services!.terminal.stopAgent(agentId)
    } catch (error) {
      // Ignore if not running
    }

    // Stop test environments
    try {
      services!.testEnv.stopAll(agentId)
    } catch (error) {
      console.error('Failed to stop test environments:', error)
    }
    
    await services!.agent.teardownAgent(projectPath, agentId, force)
    
    // Trigger updates
    mainWindow?.webContents.send('agents:updated')
    mainWindow?.webContents.send('assignments:updated')
  })

  ipcMain.handle('agents:unassign', async (_event, agentId: string) => {
    // Find the project this agent belongs to by searching all active projects
    const activeProjects = services!.project.getActiveProjects()
    let projectPath: string | null = null
    let agent: any = null

    for (const project of activeProjects) {
      const agents = await services!.agent.listAgents(project.path)
      const found = agents.find(a => a.id === agentId)
      if (found) {
        projectPath = project.path
        agent = found
        break
      }
    }

    if (!projectPath) throw new Error(`Agent ${agentId} not found in any active project`)

    // Prevent unassign of base branch agents
    if (agent && agent.isBaseBranchAgent) {
      throw new Error('Cannot unassign base branch agent')
    }

    await services!.agent.unassignAgent(projectPath, agentId)
    
    // Trigger updates
    mainWindow?.webContents.send('agents:updated')
    mainWindow?.webContents.send('assignments:updated')
  })

  // Test Environment handlers
  ipcMain.handle('testEnv:getConfig', async (_event, agentId?: string) => {
    let projectPath: string | null = null
    
    if (agentId) {
      try {
        projectPath = await findProjectForAgent(agentId)
      } catch (err) {
        // Fallback to current project if agentId not found (e.g. legacy or during creation)
        const currentProject = services!.project.getCurrentProject()
        projectPath = currentProject?.path || null
      }
    } else {
      const currentProject = services!.project.getCurrentProject()
      projectPath = currentProject?.path || null
    }
    
    if (!projectPath) return { defaultCommands: [] }
    return services!.testEnv.loadConfig(projectPath)
  })

  ipcMain.handle('testEnv:getCommands', async (_event, agentId?: string, assignmentOverrides?: any[]) => {
    let projectPath: string | null = null
    
    if (agentId) {
      try {
        projectPath = await findProjectForAgent(agentId)
      } catch (err) {
        const currentProject = services!.project.getCurrentProject()
        projectPath = currentProject?.path || null
      }
    } else {
      const currentProject = services!.project.getCurrentProject()
      projectPath = currentProject?.path || null
    }
    
    if (!projectPath) return []
    return services!.testEnv.getCommands(projectPath, assignmentOverrides)
  })

  ipcMain.handle('testEnv:start', async (_event, agentId: string, commandId?: string) => {
    const projectPath = await findProjectForAgent(agentId)
    
    // Get agent worktree path
    const agents = await services!.agent.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)
    if (!agent) throw new Error('Agent not found')

    const commands = services!.testEnv.getCommands(projectPath)
    
    if (commandId) {
      // Start specific command
      const command = commands.find(c => c.id === commandId)
      if (!command) throw new Error('Command not found')
      await services!.testEnv.startCommand(projectPath, agentId, agent.worktreePath, command)
    } else {
      // Start all commands
      await services!.testEnv.startAll(projectPath, agentId, agent.worktreePath, commands)
    }
  })

  ipcMain.handle('testEnv:stop', async (_event, agentId: string, commandId?: string) => {
    if (commandId) {
      services!.testEnv.stopCommand(agentId, commandId)
    } else {
      services!.testEnv.stopAll(agentId)
    }
  })

  ipcMain.handle('testEnv:getStatus', async (_event, agentId: string) => {
    return services!.testEnv.getStatus(agentId)
  })

  ipcMain.on('testEnv:input', (_event, agentId: string, commandId: string, data: string) => {
    services!.testEnv.sendInput(agentId, commandId, data)
  })

  ipcMain.on('testEnv:resize', (_event, agentId: string, commandId: string, cols: number, rows: number) => {
    services!.testEnv.resize(agentId, commandId, cols, rows)
  })
}

app.whenReady().then(() => {
  app.setName('Minion Laboratory')
  electronApp.setAppUserModelId('com.minion-laboratory.app')

  // Set app icon for menu bar/dock on macOS
  if (process.platform === 'darwin') {
    try {
      const resourcesPath = join(__dirname, '../../resources')
      const iconPath = join(resourcesPath, 'icon.png')
      app.dock.setIcon(iconPath)
    } catch (error) {
      console.warn('Failed to set dock icon:', error)
    }
  }

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
    services.testEnv.cleanup()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

