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

  // Assignment APIs
  getAssignments: () => ipcRenderer.invoke('assignments:get'),
  getAssignmentsForProject: (projectPath: string) => ipcRenderer.invoke('assignments:getForProject', projectPath),
  createAssignment: (assignment: any) => ipcRenderer.invoke('assignments:create', assignment),
  createAssignmentForProject: (projectPath: string, assignment: any) => ipcRenderer.invoke('assignments:createForProject', projectPath, assignment),
  createSuperAssignment: (projectPath: string, assignment: any) => ipcRenderer.invoke('assignments:createSuper', projectPath, assignment),
  updateAssignment: (assignmentId: string, updates: any) =>
    ipcRenderer.invoke('assignments:update', assignmentId, updates),
  createPullRequest: (assignmentId: string, autoCommit?: boolean) => ipcRenderer.invoke('assignments:createPR', assignmentId, autoCommit),
  checkPullRequestStatus: (assignmentId: string) => ipcRenderer.invoke('assignments:checkPR', assignmentId),
  
  // Dependency check
  checkDependencies: () => ipcRenderer.invoke('dependencies:check'),

  // Event listeners
  onAgentSignal: (callback: (agentId: string, signal: string) => void) => {
    const subscription = (_event: any, agentId: string, signal: string) =>
      callback(agentId, signal)
    ipcRenderer.on('agent:signal', subscription)
    return () => ipcRenderer.removeListener('agent:signal', subscription)
  },

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

  // Agent Waiting Events
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
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
