/**
 * Typed IPC Wrappers for E2E Testing
 *
 * Provides strongly-typed helper functions for interacting with the Electron app
 * via IPC during E2E tests.
 */

import { AppPage } from '../fixtures'

/**
 * Project information returned from IPC calls
 */
export interface ProjectInfo {
  path: string
  name: string
}

/**
 * Assignment creation parameters
 */
export interface CreateAssignmentParams {
  prompt: string
  tool: 'claude' | 'cursor-cli' | 'codex'
  model?: string
  branch?: string
  mode?: 'planning' | 'dev'
  yolo?: boolean
  chrome?: boolean
}

/**
 * Assignment information returned from IPC calls
 */
export interface AssignmentInfo {
  id: string
  agentId: string
  prompt: string
  tool: string
  model?: string
  status: string
  branch: string
  feature: string
  prUrl?: string
  prStatus?: string
}

/**
 * Agent information returned from IPC calls
 */
export interface AgentInfo {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  state?: string
  isWorking?: boolean
  isSuperMinion?: boolean
  isBaseBranchAgent?: boolean
}

/**
 * Application settings structure
 */
export interface AppSettingsInfo {
  notifications: {
    enabled: boolean
    cooldownSeconds: number
  }
  defaultTool: {
    tool: string
    claudeModel: string
    cursorCLIModel: string
  }
  defaultAgent: {
    workflowMode: string
    yoloMode: boolean
    chromeIntegration: boolean
  }
  terminal: {
    terminalMode: string
  }
}

/**
 * Dependency check result
 */
export interface DependencyCheckResult {
  ghInstalled: boolean
  ghAuthenticated: boolean
  error?: string
}

/**
 * Creates typed IPC helpers for interacting with the Electron app during E2E tests.
 */
export function createIPCHelpers(appPage: AppPage) {
  return {
    // Project APIs
    selectProject: (path: string): Promise<void> =>
      appPage.callIPC('selectProject', path),

    getCurrentProject: (): Promise<string | null> =>
      appPage.callIPC<string | null>('getCurrentProject'),

    getRecentProjects: (): Promise<ProjectInfo[]> =>
      appPage.callIPC<ProjectInfo[]>('getRecentProjects'),

    // Agent APIs
    listAgents: (): Promise<AgentInfo[]> =>
      appPage.callIPC<AgentInfo[]>('listAgents'),

    createAssignment: (params: CreateAssignmentParams): Promise<AssignmentInfo> =>
      appPage.callIPC<AssignmentInfo>('createAssignment', params),

    getAssignments: (): Promise<{ assignments: AssignmentInfo[] }> =>
      appPage.callIPC<{ assignments: AssignmentInfo[] }>('getAssignments'),

    stopAgent: (agentId: string): Promise<void> =>
      appPage.callIPC('stopAgent', agentId),

    teardownAgent: (agentId: string, force?: boolean): Promise<void> =>
      appPage.callIPC('teardownAgent', agentId, force),

    getAgentState: (agentId: string): Promise<string> =>
      appPage.callIPC<string>('getAgentState', agentId),

    // Settings APIs
    getSettings: (): Promise<AppSettingsInfo> =>
      appPage.callIPC<AppSettingsInfo>('getSettings'),

    updateSettings: (updates: Partial<AppSettingsInfo>): Promise<AppSettingsInfo> =>
      appPage.callIPC<AppSettingsInfo>('updateSettings', updates),

    // Dependency APIs
    checkDependencies: (): Promise<DependencyCheckResult> =>
      appPage.callIPC<DependencyCheckResult>('checkDependencies'),

    // Terminal APIs
    checkTmuxAvailable: (): Promise<boolean> =>
      appPage.callIPC<boolean>('terminal:checkTmux'),

    // PR APIs
    createPullRequest: (assignmentId: string, autoCommit?: boolean): Promise<{ url: string }> =>
      appPage.callIPC<{ url: string }>('createPullRequest', assignmentId, autoCommit),

    checkPullRequestStatus: (assignmentId: string): Promise<{ status: string }> =>
      appPage.callIPC<{ status: string }>('checkPullRequestStatus', assignmentId),
  }
}

/**
 * Type for the IPC helpers object
 */
export type IPCHelpers = ReturnType<typeof createIPCHelpers>
