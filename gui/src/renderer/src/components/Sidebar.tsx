import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import ProjectPicker from './ProjectPicker'
import './Sidebar.css'

interface SidebarProps {
  activeProjects: any[]
  onNavigate: (path: string) => void
  onProjectRemove: (path: string) => void
  onProjectAdd: () => void
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
}

interface AgentsByProject {
  [projectPath: string]: AgentSession[]
}

function Sidebar({ activeProjects, onNavigate, onProjectRemove }: SidebarProps) {
  const location = useLocation()
  const [agentsByProject, setAgentsByProject] = useState<AgentsByProject>({})
  const [waitingAgents, setWaitingAgents] = useState<Set<string>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [collapsedSuperMinions, setCollapsedSuperMinions] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const currentPath = location.pathname

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showDropdown])

  useEffect(() => {
    loadAllAgents()

    // Listen for agent updates
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadAllAgents()
    })

    // Listen for waiting state changes
    const unsubWaiting = window.electronAPI.onAgentWaitingForInput((agentId) => {
      setWaitingAgents(prev => new Set([...prev, agentId]))
    })

    const unsubResumed = window.electronAPI.onAgentResumedWork((agentId) => {
      setWaitingAgents(prev => {
        const next = new Set(prev)
        next.delete(agentId)
        return next
      })
    })

    return () => {
      unsubscribe()
      unsubWaiting()
      unsubResumed()
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

  const handleProjectSelect = async (_project: any) => {
    // Project has been added, refresh state
    setShowAddModal(false)
    // Parent will handle refresh via onProjectAdd if needed
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
    const isWaiting = waitingAgents.has(agent.id)
    const isCursor = agent.tool === 'cursor'
    const showSpinner = !isCursor && agent.terminalPid && !isWaiting
    const isCollapsed = collapsedSuperMinions.has(agent.id)

    const handleAgentItemClick = (e: React.MouseEvent) => {
      if (agent.isSuperMinion) {
        toggleSuperMinionCollapse(agent.id, e)
      } else {
        handleAgentClick(agent, projectPath)
      }
    }

    return (
      <div key={agent.id} className="agent-item-container">
        <div
          className={`agent-item ${isActive ? 'active' : ''} ${isWaiting ? 'waiting' : ''} ${agent.isSuperMinion ? 'super-minion' : ''}`}
          onClick={handleAgentItemClick}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <div className="agent-info">
            {agent.isSuperMinion && (
              <span className={`super-minion-indicator ${isCollapsed ? 'collapsed' : ''}`}>
                👑
              </span>
            )}
            {!agent.isSuperMinion && <span className="agent-icon"></span>}
            <div className="agent-id">{agent.id}</div>
            {isWaiting && (
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
    <div className="sidebar">
      <div className="sidebar-nav">
        <div
          className={`nav-item ${isHomeActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace')}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Home</span>
        </div>
        <div className="dropdown-container" ref={dropdownRef}>
          <div
            className="nav-item dropdown-trigger"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <span className="nav-icon">+</span>
          </div>
          {showDropdown && (
            <div className="dropdown-menu">
              <div
                className="dropdown-item"
                onClick={() => {
                  setShowAddModal(true)
                  setShowDropdown(false)
                }}
              >
                <span className="dropdown-icon">📁</span>
                <span className="dropdown-label">Add Project</span>
              </div>
              <div
                className="dropdown-item"
                onClick={() => {
                  handleAddMinion(false)
                  setShowDropdown(false)
                }}
              >
                <span className="dropdown-icon">🍌</span>
                <span className="dropdown-label">New Mission</span>
              </div>
              <div
                className="dropdown-item super-option"
                onClick={() => {
                  handleAddMinion(true)
                  setShowDropdown(false)
                }}
              >
                <span className="dropdown-icon">👑</span>
                <span className="dropdown-label">New Super Mission</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="projects-section">
        {activeProjects.map((project) => {
          const agents = agentsByProject[project.path] || []
          const isCollapsed = collapsedProjects.has(project.path)
          
          // Sort agents: waiting first, then by id
          const sortedAgents = [...agents].sort((a, b) => {
            const aWaiting = waitingAgents.has(a.id)
            const bWaiting = waitingAgents.has(b.id)
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
                <div className="add-mission-dropdown">
                  <button
                    className="add-mission-btn"
                    onMouseEnter={(e) => {
                      const elem = e.currentTarget.parentElement?.querySelector('.add-mission-submenu') as HTMLElement
                      if (elem) elem.style.display = 'block'
                    }}
                    onMouseLeave={(e) => {
                      const elem = e.currentTarget.parentElement?.querySelector('.add-mission-submenu') as HTMLElement
                      if (elem) elem.style.display = 'none'
                    }}
                    onClick={() => {
                      localStorage.setItem('lastSelectedProjectPath', project.path)
                      handleAddMinion(false)
                    }}
                    title="Add new mission"
                  >
                    +
                  </button>
                  <div
                    className="add-mission-submenu"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.display = 'block'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  >
                    <div
                      className="add-mission-submenu-item"
                      onClick={() => {
                        localStorage.setItem('lastSelectedProjectPath', project.path)
                        handleAddMinion(false)
                      }}
                    >
                      Regular Mission
                    </div>
                    <div
                      className="add-mission-submenu-item super-option"
                      onClick={() => {
                        localStorage.setItem('lastSelectedProjectPath', project.path)
                        handleAddMinion(true)
                      }}
                    >
                      <span className="super-icon">👑</span> Super Mission
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

                    const renderWithChildren = (agent: AgentSession, depth = 0): React.ReactNode[] => {
                      const items: React.ReactNode[] = [renderAgent(agent, project.path, depth)]
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
