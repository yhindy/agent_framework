import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ProjectPicker from './ProjectPicker'
import MissionDropdown from './MissionDropdown'
import { extractBranchName } from '../utils/branchUtils'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { useAgentStore } from '../store/agentStore'
import type { Project, AgentSession } from '../store/agentStore'
import {
  BotIcon,
  CrownIcon,
  HomeIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  WarningIcon,
  SyncIcon,
  PlusCircleIcon,
  ClockIcon,
  HourglassIcon,
  CheckIcon,
  XIcon,
  SkillsIcon,
  SatelliteIcon
} from './icons'
import './Sidebar.css'

interface SidebarAgentInfo {
  id: string
  isSuperMinion?: boolean
}

interface SidebarProps {
  activeProjects: Project[]
  onNavigate: (path: string) => void
  onProjectRemove: (path: string) => void
  onProjectAdd: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  onAgentListChange?: (agents: SidebarAgentInfo[]) => void
}

interface TaskInvocation {
  toolUseId: string
  description: string
  subagentType: string
  status: 'running' | 'completed' | 'failed'
}

interface TasksByAgent {
  [agentId: string]: TaskInvocation[]
}

interface TeleportFailure {
  agentId: string
  reason: string
  canRetry: boolean
  timestamp: number
}

/**
 * Helper to remove an item from a Set, returning the same reference if item wasn't present.
 */
function removeFromSet<T>(set: Set<T>, item: T): Set<T> {
  if (!set.has(item)) return set
  const next = new Set(set)
  next.delete(item)
  return next
}

/**
 * Helper to add an item to a Set, returning the same reference if item was already present.
 */
function addToSet<T>(set: Set<T>, item: T): Set<T> {
  if (set.has(item)) return set
  const next = new Set(set)
  next.add(item)
  return next
}

/**
 * Derive UI-specific state (waitingAgents, tasksByAgent, collapse state) from store data.
 * Extracted outside the component to avoid re-creation on every render.
 */
async function deriveAgentUIState(
  activeProjects: Project[],
  collapsedSuperMinionsRef: React.MutableRefObject<Set<string>>,
  hasInitializedSuperMinionCollapse: React.MutableRefObject<boolean>,
  setTasksByAgent: React.Dispatch<React.SetStateAction<TasksByAgent>>,
  setWaitingAgents: React.Dispatch<React.SetStateAction<Set<string>>>,
  setCollapsedSuperMinions: React.Dispatch<React.SetStateAction<Set<string>>>
): Promise<void> {
  const currentAgentsByProject = useAgentStore.getState().agentsByProject
  const currentWaitingAgents = new Set<string>()
  const superMinionIds: string[] = []
  const expandedSuperMinions: string[] = []
  const currentCollapsed = collapsedSuperMinionsRef.current
  const currentAgentStates = useAgentStore.getState().agentStates

  for (const project of activeProjects) {
    const agents = currentAgentsByProject[project.path] || []
    for (const agent of agents) {
      // Check store's agentStates first (most up-to-date), fallback to agent's currentState
      const storeState = currentAgentStates[agent.id]
      const effectiveState = storeState || agent.currentState
      if (effectiveState === 'waiting') {
        currentWaitingAgents.add(agent.id)
      }
      if (agent.isSuperMinion) {
        superMinionIds.push(agent.id)
        if (!currentCollapsed.has(agent.id)) {
          expandedSuperMinions.push(agent.id)
        }
      }
    }
  }

  // Fetch fresh task data for expanded super minions in parallel
  const expandedTaskResults = await Promise.all(
    expandedSuperMinions.map(async (agentId) => {
      try {
        const superDetails = await window.electronAPI.getSuperAgentDetails(agentId)
        return { agentId, tasks: superDetails?.taskInvocations || [] }
      } catch (err) {
        console.error(`Failed to fetch task invocations for ${agentId}:`, err)
        return { agentId, tasks: [] }
      }
    })
  )

  // Update task data: preserve collapsed super minion tasks, update expanded ones
  setTasksByAgent(prevTasks => {
    const newTasks: TasksByAgent = {}
    for (const id of superMinionIds) {
      if (currentCollapsed.has(id) && prevTasks[id]) {
        newTasks[id] = prevTasks[id]
      }
    }
    for (const { agentId, tasks } of expandedTaskResults) {
      newTasks[agentId] = tasks
    }
    return newTasks
  })

  setWaitingAgents(currentWaitingAgents)

  // Initialize collapse state for new super minions on first load
  if (!hasInitializedSuperMinionCollapse.current) {
    setCollapsedSuperMinions(new Set(superMinionIds))
    localStorage.setItem('collapsedSuperMinions', JSON.stringify(superMinionIds))
    hasInitializedSuperMinionCollapse.current = true
  }
}

