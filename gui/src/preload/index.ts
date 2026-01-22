import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // Project APIs
  selectProject: (path: string) => ipcRenderer.invoke('project:select', path),
  installFramework: (path: string) => ipcRenderer.invoke('project:install', path),
  getRecentProjects: () => ipcRenderer.invoke('project:getRecent'),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),
  clearCurrentProject: () => ipcRenderer.invoke('project:clear'),
  
  // Multi-project APIs
  addProject: (path: string) => ipcRenderer.invoke('project:add', path),
  removeProject: (path: string) => ipcRenderer.invoke('project:remove', path),
  switchProject: (path: string) => ipcRenderer.invoke('project:switch', path),
  getActiveProjects: () => ipcRenderer.invoke('project:getActive'),

  // Agent APIs
  listAgents: () => ipcRenderer.invoke('agents:list'),
  listAgentsForProject: (projectPath: string) => ipcRenderer.invoke('agents:listForProject', projectPath),
  stopAgent: (agentId: string) => ipcRenderer.invoke('agents:stop', agentId),
  openInCursor: (agentId: string) => ipcRenderer.invoke('agents:openCursor', agentId),
  clearUnread: (agentId: string) => ipcRenderer.invoke('agents:clearUnread', agentId),
  getSuperAgentDetails: (agentId: string) => ipcRenderer.invoke('agents:getSuperDetails', agentId),
  approvePlan: (superAgentId: string, planId: string) => ipcRenderer.invoke('agents:approvePlan', superAgentId, planId),
  teardownAgent: (agentId: string, force: boolean) => ipcRenderer.invoke('agents:teardown', agentId, force),
  unassignAgent: (agentId: string) => ipcRenderer.invoke('agents:unassign', agentId),
  saveUIState: (agentId: string, uiState: any) => ipcRenderer.invoke('agents:saveUIState', agentId, uiState),
  retryResumeAgent: (agentId: string) => ipcRenderer.invoke('agents:retry-resume', agentId),
  startFreshSession: (agentId: string) => ipcRenderer.invoke('agents:start-fresh', agentId),

  // Terminal APIs
  sendTerminalInput: (agentId: string, data: string) =>
    ipcRenderer.send('terminal:input', agentId, data),
  resizeTerminal: (agentId: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', agentId, cols, rows),
  onTerminalOutput: (callback: (agentId: string, data: string) => void) => {
    const subscription = (_event: any, agentId: string, data: string) => callback(agentId, data)
    ipcRenderer.on('terminal:output', subscription)
    return () => ipcRenderer.removeListener('terminal:output', subscription)
  },

  // Plain Terminal APIs
  startPlainTerminal: (agentId: string, terminalId: string) => ipcRenderer.invoke('plainTerminal:start', agentId, terminalId),
  stopPlainTerminal: (terminalId: string) => ipcRenderer.invoke('plainTerminal:stop', terminalId),
  sendPlainTerminalInput: (terminalId: string, data: string) =>
    ipcRenderer.send('plainTerminal:input', terminalId, data),
  resizePlainTerminal: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.send('plainTerminal:resize', terminalId, cols, rows),
  onPlainTerminalOutput: (callback: (terminalId: string, data: string) => void) => {
    const subscription = (_event: any, terminalId: string, data: string) => callback(terminalId, data)
    ipcRenderer.on('plainTerminal:output', subscription)
    return () => ipcRenderer.removeListener('plainTerminal:output', subscription)
  },

  // Plain Terminal Waiting Events
  onPlainTerminalWaitingForInput: (callback: (terminalId: string, promptText: string) => void) => {
    const subscription = (_event: any, terminalId: string, promptText: string) =>
      callback(terminalId, promptText)
    ipcRenderer.on('plainTerminal:waitingForInput', subscription)
    return () => ipcRenderer.removeListener('plainTerminal:waitingForInput', subscription)
  },

  onPlainTerminalResumedWork: (callback: (terminalId: string) => void) => {
    const subscription = (_event: any, terminalId: string) => callback(terminalId)
    ipcRenderer.on('plainTerminal:resumedWork', subscription)
    return () => ipcRenderer.removeListener('plainTerminal:resumedWork', subscription)
  },

  // Assignment APIs
  getAssignments: () => ipcRenderer.invoke('assignments:get'),
  getAssignmentsForProject: (projectPath: string) => ipcRenderer.invoke('assignments:getForProject', projectPath),
  createAssignment: (assignment: any) => ipcRenderer.invoke('assignments:create', assignment),
  createAssignmentForProject: (projectPath: string, assignment: any) => ipcRenderer.invoke('assignments:createForProject', projectPath, assignment),
  createSuperAssignment: (projectPath: string, assignment: any) => ipcRenderer.invoke('assignments:createSuper', projectPath, assignment),
  teleportFromCloud: (projectPath: string, sessionId: string) => ipcRenderer.invoke('assignments:teleport', projectPath, sessionId),
  updateAssignment: (assignmentId: string, updates: any) =>
    ipcRenderer.invoke('assignments:update', assignmentId, updates),
  createPullRequest: (assignmentId: string, autoCommit?: boolean) => ipcRenderer.invoke('assignments:createPR', assignmentId, autoCommit),
  checkPullRequestStatus: (assignmentId: string) => ipcRenderer.invoke('assignments:checkPR', assignmentId),
  detectPullRequest: (assignmentId: string, force?: boolean) =>
    ipcRenderer.invoke('assignments:detectPR', assignmentId, force),

  // PR Polling APIs
  startPRPolling: (assignmentId: string, subscriberId: string) => ipcRenderer.invoke('prPolling:start', assignmentId, subscriberId),
  stopPRPolling: (assignmentId: string, subscriberId: string) => ipcRenderer.invoke('prPolling:stop', assignmentId, subscriberId),
  stopAllPRPolling: (subscriberId: string) => ipcRenderer.invoke('prPolling:stopAll', subscriberId),
  refreshPRNow: (assignmentId: string) => ipcRenderer.invoke('prPolling:refreshNow', assignmentId),

  // Dependency check
  checkDependencies: () => ipcRenderer.invoke('dependencies:check'),

  // Event listeners
  onAgentListUpdate: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on('agents:updated', subscription)
    return () => ipcRenderer.removeListener('agents:updated', subscription)
  },

  onAssignmentsUpdate: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on('assignments:updated', subscription)
    return () => ipcRenderer.removeListener('assignments:updated', subscription)
  },

  // Agent State APIs
  getAgentState: (agentId: string) => ipcRenderer.invoke('agent:getState', agentId),

  onAgentStateChanged: (callback: (agentId: string, state: 'working' | 'waiting' | 'unknown') => void) => {
    const subscription = (_event: any, agentId: string, state: 'working' | 'waiting' | 'unknown') => {
      callback(agentId, state)
    }
    ipcRenderer.on('agent:stateChanged', subscription)
    return () => ipcRenderer.removeListener('agent:stateChanged', subscription)
  },

  // Agent Waiting Events (legacy, use onAgentStateChanged instead)
  onAgentWaitingForInput: (callback: (agentId: string, promptText: string) => void) => {
    const subscription = (_event: any, agentId: string, promptText: string) =>
      callback(agentId, promptText)
    ipcRenderer.on('agent:waitingForInput', subscription)
    return () => ipcRenderer.removeListener('agent:waitingForInput', subscription)
  },

  onAgentResumedWork: (callback: (agentId: string) => void) => {
    const subscription = (_event: any, agentId: string) => callback(agentId)
    ipcRenderer.on('agent:resumedWork', subscription)
    return () => ipcRenderer.removeListener('agent:resumedWork', subscription)
  },

  onAgentAlreadyAttached: (callback: (agentId: string, details: { sessionName: string; message: string }) => void) => {
    const subscription = (_event: any, agentId: string, details: { sessionName: string; message: string }) =>
      callback(agentId, details)
    ipcRenderer.on('agent:alreadyAttached', subscription)
    return () => ipcRenderer.removeListener('agent:alreadyAttached', subscription)
  },

  // Claude Session Info APIs
  getClaudeSessionInfo: (agentId: string) => ipcRenderer.invoke('claude:getSessionInfo', agentId),
  onClaudeSessionInfoUpdated: (callback: (agentId: string, info: any) => void) => {
    const subscription = (_event: any, agentId: string, info: any) => callback(agentId, info)
    ipcRenderer.on('claude:sessionInfoUpdated', subscription)
    return () => ipcRenderer.removeListener('claude:sessionInfoUpdated', subscription)
  },

  // Settings APIs
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (updates: any) => ipcRenderer.invoke('settings:update', updates),
  openFeedback: () => ipcRenderer.invoke('settings:openFeedback'),

  // Terminal APIs (system capabilities)
  checkTmuxAvailable: () => ipcRenderer.invoke('terminal:checkTmux'),

  // Test Environment APIs
  getTestEnvConfig: (agentId?: string) => ipcRenderer.invoke('testEnv:getConfig', agentId),
  getTestEnvCommands: (agentId?: string, assignmentOverrides?: any[]) => 
    ipcRenderer.invoke('testEnv:getCommands', agentId, assignmentOverrides),
  startTestEnv: (agentId: string, commandId?: string) => ipcRenderer.invoke('testEnv:start', agentId, commandId),
  stopTestEnv: (agentId: string, commandId?: string) => ipcRenderer.invoke('testEnv:stop', agentId, commandId),
  getTestEnvStatus: (agentId: string) => ipcRenderer.invoke('testEnv:getStatus', agentId),
  sendTestEnvInput: (agentId: string, commandId: string, data: string) => 
    ipcRenderer.send('testEnv:input', agentId, commandId, data),
  resizeTestEnv: (agentId: string, commandId: string, cols: number, rows: number) =>
    ipcRenderer.send('testEnv:resize', agentId, commandId, cols, rows),
  
  onTestEnvOutput: (callback: (agentId: string, commandId: string, data: string) => void) => {
    const subscription = (_event: any, agentId: string, commandId: string, data: string) => 
      callback(agentId, commandId, data)
    ipcRenderer.on('testEnv:output', subscription)
    return () => ipcRenderer.removeListener('testEnv:output', subscription)
  },
  
  onTestEnvStarted: (callback: (agentId: string, commandId: string) => void) => {
    const subscription = (_event: any, agentId: string, commandId: string) => 
      callback(agentId, commandId)
    ipcRenderer.on('testEnv:started', subscription)
    return () => ipcRenderer.removeListener('testEnv:started', subscription)
  },
  
  onTestEnvStopped: (callback: (agentId: string, commandId: string) => void) => {
    const subscription = (_event: any, agentId: string, commandId: string) => 
      callback(agentId, commandId)
    ipcRenderer.on('testEnv:stopped', subscription)
    return () => ipcRenderer.removeListener('testEnv:stopped', subscription)
  },
  
  onTestEnvExited: (callback: (agentId: string, commandId: string, exitCode: number) => void) => {
    const subscription = (_event: any, agentId: string, commandId: string, exitCode: number) =>
      callback(agentId, commandId, exitCode)
    ipcRenderer.on('testEnv:exited', subscription)
    return () => ipcRenderer.removeListener('testEnv:exited', subscription)
  },

  // Teleport Validation APIs
  validateTeleport: (agentId: string) => ipcRenderer.invoke('agents:validateTeleport', agentId),

  onTeleportValidationFailed: (callback: (data: { agentId: string; reason: string; canRetry: boolean }) => void) => {
    const subscription = (_event: any, data: { agentId: string; reason: string; canRetry: boolean }) =>
      callback(data)
    ipcRenderer.on('agent:teleportValidationFailed', subscription)
    return () => ipcRenderer.removeListener('agent:teleportValidationFailed', subscription)
  },

  onTeleportResumeFailed: (callback: (data: { agentId: string; reason: string }) => void) => {
    const subscription = (_event: any, data: { agentId: string; reason: string }) =>
      callback(data)
    ipcRenderer.on('agent:resumeFailed', subscription)
    return () => ipcRenderer.removeListener('agent:resumeFailed', subscription)
  },

  // Workflow APIs
  getWorkflowConfig: () => ipcRenderer.invoke('workflow:getAllWorkflows').then((workflows: any[]) => ({ workflows })),
  getSubagentTypes: () => ipcRenderer.invoke('workflow:getSubagentTypes'),
  getActiveWorkflow: (projectPath: string) => ipcRenderer.invoke('workflow:getActiveWorkflow', projectPath),
  getWorkflow: (workflowId: string) => ipcRenderer.invoke('workflow:getWorkflow', workflowId),
  getAllWorkflows: () => ipcRenderer.invoke('workflow:getAllWorkflows'),
  createWorkflow: (name: string, description?: string) => ipcRenderer.invoke('workflow:createWorkflow', name, description),
  updateWorkflow: (workflowId: string, updates: any) => ipcRenderer.invoke('workflow:updateWorkflow', workflowId, updates),
  deleteWorkflow: (workflowId: string) => ipcRenderer.invoke('workflow:deleteWorkflow', workflowId),
  addStep: (workflowId: string, name: string, agents: string[]) => ipcRenderer.invoke('workflow:addStep', workflowId, name, agents),
  updateStep: (workflowId: string, stepId: string, updates: any) => ipcRenderer.invoke('workflow:updateStep', workflowId, stepId, updates),
  removeStep: (workflowId: string, stepId: string) => ipcRenderer.invoke('workflow:removeStep', workflowId, stepId),
  generateRules: (workflowId: string) => ipcRenderer.invoke('workflow:generateRules', workflowId),
  getWorkflowTemplates: () => ipcRenderer.invoke('workflow:getAllWorkflows'),
  saveWorkflowAsTemplate: async (workflow: any, _name: string) => {
    // Check if this workflow ID actually exists in the service
    const allWorkflows = await ipcRenderer.invoke('workflow:getAllWorkflows')
    const existsInService = allWorkflows.some((w: any) => w.id === workflow.id)

    if (existsInService) {
      // Update existing workflow with all fields including steps
      return ipcRenderer.invoke('workflow:updateWorkflow', workflow.id, {
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps
      })
    } else {
      // Create new workflow, then update with steps if any
      const created = await ipcRenderer.invoke('workflow:createWorkflow', workflow.name, workflow.description)
      if (workflow.steps && workflow.steps.length > 0) {
        return ipcRenderer.invoke('workflow:updateWorkflow', created.id, { steps: workflow.steps })
      }
      return created
    }
  },

  // Setup Wizard APIs
  checkWizard: (projectPath: string) => ipcRenderer.invoke('wizard:check', projectPath),
  startWizard: (projectPath: string) => ipcRenderer.invoke('wizard:start', projectPath),
  cancelWizard: (sessionId: string) => ipcRenderer.invoke('wizard:cancel', sessionId),
  finalizeWizard: (projectPath: string, config: any) => ipcRenderer.invoke('wizard:finalize', projectPath, config),
  quickSetup: (projectPath: string) => ipcRenderer.invoke('wizard:quickSetup', projectPath),

  // Migration APIs
  migrateProject: (projectPath: string) => ipcRenderer.invoke('project:migrate', projectPath),

  // Archive APIs
  listArchivedAgents: (projectPath?: string) =>
    ipcRenderer.invoke('archive:list', projectPath),
  getArchivedAgent: (projectPath: string, archiveId: string) =>
    ipcRenderer.invoke('archive:get', projectPath, archiveId),
  restoreArchivedAgent: (projectPath: string, archiveId: string) =>
    ipcRenderer.invoke('archive:restore', projectPath, archiveId),

  // Claude Config APIs
  checkClaudeCode: () => ipcRenderer.invoke('claudeConfig:check'),
  scanClaudeConfig: () => ipcRenderer.invoke('claudeConfig:scan'),
  refreshClaudeConfig: () => ipcRenderer.invoke('claudeConfig:refresh'),
  getClaudeConfigEnabled: () => ipcRenderer.invoke('claudeConfig:getEnabled'),
  getClaudeConfigSettings: () => ipcRenderer.invoke('claudeConfig:getSettings'),
  setClaudeConfigEnabled: (updates: any) => ipcRenderer.invoke('claudeConfig:setEnabled', updates),
  getClaudeConfigScanResult: () => ipcRenderer.invoke('claudeConfig:getScanResult'),

  // Claude Config Event Listeners
  onClaudeConfigUpdated: (callback: (result: any) => void) => {
    const subscription = (_event: any, result: any) => callback(result)
    ipcRenderer.on('claudeConfig:updated', subscription)
    return () => ipcRenderer.removeListener('claudeConfig:updated', subscription)
  },

  // Skills Library APIs
  scanSkillsLibrary: (projectPath?: string) => ipcRenderer.invoke('skillsLibrary:scan', projectPath),
  getSkillsLibraryScanResult: (projectPath?: string) => ipcRenderer.invoke('skillsLibrary:getScanResult', projectPath),
  refreshSkillsLibrary: (projectPath?: string) => ipcRenderer.invoke('skillsLibrary:refresh', projectPath),
  getSkillsLibrarySettings: () => ipcRenderer.invoke('skillsLibrary:getSettings'),
  updateSkillsLibrarySettings: (updates: any) => ipcRenderer.invoke('skillsLibrary:updateSettings', updates),
  getEnabledSkills: (projectPath?: string) => ipcRenderer.invoke('skillsLibrary:getEnabledSkills', projectPath),

  // Unified Skills APIs (combines all sources)
  scanUnifiedSkills: (projectPath?: string) => ipcRenderer.invoke('unifiedSkills:scan', projectPath),
  getUnifiedSkillsScanResult: (projectPath?: string) => ipcRenderer.invoke('unifiedSkills:getScanResult', projectPath),
  refreshUnifiedSkills: (projectPath?: string) => ipcRenderer.invoke('unifiedSkills:refresh', projectPath),
  getUnifiedEnabledSkills: (projectPath?: string) => ipcRenderer.invoke('unifiedSkills:getEnabledSkills', projectPath),
  getSkillById: (skillId: string, projectPath?: string) => ipcRenderer.invoke('unifiedSkills:getSkillById', skillId, projectPath),
  setSkillEnabled: (skillId: string, enabled: boolean) => ipcRenderer.invoke('unifiedSkills:setSkillEnabled', skillId, enabled),
  getSkillsAsSubagentTypes: (projectPath?: string) => ipcRenderer.invoke('unifiedSkills:getSubagentTypes', projectPath),

  // Skills Library Event Listeners
  onSkillsLibraryUpdated: (callback: (result: any) => void) => {
    const subscription = (_event: any, result: any) => callback(result)
    ipcRenderer.on('skillsLibrary:updated', subscription)
    return () => ipcRenderer.removeListener('skillsLibrary:updated', subscription)
  },

  onUnifiedSkillsUpdated: (callback: (result: any) => void) => {
    const subscription = (_event: any, result: any) => callback(result)
    ipcRenderer.on('unifiedSkills:updated', subscription)
    return () => ipcRenderer.removeListener('unifiedSkills:updated', subscription)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
