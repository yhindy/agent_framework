import { useState, useEffect } from 'react'
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
}

function Sidebar({ project, onNavigate }: SidebarProps) {
  const [agents, setAgents] = useState<AgentSession[]>([])
  const [currentPath, setCurrentPath] = useState('/workspace')

  useEffect(() => {
    loadAgents()

    // Listen for agent updates
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadAgents()
    })

    return () => unsubscribe()
  }, [project])

  const loadAgents = async () => {
    const agentList = await window.electronAPI.listAgents()
    setAgents(agentList)
  }

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
    onNavigate(path)
  }

  const handleAgentClick = async (agentId: string) => {
    await window.electronAPI.clearUnread(agentId)
    handleNavigate(`/workspace/agent/${agentId}`)
    loadAgents() // Refresh to clear unread badge
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="project-info">
          <div className="project-name">{project.name}</div>
        </div>
      </div>

      <div className="sidebar-nav">
        <div
          className={`nav-item ${currentPath === '/workspace' ? 'active' : ''}`}
          onClick={() => handleNavigate('/workspace')}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Home</span>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-header">Agents</div>
        <div className="agent-list">
          {agents.length === 0 && (
            <div className="empty-state">No agents running</div>
          )}
          {agents.map((agent) => {
            const isWorking = agent.mode && agent.mode !== 'idle'
            return (
              <div
                key={agent.id}
                className={`agent-item ${currentPath.includes(agent.id) ? 'active' : ''}`}
                onClick={() => handleAgentClick(agent.id)}
              >
                <div className="agent-info">
                  <div className="agent-id">{agent.id}</div>
                  {isWorking && (
                    <div className="agent-spinner">
                      <div className="spinner"></div>
                    </div>
                  )}
                  {!isWorking && agent.terminalPid && (
                    <div className="agent-status running">●</div>
                  )}
                </div>
                {agent.hasUnread && <div className="unread-badge">●</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default Sidebar

