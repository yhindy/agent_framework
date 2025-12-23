import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import './Sidebar.css'

interface SidebarProps {
  project: any
  onNavigate: (path: string) => void
}

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  mode?: string
  tool?: string  // 'claude', 'aider', 'cursor', etc.
}

function Sidebar({ project, onNavigate }: SidebarProps) {
  const location = useLocation()
  const [agents, setAgents] = useState<AgentSession[]>([])
  const [waitingAgents, setWaitingAgents] = useState<Set<string>>(new Set())
  const currentPath = location.pathname

  useEffect(() => {
    loadAgents()

    // Listen for agent updates
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadAgents()
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
  }, [project])

  const loadAgents = async () => {
    const agentList = await window.electronAPI.listAgents()
    setAgents(agentList)
  }

  const handleNavigate = (path: string) => {
    onNavigate(path)
  }

  const handleAgentClick = async (agentId: string) => {
    await window.electronAPI.clearUnread(agentId)
    handleNavigate(`/workspace/agent/${agentId}`)
    loadAgents() // Refresh to clear unread badge
  }

  const isHomeActive = currentPath === '/workspace' || currentPath === '/workspace/'
  const activeAgentId = currentPath.startsWith('/workspace/agent/')
    ? currentPath.replace('/workspace/agent/', '')
    : null

  const handleSwitchProject = async () => {
    await window.electronAPI.clearCurrentProject()
    onNavigate('/')
    // We also need to notify the parent app to reset its project state
    // But since App.tsx listens to getCurrentProject on mount, we might need a way to force a refresh
    // For now, onNavigate('/') will likely just change the route, but App.tsx holds the 'project' state
    // The App component should probably listen for project changes or we need a callback in SidebarProps
  }

  // Sort agents: waiting first, then by id
  const sortedAgents = [...agents].sort((a, b) => {
    const aWaiting = waitingAgents.has(a.id)
    const bWaiting = waitingAgents.has(b.id)
    if (aWaiting && !bWaiting) return -1
    if (!aWaiting && bWaiting) return 1
    return a.id.localeCompare(b.id)
  })

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="project-info">
          <div className="project-name">{project.name}</div>
          <button className="switch-project-btn" onClick={handleSwitchProject} title="Switch Project">
            ⇄
          </button>
        </div>
      </div>

      <div className="sidebar-nav">
        <div
          className={`nav-item ${isHomeActive ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace')}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Home</span>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-header">Minions 🍌</div>
        <div className="agent-list">
          {sortedAgents.length === 0 && (
            <div className="empty-state">No minions working</div>
          )}
          {sortedAgents.map((agent) => {
            const isActive = activeAgentId === agent.id
            const isWaiting = waitingAgents.has(agent.id)
            const isCursor = agent.tool === 'cursor'
            // Show spinner only for non-cursor tools with an active terminal that's not waiting
            const showSpinner = !isCursor && agent.terminalPid && !isWaiting
            
            return (
              <div
                key={agent.id}
                className={`agent-item ${isActive ? 'active' : ''} ${isWaiting ? 'waiting' : ''}`}
                onClick={() => handleAgentClick(agent.id)}
              >
                <div className="agent-info">
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
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default Sidebar
