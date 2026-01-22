import { app, BrowserWindow, ipcMain, crashReporter } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { ProjectService } from './services/ProjectService'
import { AgentService } from './services/AgentService'
import { TerminalService } from './services/TerminalService'
import { FileWatcherService } from './services/FileWatcherService'
import { TestEnvService } from './services/TestEnvService'
import { SettingsService } from './services/SettingsService'
import { NotificationService } from './services/NotificationService'
import { PRPollingService } from './services/PRPollingService'
import { ClaudeSessionInfoService } from './services/ClaudeSessionInfoService'
import { TeleportService } from './services/TeleportService'
import { TeleportMetadataService } from './services/TeleportMetadataService'
import { WorkflowService } from './services/WorkflowService'
import { createLogger } from './services/logger'
import type { WorkflowConfig, WorkflowStep } from './services/types/WorkflowTypes'
import { SetupWizardService } from './services/SetupWizardService'
import { MinionsConfigService } from './services/MinionsConfigService'
import { ClaudeConfigService } from './services/ClaudeConfigService'
import type { ClaudeConfigSettings } from '../shared/types/settings'

const log = createLogger('Main')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function getCurrentBranch(): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: join(__dirname, '../../'),
      encoding: 'utf-8'
    }).trim()
    return branch
  } catch {
    return 'unknown'
  }
}

let mainWindow: BrowserWindow | null = null

// Agent type from listAgents (subset of AgentSession interface)
interface ResumeableAgent {
  id: string
  worktreePath: string
  claudeSessionId?: string
  cloudSessionId?: string
  isTeleportedSession?: boolean
  tool?: string
  mode?: string
  prompt?: string
  model?: string
  yolo?: boolean
  chrome?: boolean
}

/**
 * Validates a teleported session and returns whether it can be resumed.
 * Returns true if the session is valid and resumable, false otherwise.
 */
async function validateTeleportedSession(agent: ResumeableAgent): Promise<boolean> {
  if (!services) return false

  const agentInfo = services.agent.readAgentInfo(agent.worktreePath)
  if (!agentInfo) {
    log.debug(`Could not read agent info for ${agent.id}`)
    return false
  }

  const validation = await services.agent.validateTeleportSession(agentInfo, agent.worktreePath)

  if (!validation.isValid) {
    log.warn(`Teleported session ${agent.id} validation failed: ${validation.reason}`)
    mainWindow?.webContents.send('agent:teleportValidationFailed', {
      agentId: agent.id,
      reason: validation.reason,
      canRetry: validation.canResume
    })
    services.agent.updateAgentInfo(agent.worktreePath, { claudeSessionActive: false })
    return false
  }

  if (!validation.canResume) {
    log.debug(`Teleported session ${agent.id} cannot be resumed: ${validation.reason}`)
    return false
  }

  return true
}

/**
 * Attempts to resume a single agent's Claude session.
 * Handles teleport validation, session state checking, and terminal startup.
 */
