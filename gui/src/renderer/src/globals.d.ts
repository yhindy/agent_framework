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

      // Multi-project APIs
      addProject: (path: string) => Promise<any>
      removeProject: (path: string) => Promise<void>
      switchProject: (path: string) => Promise<void>
      getActiveProjects: () => Promise<any[]>

      // Agent APIs
      listAgents: () => Promise<any[]>
      listAgentsForProject: (projectPath: string) => Promise<any[]>
      stopAgent: (agentId: string) => Promise<void>
      openInCursor: (agentId: string) => Promise<void>
      clearUnread: (agentId: string) => Promise<void>
      getSuperAgentDetails: (agentId: string) => Promise<any>
      approvePlan: (superAgentId: string, planId: string) => Promise<void>
      teardownAgent: (agentId: string, force: boolean) => Promise<void>
      unassignAgent: (agentId: string) => Promise<void>
      saveUIState: (agentId: string, uiState: any) => Promise<void>

      // Terminal APIs
      sendTerminalInput: (agentId: string, data: string) => void
      resizeTerminal: (agentId: string, cols: number, rows: number) => void
      onTerminalOutput: (callback: (agentId: string, data: string) => void) => () => void

      // Plain Terminal APIs
      startPlainTerminal: (agentId: string, terminalId: string) => Promise<void>
      stopPlainTerminal: (terminalId: string) => Promise<void>
      sendPlainTerminalInput: (terminalId: string, data: string) => void
      resizePlainTerminal: (terminalId: string, cols: number, rows: number) => void
      onPlainTerminalOutput: (callback: (terminalId: string, data: string) => void) => () => void
      onPlainTerminalWaitingForInput: (callback: (terminalId: string, promptText: string) => void) => () => void
      onPlainTerminalResumedWork: (callback: (terminalId: string) => void) => () => void

      // Assignment APIs
      getAssignments: () => Promise<any>
      getAssignmentsForProject: (projectPath: string) => Promise<any>
      createAssignment: (assignment: any) => Promise<any>
      createAssignmentForProject: (projectPath: string, assignment: any) => Promise<any>
      createSuperAssignment: (projectPath: string, assignment: any) => Promise<any>
      teleportFromCloud: (projectPath: string, sessionId: string) => Promise<{ agentId: string }>
      updateAssignment: (assignmentId: string, updates: any) => Promise<void>
      createPullRequest: (assignmentId: string, autoCommit?: boolean) => Promise<{ url: string }>
      checkPullRequestStatus: (assignmentId: string) => Promise<{ status: string; mergedAt?: string }>

      // PR Polling APIs
      startPRPolling: (assignmentId: string, subscriberId: string) => Promise<void>
      stopPRPolling: (assignmentId: string, subscriberId: string) => Promise<void>
      stopAllPRPolling: (subscriberId: string) => Promise<void>
      refreshPRNow: (assignmentId: string) => Promise<void>

      checkDependencies: () => Promise<{ ghInstalled: boolean; ghAuthenticated: boolean; error?: string }>

      // Test Environment APIs
      getTestEnvConfig: (agentId?: string) => Promise<any>
      getTestEnvCommands: (agentId?: string, assignmentOverrides?: any[]) => Promise<any[]>
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
      onAgentListUpdate: (callback: () => void) => () => void
      onAssignmentsUpdate: (callback: () => void) => () => void

      // Agent State APIs
      getAgentState: (agentId: string) => Promise<'working' | 'waiting' | 'unknown'>
      onAgentStateChanged: (callback: (agentId: string, state: 'working' | 'waiting' | 'unknown') => void) => () => void

      // Legacy (use onAgentStateChanged instead)
      onAgentWaitingForInput: (callback: (agentId: string, promptText: string) => void) => () => void
      onAgentResumedWork: (callback: (agentId: string) => void) => () => void

      // Claude Session Info APIs
      getClaudeSessionInfo: (agentId: string) => Promise<any>
      onClaudeSessionInfoUpdated: (callback: (agentId: string, info: any) => void) => () => void

      // Teleport Validation APIs
      validateTeleport: (agentId: string) => Promise<{ success: boolean; validation?: any; error?: string }>
      onTeleportValidationFailed: (callback: (data: { agentId: string; reason: string; canRetry: boolean }) => void) => () => void
      onTeleportResumeFailed: (callback: (data: { agentId: string; reason: string }) => void) => () => void
      retryResumeAgent: (agentId: string) => Promise<void>
      startFreshSession: (agentId: string) => Promise<void>
    }
  }
}

