import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ProjectPicker from './ProjectPicker'
import MissionDropdown from './MissionDropdown'
import { extractBranchName } from '../utils/branchUtils'
import './Sidebar.css'

interface SidebarProps {
  activeProjects: any[]
  onNavigate: (path: string) => void
  onProjectRemove: (path: string) => void
  onProjectAdd: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  mode?: string
  tool?: string
  projectPath?: string  // Added to track which project the agent belongs to
  isSuperMinion?: boolean
  parentAgentId?: string
  isBaseBranchAgent?: boolean
  branch?: string
  displayBranchName?: string  // Custom/detected branch name for display (e.g., from teleport metadata)
  failureReason?: string  // Why session resume failed
  resumeAttempts?: number  // Number of times we've tried to resume
}

interface AgentsByProject {
  [projectPath: string]: AgentSession[]
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

function Sidebar({ activeProjects, onNavigate, onProjectRemove, onProjectAdd, isCollapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [agentsByProject, setAgentsByProject] = useState<AgentsByProject>({})
  const [tasksByAgent, setTasksByAgent] = useState<TasksByAgent>({})
  const [waitingAgents, setWaitingAgents] = useState<Set<string>>(new Set())
  const [waitingPlainTerminals, setWaitingPlainTerminals] = useState<Set<string>>(new Set())
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [openSubmenuProject, setOpenSubmenuProject] = useState<string | null>(null)
  const [failedTeleportSessions, setFailedTeleportSessions] = useState<Map<string, TeleportFailure>>(new Map())
  const submenuRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())
  const currentPath = location.pathname

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

  useEffect(() => {
    // Load agents and query current state from backend
    const loadAgentsAndStates = async () => {
      const agentsByProj: AgentsByProject = {}
      const currentWaitingAgents = new Set<string>()
      const tasksByAg: TasksByAgent = {}
      const superMinionIds: string[] = []

      for (const project of activeProjects) {
        try {
          const agents = await window.electronAPI.listAgentsForProject(project.path)
          agentsByProj[project.path] = agents

          // Query backend for CURRENT state of each active Claude agent
          // This fixes the "stuck state" bug on page reload
          // Also fetch task invocations for super minions
          for (const agent of agents) {
            if (agent.terminalPid && agent.tool === 'claude') {
              try {
                const state = await window.electronAPI.getAgentState(agent.id)
                console.log(`[Sidebar] Queried state for ${agent.id}: ${state}`)

                if (state === 'waiting') {
                  currentWaitingAgents.add(agent.id)
                }
              } catch (err) {
                console.error(`Failed to query state for ${agent.id}:`, err)
              }
            }

            // Fetch task invocations for super minions
            if (agent.isSuperMinion) {
              superMinionIds.push(agent.id)
              try {
                const superDetails = await window.electronAPI.getSuperAgentDetails(agent.id)
                if (superDetails?.taskInvocations) {
                  tasksByAg[agent.id] = superDetails.taskInvocations
                }
              } catch (err) {
                // Ignore errors fetching task invocations
              }
            }
          }
        } catch (err) {
          console.error(`Failed to load agents for ${project.path}:`, err)
          agentsByProj[project.path] = []
        }
      }

      setAgentsByProject(agentsByProj)
      setTasksByAgent(tasksByAg)
      setWaitingAgents(currentWaitingAgents)
      if (!hasInitializedSuperMinionCollapse.current) {
        setCollapsedSuperMinions(new Set(superMinionIds))
        localStorage.setItem('collapsedSuperMinions', JSON.stringify(superMinionIds))
        hasInitializedSuperMinionCollapse.current = true
      }
      console.log('[Sidebar] Loaded agents with current states:', {
        waiting: [...currentWaitingAgents]
      })
    }

    loadAgentsAndStates()

    // Listen for agent updates
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadAgentsAndStates()
    })

    // Listen for state changes (NEW: replaces individual waiting/resumed events)
    const unsubStateChanged = window.electronAPI.onAgentStateChanged((agentId, state) => {
      console.log('[Sidebar] State changed:', agentId, state)

      setWaitingAgents(prev => {
        const next = new Set(prev)
        if (state === 'waiting') {
          next.add(agentId)
        } else {
          next.delete(agentId)
        }
        return next
      })
    })

    // Listen for plain terminal waiting state changes
    const unsubPlainWaiting = window.electronAPI.onPlainTerminalWaitingForInput((terminalId) => {
      setWaitingPlainTerminals(prev => new Set([...prev, terminalId]))
    })

    const unsubPlainResumed = window.electronAPI.onPlainTerminalResumedWork((terminalId) => {
      setWaitingPlainTerminals(prev => {
        const next = new Set(prev)
        next.delete(terminalId)
        return next
      })
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
      unsubscribe()
      unsubStateChanged()
      unsubPlainWaiting()
      unsubPlainResumed()
      unsubTeleportFailed()
      unsubResumeFailed()
    }
  }, [activeProjects])

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