async function resumeAgentSession(projectPath: string, agent: ResumeableAgent): Promise<void> {
  if (!services || !agent.claudeSessionId) return

  // Validate teleported sessions first
  if (agent.cloudSessionId || agent.isTeleportedSession) {
    const isValid = await validateTeleportedSession(agent)
    if (!isValid) return
  }

  // Check session state from JSONL
  const sessionState = services.claudeSessionInfo.getSessionState(
    agent.claudeSessionId,
    agent.worktreePath
  )

  if (sessionState === 'unknown') {
    log.debug(`Skipping ${agent.id} - session not found in JSONL`)
    return
  }

  log.debug(`Auto-resuming Claude session for ${agent.id} (state: ${sessionState})`)

  try {
    await services.terminal.startAgent(
      projectPath,
      agent.id,
      agent.tool || 'claude',
      agent.mode || 'dev',
      agent.prompt,
      agent.model,
      agent.yolo || false,
      agent.chrome !== false
    )

    mainWindow?.webContents.send('agents:updated')

    if (sessionState === 'waiting') {
      mainWindow?.webContents.send('agent:waitingForInput', agent.id, 'Claude is waiting for input')
    }
  } catch (error) {
    log.error(`Failed to resume agent ${agent.id}`, error)
    mainWindow?.webContents.send('agent:resumeFailed', {
      agentId: agent.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
let services: {
  project: ProjectService
  agent: AgentService
  terminal: TerminalService
  fileWatcher: FileWatcherService
  testEnv: TestEnvService
  settings: SettingsService
  notification: NotificationService
  prPolling: PRPollingService
  claudeSessionInfo: ClaudeSessionInfoService
  teleport: TeleportService
  teleportMetadata: TeleportMetadataService
  workflow: WorkflowService
  setupWizard: SetupWizardService
  minionsConfig: MinionsConfigService
  claudeConfig: ClaudeConfigService
} | null = null


function createWindow(): void {
  // Always use PNG for BrowserWindow icon (cross-platform compatibility)
  const resourcesPath = join(__dirname, '../../resources')
  const iconPath = join(resourcesPath, 'icon.png')
  const branch = getCurrentBranch()
  const windowTitle = branch && branch !== 'unknown' ? `Minion Laboratory -- ${branch}` : 'Minion Laboratory'

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

  // Set title after page loads (HTML <title> would otherwise overwrite it)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.setTitle(windowTitle)
  })

  // Update window reference in services if they exist (handling reopen)
  if (services) {
    services.terminal.setWindow(mainWindow)
    services.testEnv.setWindow(mainWindow)
    services.fileWatcher.setWindow(mainWindow)
    services.notification.setWindow(mainWindow)
  }

  // Track window focus for notifications
  mainWindow.on('focus', () => {
    services?.notification.setWindowFocus(true)
  })

  mainWindow.on('blur', () => {
    services?.notification.setWindowFocus(false)
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

  // Set app name for notifications (helps with macOS permissions)
  app.setName('Agent Orchestrator')

  // On macOS, ensure app appears in dock (required for notifications in dev mode)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show()
  }

  const agentService = new AgentService()
  const projectService = new ProjectService(agentService)
  const settingsService = new SettingsService()
  const notificationService = new NotificationService(mainWindow, settingsService)
  const claudeSessionInfoService = new ClaudeSessionInfoService()
  const terminalService = new TerminalService(mainWindow, notificationService)
  const minionsConfigService = new MinionsConfigService()

  // Set service references in TerminalService
  terminalService.setAgentService(agentService)
  terminalService.setClaudeSessionInfoService(claudeSessionInfoService)
  terminalService.setSettingsService(settingsService)

  // Note: Orphaned tmux session cleanup happens after we know which agents are active (see below)

  // WorkflowService will be set after services object is created (below)

  // Set service references in AgentService
  agentService.setClaudeSessionInfoService(claudeSessionInfoService)

  // Create SetupWizardService (depends on other services)
  const setupWizardService = new SetupWizardService(agentService, terminalService, minionsConfigService)

  // Create ClaudeConfigService for importing Claude Code plugins
  const claudeConfigService = new ClaudeConfigService()
  claudeConfigService.setWindow(mainWindow)

  services = {
    project: projectService,
    agent: agentService,
    terminal: terminalService,
    fileWatcher: new FileWatcherService(mainWindow),
    testEnv: new TestEnvService(mainWindow),
    settings: settingsService,
    notification: notificationService,
    prPolling: new PRPollingService(mainWindow, agentService),
    claudeSessionInfo: claudeSessionInfoService,
    teleport: new TeleportService(),
    teleportMetadata: new TeleportMetadataService(),
    workflow: new WorkflowService(),
    setupWizard: setupWizardService,
    minionsConfig: minionsConfigService,
    claudeConfig: claudeConfigService
  }

  // Wire up WorkflowService to TerminalService for dynamic rules generation
  terminalService.setWorkflowService(services.workflow)

  // Wire up ClaudeConfigService to WorkflowService for imported agents
  services.workflow.setClaudeConfigService(services.claudeConfig)

  // Initialize Claude config settings from saved settings
  const savedSettings = settingsService.getSettings()
  if (savedSettings.claudeConfig) {
    services.claudeConfig.updateSettings(savedSettings.claudeConfig)
  }

  // Start watching for Claude config changes if auto-refresh is enabled
  if (savedSettings.claudeConfig?.autoRefresh !== false) {
    services.claudeConfig.startWatching()
  }

  // Do initial scan of Claude plugins
  services.claudeConfig.scanConfigs()

  // Migrate existing assignments and collect active agents, then cleanup orphaned tmux sessions
  const activeProjects = services.project.getActiveProjects()

  // Async initialization: collect agents, cleanup orphans, then auto-resume
  ;(async () => {
    // First pass: collect all active agent IDs and do migrations
    const allAgentIds: string[] = []
    const agentsByProject = new Map<string, ResumeableAgent[]>()

    await Promise.all(activeProjects.map(async (project) => {
      try {
        await services!.agent.migrateAssignments(project.path)
      } catch (err) {
        log.error(`Failed to migrate assignments for ${project.path}`, err)
      }

      if (!project.needsInstall) {
        try {
          const agents = await services!.agent.listAgents(project.path)
          allAgentIds.push(...agents.map(a => a.id))
          agentsByProject.set(project.path, agents)
        } catch (err) {
          log.error(`Failed to list agents for ${project.path}`, err)
        }
      }
    }))

    // Clean up orphaned tmux sessions (those without active agents)
    services!.terminal.killOrphanedTmuxSessions(allAgentIds)

    // Second pass: ensure base agents and auto-resume
    for (const project of activeProjects) {
      if (project.needsInstall) continue

      // Ensure base branch agent exists
      services!.agent.ensureBaseBranchAgentWithStartup(project.path)
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
                  false,
                  result.agentInfo.chrome !== false
                )
                mainWindow?.webContents.send('agents:updated')
              } catch (error) {
                log.error('Failed to auto-start base agent Claude', error)
              }
            }, 2000)
          }
        })
        .catch(err => log.error(`Failed to ensure base agent for ${project.path}`, err))

      // Auto-resume existing Claude sessions
      const agents = agentsByProject.get(project.path) || []
      const resumePromises = agents
        .filter(agent => agent.claudeSessionId && agent.tool === 'claude')
        .map(agent => resumeAgentSession(project.path, agent))

      Promise.all(resumePromises)
        .catch(err => log.error(`Failed to auto-resume agents for ${project.path}`, err))
    }
  })().catch(err => log.error('Failed during startup initialization', err))

  // Set up IPC handlers
  setupIPC()
}

