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
      openInEditor: (agentId: string) => Promise<void>
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
      detectPullRequest: (assignmentId: string, force?: boolean) => Promise<{
        found: boolean
        prUrl?: string
        prStatus?: string
        createdAt?: string
      } | null>

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

// Agent Start APIs
      ensureAgentRunning: (agentId: string, projectPath?: string) => Promise<{ started: boolean; error?: string }>

      // Handoff APIs
      handoffAgent: (request: import('../../main/services/types/ProjectConfig').HandoffRequest) => Promise<import('../../main/services/types/ProjectConfig').HandoffResult>

      // Settings APIs
      getSettings: () => Promise<import('../../shared/types/settings').AppSettings>
      updateSettings: (updates: Partial<import('../../shared/types/settings').AppSettings>) => Promise<import('../../shared/types/settings').AppSettings>
      openFeedback: () => Promise<void>

      // Terminal Capability APIs
      checkTmuxAvailable: () => Promise<boolean>

      // Workflow APIs
      getWorkflowConfig: () => Promise<{ workflows: import('../../main/services/types/WorkflowTypes').WorkflowConfig[] }>
      getSubagentTypes: () => Promise<import('../../main/services/types/WorkflowTypes').SubagentType[]>
      getActiveWorkflow: (projectPath: string) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig>
      getWorkflow: (workflowId: string) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig | undefined>
      getAllWorkflows: () => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig[]>
      createWorkflow: (name: string, description?: string) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig>
      updateWorkflow: (workflowId: string, updates: Partial<import('../../main/services/types/WorkflowTypes').WorkflowConfig>) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig>
      deleteWorkflow: (workflowId: string) => Promise<void>
      addStep: (workflowId: string, name: string, agents: string[]) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowStep>
      updateStep: (workflowId: string, stepId: string, updates: Partial<import('../../main/services/types/WorkflowTypes').WorkflowStep>) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowStep>
      removeStep: (workflowId: string, stepId: string) => Promise<void>
      generateRules: (workflowId: string) => Promise<string>
      getWorkflowTemplates: () => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig[]>
      saveWorkflowAsTemplate: (workflow: import('../../main/services/types/WorkflowTypes').WorkflowConfig, name: string) => Promise<import('../../main/services/types/WorkflowTypes').WorkflowConfig>

      // Setup Wizard APIs
      checkWizard: (projectPath: string) => Promise<{ needsWizard: boolean; hasLegacy: boolean }>
      startWizard: (projectPath: string) => Promise<any>
      cancelWizard: (sessionId: string) => Promise<void>
      finalizeWizard: (projectPath: string, config: any) => Promise<void>
      quickSetup: (projectPath: string) => Promise<void>

      // Migration APIs
      migrateProject: (projectPath: string) => Promise<any>

      // Archive APIs
      listArchivedAgents: (projectPath?: string) => Promise<import('../../main/services/types/ProjectConfig').ArchivedAgent[]>
      getArchivedAgent: (projectPath: string, archiveId: string) => Promise<import('../../main/services/types/ProjectConfig').ArchivedAgent | null>
      restoreArchivedAgent: (projectPath: string, archiveId: string) => Promise<import('../../main/services/types/ProjectConfig').AgentInfo>

      // Claude Config APIs
      checkClaudeCode: () => Promise<boolean>
      scanClaudeConfig: () => Promise<import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigScanResult>
      refreshClaudeConfig: () => Promise<import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigScanResult>
      getClaudeConfigEnabled: () => Promise<boolean>
      getClaudeConfigSettings: () => Promise<import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigSettings>
      setClaudeConfigEnabled: (updates: Partial<import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigSettings>) => Promise<import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigSettings>
      getClaudeConfigScanResult: () => Promise<import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigScanResult>
      onClaudeConfigUpdated: (callback: (result: import('../../main/services/types/ClaudeConfigTypes').ClaudeConfigScanResult) => void) => () => void

      // Skills Library APIs
      scanSkillsLibrary: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').LibraryScanResult>
      getSkillsLibraryScanResult: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').LibraryScanResult>
      refreshSkillsLibrary: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').LibraryScanResult>
      getSkillsLibrarySettings: () => Promise<import('../../main/services/types/SkillsLibraryTypes').SkillsLibrarySettings>
      updateSkillsLibrarySettings: (updates: Partial<import('../../main/services/types/SkillsLibraryTypes').SkillsLibrarySettings>) => Promise<import('../../main/services/types/SkillsLibraryTypes').SkillsLibrarySettings>
      getEnabledSkills: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').ItemDefinition[]>
      onSkillsLibraryUpdated: (callback: (result: import('../../main/services/types/SkillsLibraryTypes').LibraryScanResult) => void) => () => void

      // Unified Skills APIs
      scanUnifiedSkills: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').UnifiedScanResult>
      getUnifiedSkillsScanResult: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').UnifiedScanResult>
      refreshUnifiedSkills: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').UnifiedScanResult>
      getUnifiedEnabledSkills: (projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').UnifiedItem[]>
      getSkillById: (skillId: string, projectPath?: string) => Promise<import('../../main/services/types/SkillsLibraryTypes').UnifiedItem | undefined>
      setSkillEnabled: (skillId: string, enabled: boolean) => Promise<void>
      getSkillsAsSubagentTypes: (projectPath?: string) => Promise<import('../../main/services/types/WorkflowTypes').SubagentType[]>
      onUnifiedSkillsUpdated: (callback: (result: import('../../main/services/types/SkillsLibraryTypes').UnifiedScanResult) => void) => () => void
    }
  }
}

