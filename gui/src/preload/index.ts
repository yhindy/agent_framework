import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // Project APIs
  selectProject: (path: string) => ipcRenderer.invoke('project:select', path),
  getRecentProjects: () => ipcRenderer.invoke('project:getRecent'),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),

  // Agent APIs
  listAgents: () => ipcRenderer.invoke('agents:list'),
  startAgent: (agentId: string, tool: string, mode: string, prompt?: string, model?: string) =>
    ipcRenderer.invoke('agents:start', agentId, tool, mode, prompt, model),
  stopAgent: (agentId: string) => ipcRenderer.invoke('agents:stop', agentId),
  openInCursor: (agentId: string) => ipcRenderer.invoke('agents:openCursor', agentId),
  clearUnread: (agentId: string) => ipcRenderer.invoke('agents:clearUnread', agentId),
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

  // Assignment APIs
  getAssignments: () => ipcRenderer.invoke('assignments:get'),
  createAssignment: (assignment: any) => ipcRenderer.invoke('assignments:create', assignment),
  updateAssignment: (assignmentId: string, updates: any) =>
    ipcRenderer.invoke('assignments:update', assignmentId, updates),
  initiateMerge: (assignmentId: string, tool?: string) => ipcRenderer.invoke('assignments:merge', assignmentId, tool),

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
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api

