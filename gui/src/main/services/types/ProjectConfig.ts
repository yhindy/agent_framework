// Re-export MinionsConfig types for convenient imports
export type {
  MinionsConfig,
  MinionsConfigProject,
  MinionsConfigSetup,
  MinionsConfigDetected,
  MinionsConfigWizard,
  WizardSession,
  WizardSessionStatus
} from './MinionsConfig'

export {
  createDefaultMinionsConfig,
  isValidMinionsConfig,
  WIZARD_SESSION_STATUSES,
  DEFAULT_WIZARD_TIMEOUT_MS
} from './MinionsConfig'

// Handoff types for agent-to-agent delegation
export interface HandoffSource {
  agentId: string           // Source agent that initiated the handoff
  branchMode: 'inherit' | 'fresh'  // Did we branch from source or fresh from main
  originalBranch: string    // The branch name of the source agent (for reference)
  handoffTimestamp: string  // ISO timestamp when handoff occurred
}

export interface HandoffRequest {
  sourceAgentId: string
  prompt: string
  branchMode: 'inherit' | 'fresh'  // 'inherit' = branch from source, 'fresh' = branch from main
  tool?: string      // Optional: override tool (default: same as source)
  model?: string     // Optional: override model (default: same as source)
  shortName?: string // Optional: custom branch suffix (default: auto-generated)
  yolo?: boolean     // Optional: inherit yolo mode
  chrome?: boolean   // Optional: inherit chrome flag
}

export interface HandoffResult {
  success: boolean
  newAgent?: AgentInfo
  error?: string
}

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
  displayBranchName?: string  // Custom/detected branch name for display (e.g., from teleport metadata)
  handoffSource?: HandoffSource  // Set if this agent was created via handoff from another agent

  // Session persistence fields
  claudeSessionId?: string        // UUID of the Claude session for resume functionality
  cloudSessionId?: string         // Cloud session ID (session_xxx format) for teleport-out
  isTeleportedSession?: boolean   // Explicitly mark if this was a teleported session
  lastValidatedAt?: string        // ISO timestamp of last successful validation
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
  waitingSince?: string          // ISO timestamp when agent started waiting (for auto-transition)
  modelHistory?: Array<{         // Track model changes during session
    model: string
    timestamp: string
  }>

  // UI state persistence for terminal/tab restoration
  uiState?: UIState

  // Session resume error tracking
  failureReason?: string          // Why session resume failed (if applicable)
  resumeAttempts?: number         // Number of times we've tried to resume
  lastResumeAttempt?: string      // ISO timestamp of last resume attempt
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
  children: AgentInfo[]
  pendingPlans: ChildPlan[]
  taskInvocations: import('../ClaudeSessionInfoService').TaskInvocation[]
  workflowId?: string  // ID of the workflow selected when this super minion was created
}

export function isSuperMinion(agent: AgentInfo): agent is SuperAgentInfo {
  return (agent as any).isSuperMinion === true
}

/**
 * Represents an archived agent record preserved after teardown.
 * Contains essential metadata for historical tracking.
 */
export interface ArchivedAgent {
  // Archive metadata
  archiveId: string              // Unique: `${agentId}-${timestamp}`
  archivedAt: string             // ISO timestamp
  archiveVersion: number         // Schema version (start at 1)

  // Original agent identification
  agentId: string
  assignmentId: string

  // Task information
  branch: string
  feature: string
  prompt?: string

  // Tool and configuration
  tool: string
  model?: string
  mode: string

  // Timeline
  createdAt: string
  completedAt: string

  // Final status
  finalStatus: string

  // PR information (if applicable)
  prUrl?: string
  prStatus?: string

  // Session metrics (optional)
  totalCostUsd?: number
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }

  // Parent relationship (for super minions)
  parentAgentId?: string
  isSuperMinion?: boolean

  // Handoff source (if created via handoff)
  handoffSource?: HandoffSource
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

