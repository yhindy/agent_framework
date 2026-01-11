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

function Sidebar({ activeProjects, onNavigate, onProjectRemove, onProjectAdd, isCollapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [agentsByProject, setAgentsByProject] = useState<AgentsByProject>({})
  const [tasksByAgent, setTasksByAgent] = useState<TasksByAgent>({})
  const [waitingAgents, setWaitingAgents] = useState<Set<string>>(new Set())
  const [waitingPlainTerminals, setWaitingPlainTerminals] = useState<Set<string>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [collapsedSuperMinions, setCollapsedSuperMinions] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [openSubmenuProject, setOpenSubmenuProject] = useState<string | null>(null)
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

    return () => {
      unsubscribe()
      unsubStateChanged()
      unsubPlainWaiting()
      unsubPlainResumed()
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
  const activeAgentId = currentPath.startsWith('/workspace/agent/')
    ? currentPath.replace('/workspace/agent/', '')
    : currentPath.startsWith('/workspace/super/')
      ? currentPath.replace('/workspace/super/', '')
      : null

  const renderAgent = (agent: AgentSession, projectPath: string, depth = 0) => {
    const isActive = activeAgentId === agent.id
    const isAgentWaiting = waitingAgents.has(agent.id)
    // Check if any plain terminal for this agent is waiting (terminalId format: `${agentId}-${terminalId}`)
    const hasWaitingPlainTerminal = Array.from(waitingPlainTerminals).some(tid => tid.startsWith(`${agent.id}-`))
    const isWaiting = isAgentWaiting || hasWaitingPlainTerminal
    const isCursor = agent.tool === 'cursor'
    const showSpinner = !isCursor && agent.terminalPid && !isWaiting
    const isCollapsed = collapsedSuperMinions.has(agent.id)

    const handleAgentItemClick = () => {
      handleAgentClick(agent, projectPath)
    }

    const handleCollapseClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleSuperMinionCollapse(agent.id, e)
    }

    return (
      <div key={agent.id} className="agent-item-container">
        <div
          className={`agent-item ${isActive ? 'active' : ''} ${isWaiting ? 'waiting' : ''} ${agent.isSuperMinion ? 'super-minion' : ''} ${agent.isBaseBranchAgent ? 'base-branch' : ''}`}
          onClick={handleAgentItemClick}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <div className="agent-info">
            {agent.isSuperMinion && (
              <span
                className={`collapse-chevron ${isCollapsed ? 'collapsed' : ''}`}
                onClick={handleCollapseClick}
                title="Toggle child agents"
              >
                ▼
              </span>
            )}
            {agent.isSuperMinion && (
              <span className="super-minion-indicator">
                👑
              </span>
            )}
            {agent.isBaseBranchAgent && <span className="agent-icon">🏠</span>}
            {!agent.isSuperMinion && !agent.isBaseBranchAgent && <span className="agent-icon"></span>}
            {agent.isBaseBranchAgent ? (
              <div className="agent-id">{agent.assignmentId?.split('-').pop()} (Base)</div>
            ) : agent.branch ? (
              <div className="agent-branch" title={agent.branch}>
                {extractBranchName(agent.branch)}
              </div>
            ) : (
              <div className="agent-id">{agent.id}</div>
            )}
            {isWaiting && !isActive && (
              <div className="attention-badge" title="Waiting for input">!</div>
            )}
            {showSpinner && (
              <div className="agent-spinner">
                <div className="spinner"></div>
              </div>
            )}
          </div>
          {agent.hasUnread && !isWaiting && <div className="unread-badge">●</div>}
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