function Sidebar({ activeProjects, onNavigate, onProjectRemove, onProjectAdd, isCollapsed, onToggleCollapse, onAgentListChange }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const agentsByProject = useAgentStore((s) => s.agentsByProject)
  const agentStates = useAgentStore((s) => s.agentStates)
  const fetchAgentsForAllProjects = useAgentStore((s) => s.fetchAgentsForAllProjects)
  const [tasksByAgent, setTasksByAgent] = useState<TasksByAgent>({})
  const [waitingAgents, setWaitingAgents] = useState<Set<string>>(new Set())
  const [waitingPlainTerminals, setWaitingPlainTerminals] = useState<Set<string>>(new Set())
  const [acknowledgedWaitingAgents, setAcknowledgedWaitingAgents] = useState<Set<string>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [collapsedSuperMinions, setCollapsedSuperMinions] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('collapsedSuperMinions')
    if (!saved) {
      return new Set()
    }
    try {
      return new Set(JSON.parse(saved))
    } catch (e) {
      return new Set()
    }
  })
  const hasInitializedSuperMinionCollapse = useRef(localStorage.getItem('collapsedSuperMinions') !== null)
  const collapsedSuperMinionsRef = useRef(collapsedSuperMinions)
  const [showAddModal, setShowAddModal] = useState(false)
  const [openSubmenuProject, setOpenSubmenuProject] = useState<string | null>(null)
  const [failedTeleportSessions, setFailedTeleportSessions] = useState<Map<string, TeleportFailure>>(new Map())
  const submenuRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())
  const currentPath = location.pathname
  const { showLoading, hideLoading } = useLoadingSnackbar()
  const loadingSnackbarRef = useRef<string | null>(null)
  const isInitialLoadRef = useRef(true)
  const hasCompletedInitialFetchRef = useRef(false)

  // Keep ref in sync with collapsedSuperMinions state
  useEffect(() => {
    collapsedSuperMinionsRef.current = collapsedSuperMinions
  }, [collapsedSuperMinions])

  // Close project submenu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openSubmenuProject) {
        const submenuRef = submenuRefsMap.current.get(openSubmenuProject)
        if (submenuRef && !submenuRef.contains(event.target as Node)) {
          setOpenSubmenuProject(null)
        }
      }
    }

    if (openSubmenuProject) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
    return undefined
  }, [openSubmenuProject])

  // Initial fetch on mount and when activeProjects change
  useEffect(() => {
    const shouldShowIndicator = isInitialLoadRef.current
    isInitialLoadRef.current = false

    const doInitialFetch = async () => {
      if (shouldShowIndicator && activeProjects.length > 0) {
        loadingSnackbarRef.current = showLoading({
          title: 'Loading Projects',
          messages: [
            'Scanning worktrees...',
            'Reading agent info...',
            'Checking session states...'
          ],
          rotationInterval: 1500
        })
      }

      // Fetch agents for each project into the centralized store (initial load)
      // Use the prop's activeProjects since the store may not have them yet
      const store = useAgentStore.getState()
      await Promise.all(activeProjects.map(p => store.fetchAgentsForProject(p.path)))

      // Now derive UI state from the store
      await deriveAgentUIState(activeProjects, collapsedSuperMinionsRef, hasInitializedSuperMinionCollapse, setTasksByAgent, setWaitingAgents, setCollapsedSuperMinions)

      hasCompletedInitialFetchRef.current = true

      if (loadingSnackbarRef.current) {
        hideLoading(loadingSnackbarRef.current)
        loadingSnackbarRef.current = null
      }
    }

    doInitialFetch()
  }, [activeProjects])

  // Re-derive UI state whenever the store's agent data or agent states change
  // (triggered by the store's event subscriptions in App.tsx, NOT duplicate listeners)
  useEffect(() => {
    // Skip during initial mount (handled by the effect above)
    if (!hasCompletedInitialFetchRef.current) return
    deriveAgentUIState(activeProjects, collapsedSuperMinionsRef, hasInitializedSuperMinionCollapse, setTasksByAgent, setWaitingAgents, setCollapsedSuperMinions)
  }, [agentsByProject, agentStates])

  // React to agentStates changes from the store to manage acknowledgedWaitingAgents
  const prevAgentStatesRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const prevStates = prevAgentStatesRef.current
    for (const [agentId, state] of Object.entries(agentStates)) {
      const prevState = prevStates[agentId]
      if (prevState !== state) {
        if (state === 'waiting') {
          setAcknowledgedWaitingAgents(prev => removeFromSet(prev, agentId))
        }
      }
    }
    prevAgentStatesRef.current = agentStates
  }, [agentStates])

  // Subscribe to Sidebar-specific IPC events (NOT handled by the store)
  useEffect(() => {
    // Listen for plain terminal waiting state changes
    const unsubPlainWaiting = window.electronAPI.onPlainTerminalWaitingForInput((terminalId) => {
      const parts = terminalId.split('-')
      const agentId = parts.slice(0, -1).join('-')

      setAcknowledgedWaitingAgents(prev => removeFromSet(prev, agentId))
      setWaitingPlainTerminals(prev => addToSet(prev, terminalId))
    })

    const unsubPlainResumed = window.electronAPI.onPlainTerminalResumedWork((terminalId) => {
      setWaitingPlainTerminals(prev => removeFromSet(prev, terminalId))
    })

    // Listen for teleport validation failures
    const unsubTeleportFailed = window.electronAPI.onTeleportValidationFailed((data) => {
      console.log('[Sidebar] Teleport validation failed:', data)
      setFailedTeleportSessions(prev => {
        const next = new Map(prev)
        next.set(data.agentId, {
          agentId: data.agentId,
          reason: data.reason,
          canRetry: data.canRetry,
          timestamp: Date.now()
        })
        return next
      })
    })

    const unsubResumeFailed = window.electronAPI.onTeleportResumeFailed((data) => {
      console.log('[Sidebar] Teleport resume failed:', data)
      setFailedTeleportSessions(prev => {
        const next = new Map(prev)
        next.set(data.agentId, {
          agentId: data.agentId,
          reason: data.reason,
          canRetry: false,
          timestamp: Date.now()
        })
        return next
      })
    })

    return () => {
      unsubPlainWaiting()
      unsubPlainResumed()
      unsubTeleportFailed()
      unsubResumeFailed()
    }
  }, [])

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('collapsedProjects')
    if (saved) {
      try {
        setCollapsedProjects(new Set(JSON.parse(saved)))
      } catch (e) {
        // ignore
      }
    }
  }, [])

  // Notify parent of agent list changes for keyboard navigation
  // IMPORTANT: This must match the exact visual order in the sidebar
  useEffect(() => {
    if (onAgentListChange) {
      const allAgents: SidebarAgentInfo[] = []

      // Iterate through projects in the same order as activeProjects (matches sidebar render order)
      for (const project of activeProjects) {
        const agents = agentsByProject[project.path] || []
        // Filter out agents with missing/empty critical fields
        const validAgents = agents.filter(a => a.id && a.id.trim() !== '')

        // Apply the SAME sorting as the sidebar display (lines 442-460)
        const sortedAgents = [...validAgents].sort((a, b) => {
          // Base branch agents always first
          if (a.isBaseBranchAgent && !b.isBaseBranchAgent) return -1
          if (!a.isBaseBranchAgent && b.isBaseBranchAgent) return 1

          // Then waiting agents
          const aAgentWaiting = waitingAgents.has(a.id)
          const aPlainWaiting = Array.from(waitingPlainTerminals).some(tid => tid.startsWith(`${a.id}-`))
          const aWaiting = aAgentWaiting || aPlainWaiting

          const bAgentWaiting = waitingAgents.has(b.id)
          const bPlainWaiting = Array.from(waitingPlainTerminals).some(tid => tid.startsWith(`${b.id}-`))
          const bWaiting = bAgentWaiting || bPlainWaiting

          if (aWaiting && !bWaiting) return -1
          if (!aWaiting && bWaiting) return 1

          return a.id.localeCompare(b.id)
        })

        // Build parent-child hierarchy (matches sidebar render logic)
        const roots = sortedAgents.filter(a => !a.parentAgentId)
        const childrenMap: Record<string, AgentSession[]> = {}
        sortedAgents.forEach(a => {
          if (a.parentAgentId) {
            if (!childrenMap[a.parentAgentId]) childrenMap[a.parentAgentId] = []
            childrenMap[a.parentAgentId].push(a)
          }
        })

        // Flatten in visual order: parent, then children recursively
        const flattenWithChildren = (agent: AgentSession): void => {
          allAgents.push({
            id: agent.id,
            isSuperMinion: agent.isSuperMinion
          })
          // Add children in order (only if super minion is not collapsed in sidebar view)
          const children = childrenMap[agent.id] || []
          children.forEach(child => flattenWithChildren(child))
        }

        roots.forEach(root => flattenWithChildren(root))
      }

      onAgentListChange(allAgents)
    }
  }, [agentsByProject, activeProjects, waitingAgents, waitingPlainTerminals, onAgentListChange])

  // Save collapsed state to localStorage
  const toggleProjectCollapse = (projectPath: string) => {
    setCollapsedProjects(prev => {
      const next = new Set(prev)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      localStorage.setItem('collapsedProjects', JSON.stringify([...next]))
      return next
    })
  }

  const toggleSuperMinionCollapse = async (agentId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const isCurrentlyCollapsed = collapsedSuperMinions.has(agentId)

    // If expanding and we don't have task invocations yet, fetch them
    if (isCurrentlyCollapsed && !tasksByAgent[agentId]) {
      try {
        const superDetails = await window.electronAPI.getSuperAgentDetails(agentId)
        if (superDetails?.taskInvocations) {
          setTasksByAgent(prev => ({
            ...prev,
            [agentId]: superDetails.taskInvocations
          }))
        }
      } catch (err) {
        console.error(`Failed to fetch task invocations for ${agentId}:`, err)
      }
    }

    setCollapsedSuperMinions(prev => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      localStorage.setItem('collapsedSuperMinions', JSON.stringify([...next]))
      return next
    })
  }

  const handleNavigate = (path: string) => {
    onNavigate(path)
  }

  const handleAgentClick = async (agent: AgentSession, projectPath: string) => {
    localStorage.setItem('lastSelectedProjectPath', projectPath)
    await window.electronAPI.clearUnread(agent.id)

    // Acknowledge waiting notification when clicking on a waiting agent
    if (isAgentWaitingForInput(agent.id)) {
      setAcknowledgedWaitingAgents(prev => addToSet(prev, agent.id))
    }

    const route = agent.isSuperMinion
      ? `/workspace/super/${agent.id}`
      : `/workspace/agent/${agent.id}`
    handleNavigate(route)
    fetchAgentsForAllProjects() // Refresh to clear unread badge
  }

  const handleAddMinion = (isSuper = false) => {
    const lastProject = localStorage.getItem('lastSelectedProjectPath') || (activeProjects.length > 0 ? activeProjects[0].path : '')
    handleNavigate(`/workspace?create=true&projectPath=${encodeURIComponent(lastProject)}&isSuper=${isSuper}`)
  }

  const handleTeleport = () => {
    const lastProject = localStorage.getItem('lastSelectedProjectPath') || (activeProjects.length > 0 ? activeProjects[0].path : '')
    navigate(`/workspace?teleport=true&projectPath=${encodeURIComponent(lastProject)}`)
  }

  const handleAddProjectClick = () => {
    setShowAddModal(true)
  }

  const handleProjectSelect = async (_project: unknown) => {
    // Project has been added to the store, notify parent to refresh
    console.log('[Sidebar] Project selected, notifying parent to refresh')
    setShowAddModal(false)
    // Trigger parent refresh callback
    onProjectAdd()
  }

  const handleRemoveProject = (projectPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onProjectRemove(projectPath)
  }

  const isHomeActive = currentPath === '/workspace' || currentPath === '/workspace/'
  const isArchiveActive = currentPath === '/workspace/archive'
  const isSkillsActive = currentPath === '/workspace/skills'
  const isSettingsActive = currentPath === '/workspace/settings'
  const activeAgentId = currentPath.startsWith('/workspace/agent/')
    ? currentPath.replace('/workspace/agent/', '')
    : currentPath.startsWith('/workspace/super/')
      ? currentPath.replace('/workspace/super/', '')
      : null

  /**
   * Determine agent display name based on type and available data.
   */
  const getAgentDisplayName = (agent: AgentSession): React.ReactNode => {
    if (agent.isBaseBranchAgent) {
      // Show actual branch name for base branch agents (from origin/master)
      return <div className="agent-id">{agent.branch || 'Base'}</div>
    }

    const branchName = agent.displayBranchName || agent.branch
    if (branchName) {
      return (
        <div className="agent-branch" title={branchName}>
          {extractBranchName(branchName)}
        </div>
      )
    }

    return <div className="agent-id">{agent.id}</div>
  }

  /**
   * Get the appropriate icon for agent type.
   */
  const getAgentTypeIcon = (agent: AgentSession): React.ReactNode => {
    if (agent.isSuperMinion) return <CrownIcon size="sm" />
    if (agent.isBaseBranchAgent) return <HomeIcon size="sm" />
    return <BotIcon size="sm" />
  }

  /**
   * Check if agent has any waiting state (main or plain terminals).
   */
  const isAgentWaitingForInput = (agentId: string): boolean => {
    const mainWaiting = waitingAgents.has(agentId)
    const plainTerminalWaiting = Array.from(waitingPlainTerminals).some(tid => tid.startsWith(`${agentId}-`))
    return mainWaiting || plainTerminalWaiting
  }

  /**
   * Get teleport failure info for an agent.
   */
  const getTeleportFailure = (agent: AgentSession): TeleportFailure | undefined => {
    const stateFailure = failedTeleportSessions.get(agent.id)
    if (stateFailure) return stateFailure

    if (agent.failureReason) {
      return {
        agentId: agent.id,
        reason: agent.failureReason,
        canRetry: (agent.resumeAttempts || 0) < 3,
        timestamp: Date.now()
      }
    }

    return undefined
  }

  const renderAgent = (agent: AgentSession, projectPath: string, depth = 0) => {
    const isActive = activeAgentId === agent.id
    const isWaiting = isAgentWaitingForInput(agent.id)
    const isAcknowledged = acknowledgedWaitingAgents.has(agent.id)
    const isCursor = agent.tool === 'cursor'
    const teleportFailure = getTeleportFailure(agent)
    const hasTeleportFailure = !!teleportFailure
    const showSpinner = !isCursor && agent.terminalPid && !isWaiting && !hasTeleportFailure
    const isCollapsed = collapsedSuperMinions.has(agent.id)
    const showUnreadBadge = agent.hasUnread && !isWaiting && !hasTeleportFailure
    const showAttentionBadge = isWaiting && !isActive && !isAcknowledged && !hasTeleportFailure

    const handleAgentItemClick = () => handleAgentClick(agent, projectPath)

    const handleCollapseClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleSuperMinionCollapse(agent.id, e)
    }

    const handleRetryClick = async (e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await window.electronAPI.retryResumeAgent(agent.id)
      } catch (error) {
        console.error('Failed to retry resume:', error)
      }
    }

    const handleStartFreshClick = async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (confirm('Start a fresh session? This will abandon the failed session and create a new one.')) {
        try {
          await window.electronAPI.startFreshSession(agent.id)
        } catch (error) {
          console.error('Failed to start fresh session:', error)
        }
      }
    }

    const classNames = [
      'agent-item',
      isActive && 'active',
      isWaiting && !isAcknowledged && 'waiting',  // Only show waiting style if not acknowledged
      hasTeleportFailure && 'failed',
      agent.isSuperMinion && 'super-minion',
      agent.isBaseBranchAgent && 'base-branch'
    ].filter(Boolean).join(' ')

    return (
      <div key={agent.id} className="agent-item-container">
        <div
          className={classNames}
          onClick={handleAgentItemClick}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <div className="agent-info">
            <div className="agent-leading-icons">
              {agent.isSuperMinion ? (
                <span
                  className={`collapse-chevron ${isCollapsed ? 'collapsed' : ''}`}
                  onClick={handleCollapseClick}
                  title="Toggle child agents"
                >
                  <ChevronDownIcon size="sm" />
                </span>
              ) : (
                <span className="chevron-placeholder" aria-hidden="true"></span>
              )}
              <span className="agent-type-icon">{getAgentTypeIcon(agent)}</span>
            </div>
            {getAgentDisplayName(agent)}
            {agent.handoffSource && (
              <span
                className="handoff-lineage-badge"
                title={`Handed off from ${extractBranchName(agent.handoffSource.originalBranch)} (${agent.handoffSource.branchMode} mode)`}
              >
                <span className="lineage-connector"></span>
                <span className="lineage-origin">{extractBranchName(agent.handoffSource.originalBranch)}</span>
              </span>
            )}
            {hasTeleportFailure && (
              <div className="failure-badge-container">
                <div className="failure-badge" title={`Failed to resume: ${teleportFailure.reason}`}><WarningIcon size="sm" /></div>
                <div className="failure-actions">
                  <button className="retry-btn" title="Retry resuming session" onClick={handleRetryClick}>
                    <SyncIcon size="sm" />
                  </button>
                  <button className="start-fresh-btn" title="Start fresh session (abandon old session)" onClick={handleStartFreshClick}>
                    <PlusCircleIcon size="sm" />
                  </button>
                </div>
              </div>
            )}
            {showAttentionBadge && <div className="attention-badge" title="Waiting for input">!</div>}
            {showSpinner && (
              <div className="agent-spinner">
                <div className="spinner"></div>
              </div>
            )}
          </div>
          {showUnreadBadge && <div className="unread-badge">●</div>}
        </div>
      </div>
    )
  }

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`} data-testid="sidebar">
      <button
        className="collapse-sidebar-btn"
        onClick={onToggleCollapse}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span className="collapse-icon">{isCollapsed ? <ChevronRightIcon size="sm" /> : <ChevronLeftIcon size="sm" />}</span>
      </button>
      <div className="sidebar-nav">
        <div
          className={`nav-item ${isHomeActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace')}
        >
          <span className="nav-icon"><HomeIcon size="md" /></span>
          <span className="nav-label">Home</span>
        </div>
        <div className="dropdown-container">
          <MissionDropdown
            variant="icon"
            showAddProject={true}
            onAddProject={handleAddProjectClick}
            onNewMission={handleAddMinion}
            onTeleport={handleTeleport}
          />
        </div>
      </div>

      <div className="projects-section" data-testid="project-list">
        {activeProjects.map((project) => {
          const agents = agentsByProject[project.path] || []
          const isCollapsed = collapsedProjects.has(project.path)
          
          // Filter out agents with missing/empty critical fields (corrupted agent info)
          const validAgents = agents.filter(a => a.id && a.id.trim() !== '')

          // Sort agents: base first, then waiting, then by id
          const sortedAgents = [...validAgents].sort((a, b) => {
            // Base branch agents always first
            if (a.isBaseBranchAgent && !b.isBaseBranchAgent) return -1
            if (!a.isBaseBranchAgent && b.isBaseBranchAgent) return 1

            // Then waiting agents (check both agent waiting and plain terminal waiting)
            const aAgentWaiting = waitingAgents.has(a.id)
            const aPlainWaiting = Array.from(waitingPlainTerminals).some(tid => tid.startsWith(`${a.id}-`))
            const aWaiting = aAgentWaiting || aPlainWaiting

            const bAgentWaiting = waitingAgents.has(b.id)
            const bPlainWaiting = Array.from(waitingPlainTerminals).some(tid => tid.startsWith(`${b.id}-`))
            const bWaiting = bAgentWaiting || bPlainWaiting

            if (aWaiting && !bWaiting) return -1
            if (!aWaiting && bWaiting) return 1

            return a.id.localeCompare(b.id)
          })

          return (
            <div key={project.path} className="project-group">
              <div className="project-header">
                <div
                  className="project-header-content"
                  onClick={() => {
                    toggleProjectCollapse(project.path)
                    localStorage.setItem('lastSelectedProjectPath', project.path)
                  }}
                >
                  <span className="collapse-icon">{isCollapsed ? <ChevronRightIcon size="sm" /> : <ChevronDownIcon size="sm" />}</span>
                  <span className="project-name-sidebar">{project.name}</span>
                </div>
                <div
                  className="add-mission-dropdown"
                  ref={(el) => {
                    if (el) {
                      submenuRefsMap.current.set(project.path, el)
                    }
                  }}
                >
                  <button
                    className="add-mission-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      localStorage.setItem('lastSelectedProjectPath', project.path)
                      setOpenSubmenuProject(openSubmenuProject === project.path ? null : project.path)
                    }}
                    title="Add new mission"
                  >
                    +
                  </button>
                  <div
                    className="add-mission-submenu"
                    style={{ display: openSubmenuProject === project.path ? 'block' : 'none' }}
                  >
                    <div
                      className="add-mission-submenu-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        localStorage.setItem('lastSelectedProjectPath', project.path)
                        handleAddMinion()
                        setOpenSubmenuProject(null)
                      }}
                    >
                      <BotIcon size="sm" /> New Minion
                    </div>
                    <div
                      className="add-mission-submenu-item teleport-option"
                      onClick={(e) => {
                        e.stopPropagation()
                        localStorage.setItem('lastSelectedProjectPath', project.path)
                        handleTeleport()
                        setOpenSubmenuProject(null)
                      }}
                    >
                      <SatelliteIcon size="sm" /> Teleport from Cloud
                    </div>
                  </div>
                </div>
                <button
                  className="remove-project-btn"
                  onClick={(e) => handleRemoveProject(project.path, e)}
                  title="Remove project"
                >
                  ✕
                </button>
              </div>

              {!isCollapsed && (
                <div className="agent-list" data-testid="agent-list">
                  {sortedAgents.length === 0 && (
                    <div className="empty-state">No minions working</div>
                  )}
                  {(() => {
                    // NEW: Handoff agents are now top-level, not nested under parents
                    // We still show the parent-child relationship via visual indicators
                    //
                    // Root agents: no parentAgentId AND no handoffSource (original agents)
                    // Handoff agents: have handoffSource (shown as top-level with lineage badge)
                    // Child agents: have parentAgentId but no handoffSource (super minion subagents)

                    const roots = sortedAgents.filter(a => !a.parentAgentId && !a.handoffSource)
                    const handoffAgents = sortedAgents.filter(a => a.handoffSource)

                    const childrenMap: Record<string, AgentSession[]> = {}
                    sortedAgents.forEach(a => {
                      if (a.parentAgentId && !a.handoffSource) {
                        if (!childrenMap[a.parentAgentId]) childrenMap[a.parentAgentId] = []
                        childrenMap[a.parentAgentId].push(a)
                      }
                    })

                    const renderTaskItem = (task: TaskInvocation, depth: number) => {
                      const statusIcon = task.status === 'running' ? <HourglassIcon size="xs" /> : task.status === 'completed' ? <CheckIcon size="xs" /> : <XIcon size="xs" />
                      const statusClass = task.status === 'running' ? 'running' : task.status === 'completed' ? 'completed' : 'failed'
                      return (
                        <div
                          key={task.toolUseId}
                          className={`task-item ${statusClass}`}
                          style={{ paddingLeft: `${depth * 12 + 12}px` }}
                          title={task.description}
                        >
                          <span className="task-icon">{statusIcon}</span>
                          <span className="task-description">{task.description || task.subagentType}</span>
                        </div>
                      )
                    }

                    const renderWithChildren = (agent: AgentSession, depth = 0): React.ReactNode[] => {
                      const items: React.ReactNode[] = [renderAgent(agent, project.path, depth)]

                      // If super minion is not collapsed, show tasks and children
                      if (agent.isSuperMinion && !collapsedSuperMinions.has(agent.id)) {
                        // Render task invocations
                        const tasks = tasksByAgent[agent.id] || []
                        tasks.forEach(task => {
                          items.push(renderTaskItem(task, depth + 1))
                        })
                      }

                      // Render non-handoff child agents nested (super minion subagents)
                      const children = childrenMap[agent.id] || []
                      if (children.length > 0 && !collapsedSuperMinions.has(agent.id)) {
                        children.forEach(child => {
                          items.push(...renderWithChildren(child, depth + 1))
                        })
                      }
                      return items
                    }

                    // Render original root agents with their children
                    const rootItems = roots.flatMap(root => renderWithChildren(root))

                    // Render handoff agents as top-level items (depth 0)
                    // They display the lineage badge showing their origin
                    const handoffItems = handoffAgents.map(agent => renderAgent(agent, project.path, 0))

                    return [...rootItems, ...handoffItems]
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-footer">
        <div
          className={`nav-item archive-nav-item ${isArchiveActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace/archive')}
          title="Archive"
        >
          <span className="nav-icon">
            <ClockIcon size="sm" />
          </span>
          <span className="nav-label">Archive</span>
        </div>
        <div
          className={`nav-item skills-nav-item ${isSkillsActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace/skills')}
          title="Skills"
        >
          <span className="nav-icon">
            <SkillsIcon size="sm" />
          </span>
          <span className="nav-label">Skills</span>
        </div>
        <div
          className={`nav-item settings-nav-item ${isSettingsActive ? 'active' : ''}`}
          data-testid="settings-link"
          onClick={() => handleNavigate('/workspace/settings')}
          title="Settings"
        >
          <span className="nav-icon settings-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.3h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.8 2.3-.4V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM9.4 1l.5 2.4L12 2.1l2 2-1.4 2.1 2.4.4v2.8l-2.4.5L14 12l-2 2-2.1-1.4-.5 2.4H6.6l-.5-2.4L4 13.9l-2-2 1.4-2.1L1 9.4V6.6l2.4-.5L2.1 4l2-2 2.1 1.4.4-2.4h2.8zm.6 7c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zM8 9c.6 0 1-.4 1-1s-.4-1-1-1-1 .4-1 1 .4 1 1 1z" clipRule="evenodd"/>
            </svg>
          </span>
          <span className="nav-label">Settings</span>
        </div>
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content project-picker-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Open Project</h2>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <ProjectPicker onProjectSelect={handleProjectSelect} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Sidebar
