import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import ChildStatusCard from './ChildStatusCard'
import PlanApproval from './PlanApproval'
import './SuperAgentView.css'
import { SuperAgentInfo, AgentInfo } from '../../main/services/types/ProjectConfig'

interface SuperAgentViewProps {
  activeProjects: any[]
}

function SuperAgentView({ activeProjects }: SuperAgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<SuperAgentInfo | null>(null)
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAgent = async () => {
    if (!agentId) return
    try {
      setError(null)
      const details = await window.electronAPI.getSuperAgentDetails(agentId)
      setAgent(details)
    } catch (err: any) {
      console.error('Failed to load super agent details:', err)
      setError(err.message || 'Failed to load super agent')
    }
  }

  useEffect(() => {
    loadAgent()
    
    // Listen for updates
    const unsubscribe = window.electronAPI.onAgentListUpdate(() => {
      loadAgent()
    })
    
    return () => {
      unsubscribe()
    }
  }, [agentId])

  if (error) {
    return (
      <div className="super-agent-view">
        <div className="agent-view-error">
          <h3>Error Loading Super Minion</h3>
          <p>{error}</p>
          <button onClick={() => navigate('/workspace')}>Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="super-agent-view">
        <div className="agent-view-loading">Loading Super Minion {agentId}...</div>
      </div>
    )
  }

  const handleOpenCursor = async () => {
    if (agent) {
      await window.electronAPI.openInCursor(agent.agentId)
    }
  }

  const handleStop = async () => {
    if (agent) {
      await window.electronAPI.stopAgent(agent.agentId)
    }
  }

  return (
    <div className="super-agent-view">
      <div className="agent-header">
        <div className="agent-title">
          <h2>👑 {agent.agentId} <span className="budget-badge">Budget: {agent.children.length}/{agent.minionBudget}</span></h2>
        </div>
        <div className="agent-actions">
          <button onClick={handleOpenCursor}>Open in Cursor</button>
          <button className="danger" onClick={handleStop}>Stop</button>
          {/* Cleanup implementation can be added later or copied from AgentView */}
        </div>
      </div>

      <div className="agent-info-bar">
        <div className="info-item">
          <span className="info-label">Main Mission:</span>
          <span className="info-value">{agent.feature}</span>
        </div>
      </div>

      <div className="super-content">
        <div className={`collapsible-section ${isTerminalCollapsed ? 'collapsed' : ''}`}>
          <div className="section-header" onClick={() => setIsTerminalCollapsed(!isTerminalCollapsed)}>
            <h3>{isTerminalCollapsed ? '▶' : '▼'} Super Minion Terminal</h3>
            <span className="section-hint">{isTerminalCollapsed ? 'Click to expand orchestration logs' : 'Orchestration logs'}</span>
          </div>
          {!isTerminalCollapsed && (
            <div className="terminal-wrapper">
              <Terminal agentId={agent.agentId} />
            </div>
          )}
        </div>

        <div className="super-grid">
          <div className="children-section">
            <h3>Active Children ({agent.children.length})</h3>
            <div className="child-cards">
              {agent.children.map(child => (
                <ChildStatusCard 
                  key={child.id} 
                  child={child} 
                  onClick={() => navigate(`/workspace/agent/${child.agentId}`)} 
                />
              ))}
              {agent.children.length === 0 && <p className="empty-hint">No active children yet.</p>}
            </div>
          </div>

          <div className="plans-section">
            <PlanApproval 
              plans={agent.pendingPlans}
              onApprove={(planId) => console.log('Approved plan:', planId)}
              onReject={(planId) => console.log('Rejected plan:', planId)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SuperAgentView

