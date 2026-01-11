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
  yolo?: boolean              // Dangerously skip permissions flag
  chrome?: boolean            // Enable Chrome integration (default: true)
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
  cloudSessionId?: string         // Cloud session ID (session_xxx format) for teleport-out
  claudeSessionActive?: boolean   // Is session known to be active and resumable?
  claudeLastSeen?: string        // Last time we saw output from Claude
  isWaitingForInput?: boolean    // Persisted waiting state for notification restoration
  lastOutputSnapshot?: string    // Last ~500 chars of output for resume detection

  // Live session info from Claude's JSONL (updated in real-time)
  actualModel?: string           // Full model name like "claude-haiku-4-5-20251001"
  totalCostUsd?: number          // Running cost for this session
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
  claudeCodeVersion?: string     // Version of Claude Code being used
  claudeState?: 'working' | 'waiting' | 'unknown'  // Current state from JSONL
  modelHistory?: Array<{         // Track model changes during session
    model: string
    timestamp: string
  }>

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

// Re-export TaskInvocation for use in renderer
export type { TaskInvocation } from '../ClaudeSessionInfoService'

export interface SuperAgentInfo extends AgentInfo {
  isSuperMinion: true
  minionBudget: number
  children: AgentInfo[]
  pendingPlans: ChildPlan[]
  taskInvocations: import('../ClaudeSessionInfoService').TaskInvocation[]
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
  mode: 'auto' | 'manual' | 'interactive' | 'planning' | 'dev' | 'idle'
  prUrl?: string
  prStatus?: string
  branch?: string
  worktreePath?: string
  lastActivity?: string
  hasUnread?: boolean
  prompt?: string
  yolo?: boolean
  chrome?: boolean
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

