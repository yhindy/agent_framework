export {}

declare global {
  interface Window {
    electronAPI: {
      // Project APIs
      selectProject: (path: string) => Promise<any>
      getRecentProjects: () => Promise<any[]>
      getCurrentProject: () => Promise<any>

      // Agent APIs
      listAgents: () => Promise<any[]>
      stopAgent: (agentId: string) => Promise<void>
      openInCursor: (agentId: string) => Promise<void>
      clearUnread: (agentId: string) => Promise<void>
      teardownAgent: (agentId: string, force: boolean) => Promise<void>
      unassignAgent: (agentId: string) => Promise<void>

      // Terminal APIs
      sendTerminalInput: (agentId: string, data: string) => void
      resizeTerminal: (agentId: string, cols: number, rows: number) => void
      onTerminalOutput: (callback: (agentId: string, data: string) => void) => () => void

      // Assignment APIs
      getAssignments: () => Promise<any>
      createAssignment: (assignment: any) => Promise<any>
      updateAssignment: (assignmentId: string, updates: any) => Promise<void>

      // Event listeners
      onAgentSignal: (callback: (agentId: string, signal: string) => void) => () => void
      onAgentListUpdate: (callback: () => void) => () => void
      onAssignmentsUpdate: (callback: () => void) => () => void
    }
  }
}

