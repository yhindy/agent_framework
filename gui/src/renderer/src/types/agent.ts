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
  id?: string
  agentId: string
  branch?: string
  project?: string
  feature: string
  status?: string
  tool: string
  mode: string
  createdAt?: string
  lastActivity?: string
  terminalPid: number | null
  isSuperMinion: true
  children: AgentInfo[]
  pendingPlans: ChildPlan[]
  taskInvocations?: TaskInvocation[]
  uiState?: UIState
  prUrl?: string
  prStatus?: string
  workflowId?: string  // ID of the workflow selected when this super minion was created
}

export interface AgentInfo {
  id?: string
  agentId: string
  branch?: string
  project?: string
  feature: string
  status?: string
  tool: string
  mode: string
  createdAt?: string
  lastActivity?: string
  terminalPid?: number | null
  parentAgentId?: string
  isSuperMinion?: boolean
}
