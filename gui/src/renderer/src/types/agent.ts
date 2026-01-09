// Re-export types from main process for renderer use
// This avoids direct imports from main process which can cause module resolution issues

// UI state for terminal and tab restoration
export interface UIState {
  lastActiveTab: string          // e.g., 'agent', 'terminal-2', 'test-dev'
  plainTerminals: string[]       // e.g., ['terminal-1', 'terminal-2', 'terminal-5']
  terminalCounter: number        // Next terminal ID number
  lastFocusTime: string          // ISO timestamp of last focus change
}

export interface ChildPlan {
  id: string
  shortName: string
  branch?: string
  description: string
  prompt: string
  estimatedComplexity?: 'small' | 'medium' | 'large'
  status: 'pending' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'failed'
  childAgentId?: string
}

export interface TaskInvocation {
  toolUseId: string
  description: string
  subagentType: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  resultSummary?: string
}

export interface SuperAgentInfo {
  agentId: string
  branch: string
  feature: string
  tool: string
  mode: string
  terminalPid: number | null
  taskInvocations?: TaskInvocation[]
  uiState?: UIState
}