  const toggleSuperMinionCollapse = (agentId: string, e: React.MouseEvent) => {
    e.stopPropagation()
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

  const loadAllAgents = async () => {
    // Fetch agents for all active projects
    const agentsByProj: AgentsByProject = {}
    
    for (const project of activeProjects) {
      try {
        const agents = await window.electronAPI.listAgentsForProject(project.path)
        agentsByProj[project.path] = agents
      } catch (err) {
        console.error(`Failed to load agents for ${project.path}:`, err)
        agentsByProj[project.path] = []
      }
    }
    
    setAgentsByProject(agentsByProj)
  }

  const handleNavigate = (path: string) => {
    onNavigate(path)
  }

  const handleAgentClick = async (agent: AgentSession, projectPath: string) => {
    localStorage.setItem('lastSelectedProjectPath', projectPath)
    await window.electronAPI.clearUnread(agent.id)
    const route = agent.isSuperMinion 
      ? `/workspace/super/${agent.id}` 
      : `/workspace/agent/${agent.id}`
    handleNavigate(route)
    loadAllAgents() // Refresh to clear unread badge
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

  const handleProjectSelect = async (_project: any) => {
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
  const isAnalyticsActive = currentPath === '/workspace/analytics'
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
  const getAgentTypeIcon = (agent: AgentSession): string => {
    if (agent.isSuperMinion) return '👑'
    if (agent.isBaseBranchAgent) return '🏠'
    return '🍌'
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
    const isCursor = agent.tool === 'cursor'
    const teleportFailure = getTeleportFailure(agent)
    const hasTeleportFailure = !!teleportFailure
    const showSpinner = !isCursor && agent.terminalPid && !isWaiting && !hasTeleportFailure
    const isCollapsed = collapsedSuperMinions.has(agent.id)
    const showUnreadBadge = agent.hasUnread && !isWaiting && !hasTeleportFailure
    const showAttentionBadge = isWaiting && !isActive && !hasTeleportFailure

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
      isWaiting && 'waiting',
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
                  ▼
                </span>
              ) : (
                <span className="chevron-placeholder" aria-hidden="true"></span>
              )}
              <span className="agent-type-icon">{getAgentTypeIcon(agent)}</span>
            </div>
            {getAgentDisplayName(agent)}
            {hasTeleportFailure && (
              <div className="failure-badge-container">
                <div className="failure-badge" title={`Failed to resume: ${teleportFailure.reason}`}>⚠</div>
                <div className="failure-actions">
                  <button className="retry-btn" title="Retry resuming session" onClick={handleRetryClick}>
                    🔄
                  </button>
                  <button className="start-fresh-btn" title="Start fresh session (abandon old session)" onClick={handleStartFreshClick}>
                    🆕
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
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        className="collapse-sidebar-btn"
        onClick={onToggleCollapse}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span className="collapse-icon">{isCollapsed ? '▶' : '◀'}</span>
      </button>
      <div className="sidebar-nav">
        <div
          className={`nav-item ${isHomeActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace')}
        >
          <span className="nav-icon">🏠</span>
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

      <div className="projects-section">
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
                  <span className="collapse-icon">{isCollapsed ? '▶' : '▼'}</span>
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
                      🍌 New Minion
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
                <div className="agent-list">
                  {sortedAgents.length === 0 && (
                    <div className="empty-state">No minions working</div>
                  )}
                  {(() => {
                    const roots = sortedAgents.filter(a => !a.parentAgentId)
                    const childrenMap: Record<string, AgentSession[]> = {}
                    sortedAgents.forEach(a => {
                      if (a.parentAgentId) {
                        if (!childrenMap[a.parentAgentId]) childrenMap[a.parentAgentId] = []
                        childrenMap[a.parentAgentId].push(a)
                      }
                    })

                    const renderTaskItem = (task: TaskInvocation, depth: number) => {
                      const statusIcon = task.status === 'running' ? '⏳' : task.status === 'completed' ? '✓' : '✗'
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

                      // Render child agents
                      const children = childrenMap[agent.id] || []
                      if (children.length > 0 && !collapsedSuperMinions.has(agent.id)) {
                        children.forEach(child => {
                          items.push(...renderWithChildren(child, depth + 1))
                        })
                      }
                      return items
                    }

                    return roots.map(root => renderWithChildren(root))
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-footer">
        <div
          className={`nav-item analytics-nav-item ${isAnalyticsActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace/analytics')}
          title="Analytics"
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Analytics</span>
        </div>
        <div
          className={`nav-item settings-nav-item ${isSettingsActive ? 'active' : ''}`}
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
