// UI state for terminal and tab restoration
export interface UIState {
  lastActiveTab: string          // e.g., 'agent', 'terminal-2', 'test-dev'
  plainTerminals: string[]       // e.g., ['terminal-1', 'terminal-2', 'terminal-5']
  terminalCounter: number        // Next terminal ID number
  lastFocusTime: string          // ISO timestamp of last focus change
}

// AgentInfo represents the full state stored in .agent-info file in each worktree
export interface AgentInfo {
  id: string
  agentId: string
  branch: string
  project: string
  feature: string
  status: 'pending' | 'active' | 'in_progress' | 'review' | 'completed' | 'pr_open' | 'merged' | 'closed' | 'blocked' | 'cancelled'
  tool: string
  model?: string
  mode: 'auto' | 'manual' | 'interactive' | 'planning' | 'dev' | 'idle'
  prUrl?: string
  prStatus?: string
  prompt?: string
  specFile?: string
  createdAt: string
  lastActivity: string
  hasUnread?: boolean
  parentAgentId?: string  // Set if this is a child of a super minion
  isBaseBranchAgent?: boolean  // Set for the base branch agent

  // Session persistence fields
  claudeSessionId?: string        // UUID of the Claude session for resume functionality
  claudeSessionActive?: boolean   // Is session known to be active and resumable?
  claudeLastSeen?: string        // Last time we saw output from Claude
  isWaitingForInput?: boolean    // Persisted waiting state for notification restoration
  lastOutputSnapshot?: string    // Last ~500 chars of output for resume detection

  // UI state persistence for terminal/tab restoration
  uiState?: UIState
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

export interface SuperAgentInfo extends AgentInfo {
  isSuperMinion: true
  minionBudget: number
  children: AgentInfo[]
  pendingPlans: ChildPlan[]
}

export function isSuperMinion(agent: AgentInfo): agent is SuperAgentInfo {
  return (agent as any).isSuperMinion === true
}

// @deprecated - Legacy Assignment interface for backward compatibility during migration
// New code should use AgentInfo instead
export interface Assignment {
  id: string
  agentId: string
  feature: string
  status: 'active' | 'completed' | 'cancelled'
  tool: string
  model?: string
  mode: 'auto' | 'manual' | 'interactive'
  prUrl?: string
  prStatus?: string
  branch?: string
  worktreePath?: string
  lastActivity?: string
  hasUnread?: boolean
  prompt?: string
}

export interface TestEnvironment {
  id: string
  name: string
  command: string
  port?: number
  healthCheck?: string
  env?: Record<string, string>
  cwd?: string
}

export interface SetupConfig {
  filesToCopy: Array<{ source: string; destination: string }>
  postSetupCommands: string[]
  requiredFiles: string[]
  preflightCommands: string[]
}

export interface ProjectSettings {
  name: string
  defaultBaseBranch: string
}

export interface ProjectConfig {
  project: ProjectSettings
  setup: SetupConfig
  assignments?: Assignment[]  // @deprecated - will be removed in future, use .agent-info files instead
  testEnvironments: TestEnvironment[]
}