function setupIPC(): void {
  if (!services) return

  // Cache for agent -> project mapping to avoid repeated git worktree calls
  const agentProjectCache = new Map<string, string>()

  // Helper function to find which project an agent belongs to (with caching)
  const findProjectForAgent = async (agentId: string): Promise<string> => {
    // Check cache first
    const cached = agentProjectCache.get(agentId)
    if (cached) {
      return cached
    }

    const activeProjectPaths = services!.project.getActiveProjects().map(p => p.path)
    const projectPath = await services!.agent.findProjectForAgent(activeProjectPaths, agentId)

    // Cache the result
    agentProjectCache.set(agentId, projectPath)
    return projectPath
  }

  // Clear agent cache when agent list changes (called after agent operations)
  const clearAgentCache = (agentId?: string) => {
    if (agentId) {
      agentProjectCache.delete(agentId)
    } else {
      agentProjectCache.clear()
    }
  }

  // Helper function to find which project an assignment belongs to
  const findProjectForAssignment = async (assignmentId: string): Promise<string> => {
    const activeProjectPaths = services!.project.getActiveProjects().map(p => p.path)
    return services!.agent.findProjectForAssignment(activeProjectPaths, assignmentId)
  }

  // Set the findProjectPath callback for PR polling
  services.prPolling.setFindProjectPath(async (assignmentId: string) => {
    try {
      return await findProjectForAssignment(assignmentId)
    } catch {
      return null
    }
  })

  // Project handlers
  ipcMain.handle('project:select', async (_event, projectPath: string) => {
    try {
      log.debug('[IPC] Handling project:select for:', projectPath)
      // Legacy wrapper calling addProject
      const project = await services!.project.addProject(projectPath)
      log.debug('[IPC] Project selected successfully:', projectPath)

      if (!project.needsInstall) {
        services!.fileWatcher.watchProject(projectPath)
        log.debug('[IPC] Started watching project:', projectPath)
      }
      return project
    } catch (error: any) {
      log.error('[IPC] Error in project:select:', error.message)
      throw error
    }
  })

  ipcMain.handle('project:add', async (_event, projectPath: string) => {
    try {
      log.debug('[IPC] Handling project:add for:', projectPath)
      const project = await services!.project.addProject(projectPath)
      log.debug('[IPC] Project added successfully:', projectPath)

      if (!project.needsInstall) {
        // If it became the current project (e.g. was first one), watch it
        const current = services!.project.getCurrentProject()
        if (current?.path === projectPath) {
          services!.fileWatcher.watchProject(projectPath)
          log.debug('[IPC] Started watching project:', projectPath)
        }
      }
      return project
    } catch (error: any) {
      log.error('[IPC] Error in project:add:', error.message)
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
                false,
                result.agentInfo.chrome !== false
              )
              mainWindow?.webContents.send('agents:updated')
            } catch (error) {
              log.error('Failed to auto-start base agent Claude on project switch', error)
            }
          }, 2000)
        }
      } catch (error) {
        log.error('Error ensuring base branch agent on project switch', error)
      }
      services!.fileWatcher.watchProject(current.path)
    }
  })

  ipcMain.handle('project:getActive', async () => {
    return services!.project.getActiveProjects()
  })

  ipcMain.handle('project:install', async (_event, projectPath: string) => {
    try {
      log.debug('[IPC] Handling project:install for:', projectPath)
      await services!.project.installFramework(projectPath)
      log.debug('[IPC] Framework installed successfully')

      // Re-select (add) to update state
      const project = await services!.project.addProject(projectPath)
      log.debug('[IPC] Project added after installation')

      services!.fileWatcher.watchProject(projectPath)
      log.debug('[IPC] Started watching project after installation')

      return project
    } catch (error: any) {
      log.error('[IPC] Error in project:install:', error.message)
      log.error('[IPC] Installation failed for:', projectPath)
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

    // Merge in terminal PIDs and current state from TerminalService
    // This avoids separate getAgentState calls for each agent (major perf improvement)
    const activeTerminals = services!.terminal.getActiveTerminals()
    return agents.map(agent => {
      // Populate the agent -> project cache while we have this data
      agentProjectCache.set(agent.id, projectPath)

      let currentState: string | undefined

      // Get state for active Claude agents
      if (activeTerminals.has(agent.id) && agent.tool === 'claude' && agent.claudeSessionId) {
        currentState = services!.claudeSessionInfo.getSessionState(
          agent.claudeSessionId,
          agent.worktreePath
        )
      }

      return {
        ...agent,
        terminalPid: activeTerminals.get(agent.id) ?? null,
        currentState
      }
    })
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

  // Get current state of an agent (for frontend sync on reload)
  ipcMain.handle('agent:getState', async (_event, agentId: string) => {
    try {
      const projectPath = await findProjectForAgent(agentId)
      const agents = await services!.agent.listAgents(projectPath)
      const agent = agents.find(a => a.id === agentId)

      if (!agent || !agent.claudeSessionId || agent.tool !== 'claude') {
        return 'unknown'
      }

      // Read current state from JSONL (source of truth)
      const state = services!.claudeSessionInfo.getSessionState(
        agent.claudeSessionId,
        agent.worktreePath
      )

      log.debug(`[IPC] agent:getState for ${agentId}: ${state}`)
      return state
    } catch (error) {
      log.error(`Failed to get state for ${agentId}`, error)
      return 'unknown'
    }
  })

  ipcMain.handle('agents:getSuperDetails', async (_event, agentId: string) => {
    const projectPath = await findProjectForAgent(agentId)
    return services!.agent.getSuperAgentDetails(projectPath, agentId)
  })

  // Validate and potentially retry a teleported session
  ipcMain.handle('agents:validateTeleport', async (_event, agentId: string) => {
    try {
      const projectPath = await findProjectForAgent(agentId)
      const agents = await services!.agent.listAgents(projectPath)
      const agent = agents.find(a => a.id === agentId)

      if (!agent) {
        return { success: false, error: 'Agent not found' }
      }

      // Read full agent info from disk
      const agentInfo = services!.agent.readAgentInfo(agent.worktreePath)
      if (!agentInfo) {
        return { success: false, error: 'Could not read agent info' }
      }

      // Validate the teleported session
      const validation = await services!.agent.validateTeleportSession(agentInfo)

      if (validation.isValid && validation.canResume) {
        // Update lastValidatedAt timestamp
        services!.agent.updateAgentInfo(agent.worktreePath, {
          lastValidatedAt: new Date().toISOString(),
          claudeSessionActive: true
        })

        return { success: true, validation }
      }

      return { success: false, validation }
    } catch (error) {
      log.error(`Failed to validate teleport for ${agentId}`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agents:approvePlan', async (_event, superAgentId: string, planId: string) => {
    const projectPath = await findProjectForAgent(superAgentId)
    const childAgent = await services!.agent.approvePlan(projectPath, superAgentId, planId)
    // Auto-start the child agent with the prompt and model from the plan
    await services!.terminal.startAgent(projectPath, childAgent.agentId, childAgent.tool, childAgent.mode, childAgent.prompt, childAgent.model, childAgent.yolo, childAgent.chrome !== false)
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
    log.debug('[IPC] plainTerminal:start called with:', { agentId, terminalId })
    try {
      const projectPath = await findProjectForAgent(agentId)
      log.debug('[IPC] Found project path for agent:', { agentId, projectPath })
      return services!.terminal.startPlainTerminal(projectPath, agentId, terminalId)
    } catch (error) {
      log.error('[IPC] Failed to start plain terminal:', error)
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
            assignment.yolo,
            assignment.chrome
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          log.error('Failed to auto-start agent', error)
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
            assignment.yolo,
            assignment.chrome
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          log.error('Failed to auto-start agent', error)
        }
      }, 2000) // Wait 2 seconds for worktree to be fully set up
    }
    
    return result
  })

  ipcMain.handle('assignments:createSuper', async (_event, projectPath: string, assignment: any) => {
    // Set the active workflow for this project if provided
    if (assignment.workflow) {
      log.info('Creating super minion with workflow:', {
        projectPath,
        workflowId: assignment.workflow.id,
        hasSteps: !!assignment.workflow.steps,
        stepCount: assignment.workflow.steps?.length
      })
      services!.workflow.setActiveWorkflow(projectPath, assignment.workflow)
    } else {
      log.warn('Creating super minion WITHOUT workflow - will use default')
    }

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
            assignment.model,
            assignment.yolo || false,
            assignment.chrome !== false
          )
          mainWindow?.webContents.send('agents:updated')
        } catch (error) {
          log.error('Failed to auto-start super minion', error)
        }
      }, 2000)
    }

    return result
  })

  ipcMain.handle('assignments:teleport', async (_event, projectPath: string, cloudSessionIdOrUrl: string) => {
    log.debug('[IPC] Handling assignments:teleport for:', projectPath || '(auto-detect)', 'input:', cloudSessionIdOrUrl)

    // 1. Parse and validate the input using TeleportService
    // Supports raw session ID, full URL, or CLI command format
    const parsedSessionId = services!.teleport.parseSessionId(cloudSessionIdOrUrl)

    if (!parsedSessionId) {
      throw new Error(
        `Invalid session ID format. Expected 'session_...' but got '${cloudSessionIdOrUrl}'. ` +
        'Supported formats: session ID (session_xxx), URL (https://claude.ai/code/session_xxx), ' +
        'or CLI command (claude --teleport session_xxx)'
      )
    }

    // 2. Determine project path - use provided path or fall back to first active project
    let resolvedProjectPath = projectPath
    if (!resolvedProjectPath) {
      const activeProjects = services!.project.getActiveProjects()
      log.debug('[IPC] No project path provided, checking active projects:', activeProjects.length)

      if (activeProjects.length === 0) {
        throw new Error('No project selected. Please add a project first before teleporting.')
      }

      // Use the first active project as fallback
      resolvedProjectPath = activeProjects[0].path
      log.debug('[IPC] Auto-detected project path:', resolvedProjectPath)
    }

    // Extract short session ID for branch naming (e.g., 'session_01CVbxti...' -> '01CVbxti')
    const shortSessionId = parsedSessionId.replace('session_', '').substring(0, 8)
    const branchName = `teleport-${shortSessionId}`

    // 3. Create a new worktree/branch for this teleported session
    const assignment = {
      branch: branchName,
      feature: `Teleported session ${shortSessionId}`,
      tool: 'claude',
      mode: 'dev' as const,
      chrome: true
    }

    try {
      const result = await services!.agent.createAssignment(resolvedProjectPath, assignment)
      log.debug('[IPC] Created teleport assignment:', result.agentId)

      // Trigger updates after worktree is created
      setTimeout(() => {
        mainWindow?.webContents.send('agents:updated')
        mainWindow?.webContents.send('assignments:updated')
      }, 1000)

      // 4. Start the agent with the teleportSessionId parameter
      setTimeout(async () => {
        try {
          await services!.terminal.startAgent(
            resolvedProjectPath,
            result.agentId,
            'claude',
            'dev',
            undefined,  // No prompt - teleporting existing session
            undefined,  // No model override - use session's model
            false,      // yolo
            true,       // chrome
            parsedSessionId  // Pass the validated cloud session ID for teleporting
          )
          mainWindow?.webContents.send('agents:updated')
          log.debug('[IPC] Started teleported agent:', result.agentId)

          // 5. Branch detection is now handled by late detection in TerminalService polling
          // The initial JSONL is usually empty for teleported sessions, so we rely on
          // late detection after the first user interaction populates the file
          log.debug('[IPC] Branch detection will happen via late detection in polling loop')

        } catch (error) {
          log.error('Failed to start teleported agent', error)
          throw error
        }
      }, 2000) // Wait 2 seconds for worktree to be fully set up

      return { agentId: result.agentId }
    } catch (error: any) {
      log.error('[IPC] Failed to teleport session:', error)
      throw new Error(`Failed to teleport session: ${error.message}`)
    }
  })

  ipcMain.handle('assignments:update', async (_event, assignmentId: string, updates: any) => {
    const projectPath = await findProjectForAssignment(assignmentId)
    return services!.agent.updateAssignment(projectPath, assignmentId, updates)
  })

  ipcMain.handle('agents:saveUIState', async (_event, agentId: string, uiState: any) => {
    try {
      const projectPath = await findProjectForAgent(agentId)
      return services!.agent.saveUIState(projectPath, agentId, uiState)
    } catch (error) {
      // Agent may have been deleted while debounced save was pending - this is not a critical error
      if (error instanceof Error && error.message.includes('not found')) {
        log.debug(`saveUIState skipped for ${agentId}: agent no longer exists`)
        return
      }
      throw error
    }
  })

  ipcMain.handle('assignments:createPR', async (_event, assignmentId: string, autoCommit: boolean = false) => {
    const projectPath = await findProjectForAssignment(assignmentId)

    log.debug('[PR] Creating pull request for assignment:', assignmentId, 'autoCommit:', autoCommit)
    const result = await services!.agent.createPullRequest(projectPath, assignmentId, autoCommit)
    log.debug('[PR] Pull request created:', result.url)

    mainWindow?.webContents.send('assignments:updated')
    
    return result
  })

  ipcMain.handle('assignments:checkPR', async (_event, assignmentId: string) => {
    const projectPath = await findProjectForAssignment(assignmentId)

    log.debug('[PR] Checking PR status for assignment:', assignmentId)
    const result = await services!.agent.checkPullRequestStatus(projectPath, assignmentId)
    log.debug('[PR] PR status:', result.status)

    mainWindow?.webContents.send('assignments:updated')

    return result
  })

  ipcMain.handle('assignments:detectPR', async (_event, assignmentId: string, force?: boolean) => {
    const projectPath = await findProjectForAssignment(assignmentId)
    return services!.agent.detectExistingPullRequest(projectPath, assignmentId, { force })
  })

  // PR Polling handlers
  ipcMain.handle('prPolling:start', async (_event, assignmentId: string, subscriberId: string) => {
    if (!services?.prPolling) return
    await services.prPolling.startPolling(assignmentId, subscriberId)
  })

  ipcMain.handle('prPolling:stop', async (_event, assignmentId: string, subscriberId: string) => {
    if (!services?.prPolling) return
    await services.prPolling.stopPolling(assignmentId, subscriberId)
  })

  ipcMain.handle('prPolling:stopAll', async (_event, subscriberId: string) => {
    if (!services?.prPolling) return
    await services.prPolling.stopAllPolling(subscriberId)
  })

  ipcMain.handle('prPolling:refreshNow', async (_event, assignmentId: string) => {
    if (!services?.prPolling) return
    await services.prPolling.refreshPRNow(assignmentId)
  })

  ipcMain.handle('dependencies:check', async () => {
    return services!.agent.checkDependencies()
  })

  // Cleanup handlers
  ipcMain.handle('agents:teardown', async (_event, agentId: string, force: boolean) => {
    // Use cached project path if available, otherwise search
    let projectPath = agentProjectCache.get(agentId)
    let agent: any = null

    if (projectPath) {
      // Verify agent still exists in cached project
      const agents = await services!.agent.listAgents(projectPath)
      agent = agents.find(a => a.id === agentId)
      if (!agent) {
        // Cache was stale, clear and search
        agentProjectCache.delete(agentId)
        projectPath = undefined
      }
    }

    if (!projectPath) {
      // Fallback to searching all projects
      const activeProjects = services!.project.getActiveProjects()
      for (const project of activeProjects) {
        const agents = await services!.agent.listAgents(project.path)
        const found = agents.find(a => a.id === agentId)
        if (found) {
          projectPath = project.path
          agent = found
          break
        }
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
      log.error('Failed to stop test environments', error)
    }

    await services!.agent.teardownAgent(projectPath, agentId, force)

    // Clear cache for this agent
    clearAgentCache(agentId)

    // Trigger updates
    mainWindow?.webContents.send('agents:updated')
    mainWindow?.webContents.send('assignments:updated')
  })

  ipcMain.handle('agents:unassign', async (_event, agentId: string) => {
    // Use cached project path, fallback to findProjectForAgent
    const projectPath = await findProjectForAgent(agentId)
    const agents = await services!.agent.listAgents(projectPath)
    const agent = agents.find(a => a.id === agentId)

    if (!agent) throw new Error(`Agent ${agentId} not found`)

    // Prevent unassign of base branch agents
    if (agent.isBaseBranchAgent) {
      throw new Error('Cannot unassign base branch agent')
    }

    await services!.agent.unassignAgent(projectPath, agentId)

    // Trigger updates
    mainWindow?.webContents.send('agents:updated')
    mainWindow?.webContents.send('assignments:updated')
  })

  ipcMain.handle('agents:retry-resume', async (_event, agentId: string) => {
    const activeProjects = services!.project.getActiveProjects()
    let projectPath: string | null = null

    for (const project of activeProjects) {
      const agents = await services!.agent.listAgents(project.path)
      const found = agents.find(a => a.id === agentId)
      if (found) {
        projectPath = project.path
        break
      }
    }

    if (!projectPath) throw new Error(`Agent ${agentId} not found in any active project`)

    await services!.terminal.retryResumeSession(projectPath, agentId)
    mainWindow?.webContents.send('agents:updated')
  })

  ipcMain.handle('agents:start-fresh', async (_event, agentId: string) => {
    const activeProjects = services!.project.getActiveProjects()
    let projectPath: string | null = null

    for (const project of activeProjects) {
      const agents = await services!.agent.listAgents(project.path)
      const found = agents.find(a => a.id === agentId)
      if (found) {
        projectPath = project.path
        break
      }
    }

    if (!projectPath) throw new Error(`Agent ${agentId} not found in any active project`)

    await services!.terminal.startFreshSession(projectPath, agentId)
    mainWindow?.webContents.send('agents:updated')
  })

  // Archive handlers
  ipcMain.handle('archive:list', async (_event, projectPath?: string) => {
    log.info(`[DEBUG] archive:list IPC handler called with projectPath: ${projectPath}`)
    const currentProject = services!.project.getCurrentProject()
    log.info(`[DEBUG] getCurrentProject returned: ${currentProject?.path || 'null'}`)
    const path = projectPath || currentProject?.path
    log.info(`[DEBUG] Using path: ${path}`)
    if (!path) {
      log.info(`[DEBUG] No path, returning empty array`)
      return []
    }
    const result = await services!.agent.listArchivedAgents(path)
    log.info(`[DEBUG] listArchivedAgents returned ${result.length} archives`)
    return result
  })

  ipcMain.handle('archive:get', async (_event, projectPath: string, archiveId: string) => {
    if (!projectPath) return null
    return services!.agent.getArchivedAgent(projectPath, archiveId)
  })

  ipcMain.handle('archive:restore', async (_event, projectPath: string, archiveId: string) => {
    if (!projectPath || !archiveId) {
      throw new Error('Project path and archive ID are required')
    }
    const agent = await services!.agent.restoreArchivedAgent(projectPath, archiveId)
    mainWindow?.webContents.send('agents:updated')
    return agent
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

  // Settings handlers
  ipcMain.handle('settings:get', async () => {
    return services!.settings.getSettings()
  })

  ipcMain.handle('settings:update', async (_event, updates: Partial<import('../shared/types/settings').AppSettings>) => {
    return services!.settings.updateSettings(updates)
  })

  ipcMain.handle('settings:openFeedback', async () => {
    const { shell } = require('electron')
    const feedbackUrl = 'https://github.com/yhindy/agent_framework/issues/new'
    await shell.openExternal(feedbackUrl)
  })

  // Terminal handlers
  ipcMain.handle('terminal:checkTmux', async () => {
    return services!.terminal.isTmuxAvailable()
  })

  // Claude Session Info APIs
  ipcMain.handle('claude:getSessionInfo', async (_event, agentId: string) => {
    // Find the agent to get its worktree path and session ID
    const activeProjects = services!.project.getActiveProjects()
    for (const project of activeProjects) {
      const agents = await services!.agent.listAgents(project.path)
      const agent = agents.find(a => a.id === agentId)
      if (agent && agent.claudeSessionId) {
        const info = await services!.claudeSessionInfo.parseSessionInfo(
          agent.claudeSessionId,
          agent.worktreePath
        )
        return info
      }
    }
    return null
  })

  // Workflow Config APIs (Simplified)
  ipcMain.handle('workflow:getSubagentTypes', async () => {
    return services!.workflow.getSubagentTypes()
  })

  ipcMain.handle('workflow:getActiveWorkflow', async (_event, projectPath: string) => {
    return services!.workflow.getActiveWorkflow(projectPath)
  })

  ipcMain.handle('workflow:getAllWorkflows', async () => {
    return services!.workflow.getAllWorkflows()
  })

  ipcMain.handle('workflow:getWorkflow', async (_event, workflowId: string) => {
    return services!.workflow.getWorkflow(workflowId)
  })

  ipcMain.handle('workflow:createWorkflow', async (_event, name: string, description?: string) => {
    return services!.workflow.createWorkflow(name, description)
  })

  ipcMain.handle('workflow:updateWorkflow', async (_event, workflowId: string, updates: Partial<WorkflowConfig>) => {
    return services!.workflow.updateWorkflow(workflowId, updates)
  })

  ipcMain.handle('workflow:deleteWorkflow', async (_event, workflowId: string) => {
    return services!.workflow.deleteWorkflow(workflowId)
  })

  ipcMain.handle('workflow:addStep', async (_event, workflowId: string, name: string, agents: string[]) => {
    return services!.workflow.addStep(workflowId, name, agents)
  })

  ipcMain.handle('workflow:updateStep', async (_event, workflowId: string, stepId: string, updates: Partial<WorkflowStep>) => {
    return services!.workflow.updateStep(workflowId, stepId, updates)
  })

  ipcMain.handle('workflow:removeStep', async (_event, workflowId: string, stepId: string) => {
    return services!.workflow.removeStep(workflowId, stepId)
  })

  ipcMain.handle('workflow:generateRules', async (_event, workflowId: string) => {
    const workflow = services!.workflow.getWorkflow(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)
    return services!.workflow.generateRulesMarkdown(workflow)
  })

  // Setup Wizard handlers
  ipcMain.handle('wizard:check', async (_event, projectPath: string) => {
    return {
      needsWizard: services!.setupWizard.needsWizard(projectPath),
      hasLegacy: services!.setupWizard.hasLegacyStructure(projectPath)
    }
  })

  ipcMain.handle('wizard:start', async (_event, projectPath: string) => {
    return services!.setupWizard.startWizard(projectPath)
  })

  ipcMain.handle('wizard:cancel', async (_event, sessionId: string) => {
    return services!.setupWizard.cancelWizard(sessionId)
  })

  ipcMain.handle('wizard:finalize', async (_event, projectPath: string, config: any) => {
    return services!.setupWizard.finalizeSetup(projectPath, config)
  })

  ipcMain.handle('wizard:quickSetup', async (_event, projectPath: string) => {
    return services!.setupWizard.quickSetup(projectPath)
  })

  // Migration handler
  ipcMain.handle('project:migrate', async (_event, projectPath: string) => {
    return services!.minionsConfig.migrateFromLegacy(projectPath)
  })

  // Claude Config handlers
  ipcMain.handle('claudeConfig:check', async () => {
    return services!.claudeConfig.isClaudeCodeInstalled()
  })

  ipcMain.handle('claudeConfig:scan', async () => {
    return services!.claudeConfig.scanConfigs()
  })

  ipcMain.handle('claudeConfig:refresh', async () => {
    return services!.claudeConfig.refresh()
  })

  ipcMain.handle('claudeConfig:getEnabled', async () => {
    return services!.claudeConfig.getEnabledImports()
  })

  ipcMain.handle('claudeConfig:getSettings', async () => {
    return services!.claudeConfig.getSettings()
  })

  ipcMain.handle('claudeConfig:setEnabled', async (_event, updates: Partial<ClaudeConfigSettings>) => {
    const updatedSettings = services!.claudeConfig.updateSettings(updates)

    // Persist to settings service
    await services!.settings.updateSettings({ claudeConfig: updatedSettings })

    // Update watching state based on autoRefresh setting
    if (updates.autoRefresh !== undefined) {
      if (updates.autoRefresh) {
        services!.claudeConfig.startWatching()
      } else {
        services!.claudeConfig.stopWatching()
      }
    }

    return updatedSettings
  })

  ipcMain.handle('claudeConfig:getScanResult', async () => {
    return services!.claudeConfig.getScanResult()
  })
}

app.whenReady().then(() => {
  // Disable crash reporter in test mode to prevent macOS crash dialogs
  if (process.env.E2E_TEST === 'true' || process.env.NODE_ENV === 'test') {
    crashReporter.start({
      submitURL: '',
      uploadToServer: false,
    })
  }

  const branch = getCurrentBranch()
  const appName = branch && branch !== 'unknown' ? `Minion Laboratory -- ${branch}` : 'Minion Laboratory'
  app.setName(appName)
  electronApp.setAppUserModelId('com.minion-laboratory.app')

  // Set app icon for menu bar/dock on macOS
  if (process.platform === 'darwin') {
    try {
      const resourcesPath = join(__dirname, '../../resources')
      const iconPath = join(resourcesPath, 'icon.png')
      app.dock.setIcon(iconPath)
    } catch (error) {
      log.warn('Failed to set dock icon', error)
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
    services.claudeConfig.cleanup()
    // MEMORY FIX: Dispose ClaudeSessionInfoService to clean up watchers and cache
    services.claudeSessionInfo.dispose()
    // MEMORY FIX: Dispose PRPollingService to clean up polling jobs
    services.prPolling.dispose()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

