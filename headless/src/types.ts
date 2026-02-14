// Shared types for the headless API server.

// --- Core agent state (used across AgentManager, StateManager, server) ---

export interface HeadlessAgentState {
  id: string
  agentId: string
  projectPath: string
  status: 'creating' | 'running' | 'completed' | 'failed' | 'stopped'
  branch: string
  tool: string
  model?: string
  prompt?: string
  createdAt: string
  lastActivity: string
  totalCostUsd?: number
  tokenUsage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
  parentAgentId?: string
  handoffSource?: HandoffSource
  spawnSource?: SpawnSource
}

export interface HandoffSource {
  agentId: string
  branchMode: 'inherit' | 'fresh'
  originalBranch: string
  handoffTimestamp: string
}

export interface SpawnSource {
  parentAgentId: string
  spawnTimestamp: string
  workflowId: string
  batchId?: string
}

export interface SpawnResult {
  success: boolean
  agentId?: string
  workflowId?: string
  error?: string
}

// --- Project state (used across ProjectManager, StateManager) ---

export interface ProjectState {
  path: string
  name: string
  lastOpened: string
  needsInstall?: boolean
}

export interface ServerState {
  projects: ProjectState[]
  agents: HeadlessAgentState[]
  startedAt: string
}

// --- Workflow types (used across WorkflowManager, server) ---

export interface WorkflowConfig {
  id: string
  name: string
  description?: string
  steps: Array<{
    id: string
    name: string
    agents: Array<{ id: string; typeId: string; customPrompt?: string }>
  }>
  isDefault?: boolean
}
