export {}

declare global {
  interface Window {
    electronAPI: {
      // Project APIs
      selectProject: (path: string) => Promise<any>
      installFramework: (path: string) => Promise<any>
      getRecentProjects: () => Promise<any[]>
      getCurrentProject: () => Promise<any>
      clearCurrentProject: () => Promise<void>

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
      createPullRequest: (assignmentId: string, autoCommit?: boolean) => Promise<{ url: string }>
      checkPullRequestStatus: (assignmentId: string) => Promise<{ status: string; mergedAt?: string }>
      checkDependencies: () => Promise<{ ghInstalled: boolean; ghAuthenticated: boolean; error?: string }>

      // Test Environment APIs
      getTestEnvConfig: () => Promise<any>
      getTestEnvCommands: (assignmentOverrides?: any[]) => Promise<any[]>
      startTestEnv: (agentId: string, commandId?: string) => Promise<void>
      stopTestEnv: (agentId: string, commandId?: string) => Promise<void>
      getTestEnvStatus: (agentId: string) => Promise<any[]>
      sendTestEnvInput: (agentId: string, commandId: string, data: string) => void
      resizeTestEnv: (agentId: string, commandId: string, cols: number, rows: number) => void
      onTestEnvOutput: (callback: (agentId: string, commandId: string, data: string) => void) => () => void
      onTestEnvStarted: (callback: (agentId: string, commandId: string) => void) => () => void
      onTestEnvStopped: (callback: (agentId: string, commandId: string) => void) => () => void
      onTestEnvExited: (callback: (agentId: string, commandId: string, exitCode: number) => void) => () => void

      // Event listeners
      onAgentSignal: (callback: (agentId: string, signal: string) => void) => () => void
      onAgentListUpdate: (callback: () => void) => () => void
      onAssignmentsUpdate: (callback: () => void) => () => void
    }
  }
}

