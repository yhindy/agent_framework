import { create } from 'zustand'

export type AgentState = 'working' | 'waiting' | 'unknown'

export interface Project {
  name: string
  path: string
}

export interface HandoffSource {
  agentId: string
  branchMode: 'inherit' | 'fresh'
  originalBranch: string
  handoffTimestamp: string
}

export interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  mode?: string
  tool?: string
  projectPath?: string
  isSuperMinion?: boolean
  parentAgentId?: string
  isBaseBranchAgent?: boolean
  branch?: string
  displayBranchName?: string
  failureReason?: string
  resumeAttempts?: number
  currentState?: string
  handoffSource?: HandoffSource
}

export interface AssignmentsData {
  assignments: AssignmentEntry[]
}

export interface AssignmentEntry {
  id: string
  agentId: string
  branch: string
  feature: string
  status: string
  tool: string
  model?: string
  mode: string
  prUrl?: string
  prStatus?: string
  claudeState?: AgentState
  isWaitingForInput?: boolean
}

interface AgentStoreState {
  // State
  activeProjects: Project[]
  agentsByProject: Record<string, AgentSession[]>
  assignments: Record<string, AssignmentsData>
  agentStates: Record<string, AgentState>

  // Actions
  fetchActiveProjects: () => Promise<void>
  fetchAgentsForProject: (projectPath: string) => Promise<void>
  fetchAgentsForAllProjects: () => Promise<void>
  fetchAssignments: () => Promise<void>
  subscribeToEvents: () => () => void
  refreshAll: () => Promise<void>
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  // Initial state
  activeProjects: [],
  agentsByProject: {},
  assignments: {},
  agentStates: {},

  // Actions
  fetchActiveProjects: async () => {
    try {
      const projects = await window.electronAPI.getActiveProjects()
      set({ activeProjects: projects })
    } catch (error) {
      console.error('[agentStore] Failed to fetch active projects:', error)
    }
  },

  fetchAgentsForProject: async (projectPath: string) => {
    try {
      const agents = await window.electronAPI.listAgentsForProject(projectPath)
      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectPath]: agents
        }
      }))
    } catch (error) {
      console.error(`[agentStore] Failed to fetch agents for ${projectPath}:`, error)
    }
  },

  fetchAgentsForAllProjects: async () => {
    const { activeProjects } = get()
    await Promise.all(activeProjects.map(p => get().fetchAgentsForProject(p.path)))
  },

  fetchAssignments: async () => {
    const { activeProjects } = get()

    const results = await Promise.all(
      activeProjects.map(async (project) => {
        try {
          const data = await window.electronAPI.getAssignmentsForProject(project.path)
          return { path: project.path, data }
        } catch (error) {
          console.error(`[agentStore] Failed to fetch assignments for ${project.path}:`, error)
          return null
        }
      })
    )

    const newAssignments: Record<string, AssignmentsData> = {}
    for (const result of results) {
      if (result) {
        newAssignments[result.path] = result.data
      }
    }

    set({ assignments: newAssignments })
  },

  subscribeToEvents: () => {
    const unsubAgentList = window.electronAPI.onAgentListUpdate(() => {
      get().fetchAgentsForAllProjects()
    })

    const unsubAssignments = window.electronAPI.onAssignmentsUpdate(() => {
      get().fetchAssignments()
    })

    const unsubStateChanged = window.electronAPI.onAgentStateChanged((agentId, state) => {
      set((prev) => ({
        agentStates: {
          ...prev.agentStates,
          [agentId]: state
        }
      }))
    })

    return () => {
      unsubAgentList()
      unsubAssignments()
      unsubStateChanged()
    }
  },

  refreshAll: async () => {
    try {
      await get().fetchActiveProjects()
      await Promise.all([
        get().fetchAgentsForAllProjects(),
        get().fetchAssignments()
      ])
    } catch (error) {
      console.error('[agentStore] Failed to refresh all:', error)
    }
  }
}))
