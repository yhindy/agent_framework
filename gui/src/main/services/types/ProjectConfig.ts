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

