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
  assignments: Assignment[]
  testEnvironments: TestEnvironment[]
}

