import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import './SuperAgentView.css'
import { SuperAgentInfo, AgentInfo, isSuperMinion } from '../services/types/ProjectConfig'

interface SuperAgentViewProps {
  activeProjects: any[]
}

const MOCK_SUPER_AGENT: SuperAgentInfo = {
  id: 'super-minion-1',
  agentId: 'super-minion-1',
  branch: 'feature/super-orchestrator',
  project: 'agent-framework',
  feature: 'Implement Super Minion Orchestration',
  status: 'in_progress',
  tool: 'claude',
  mode: 'planning',
  createdAt: new Date().toISOString(),
  lastActivity: new Date().toISOString(),
  isSuperMinion: true,
  minionBudget: 5,
  children: [
    {
      id: 'child-1',
      agentId: 'child-1',
      branch: 'feature/child-1-ui',
      project: 'agent-framework',
      feature: 'Build UI Scaffolding',
      status: 'active',
      tool: 'claude',
      mode: 'dev',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      parentAgentId: 'super-minion-1'
    },
    {
      id: 'child-2',
      agentId: 'child-2',
      branch: 'feature/child-2-logic',
      project: 'agent-framework',
      feature: 'Implement Backend Logic',
      status: 'pending',
      tool: 'claude',
      mode: 'dev',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      parentAgentId: 'super-minion-1'
    }
  ],
  pendingPlans: [
    {
      id: 'plan-1',
      shortName: 'refactor-auth',
      branch: 'feature/refactor-auth',
      description: 'Refactor authentication to use JWT tokens for better session management.',
      prompt: 'Implement JWT-based authentication...',
      status: 'pending',
      estimatedComplexity: 'medium'
    }
  ]
}

function SuperAgentView({ activeProjects }: SuperAgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<SuperAgentInfo | null>(null)
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false)

  useEffect(() => {
    // For Milestone 2, we use mock data
    // In real implementation, we'd load this from AgentService
    setAgent(MOCK_SUPER_AGENT)
  }, [agentId])

  if (!agent) {
    return (
      <div className="super-agent-view">
        <div className="agent-view-error">Loading Super Minion {agentId}...</div>
      </div>
    )
  }

  return (
    <div className="super-agent-view">
      <div className="agent-header">
        <div className="agent-title">
          <h2>👑 {agent.agentId} <span className="budget-badge">Budget: {agent.children.length}/{agent.minionBudget}</span></h2>
        </div>
        <div className="agent-actions">
          <button onClick={() => {}}>Open in Cursor</button>
          <button className="danger">Stop</button>
          <div className="cleanup-dropdown">
            <button className="cleanup-button">Cleanup ▾</button>
          </div>
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
                <div key={child.id} className="child-card" onClick={() => navigate(`/workspace/agent/${child.agentId}`)}>
                  <div className="child-card-header">
                    <span className="child-icon">🍌</span>
                    <span className="child-id">{child.agentId}</span>
                    <span className={`status-dot ${child.status}`}></span>
                  </div>
                  <div className="child-card-body">
                    <p className="child-feature">{child.feature}</p>
                    <span className="view-link">View Terminal →</span>
                  </div>
                </div>
              ))}
              {agent.children.length === 0 && <p className="empty-hint">No active children yet.</p>}
            </div>
          </div>

          <div className="plans-section">
            <h3>Proposed Plans ({agent.pendingPlans.length})</h3>
            <div className="plan-list">
              {agent.pendingPlans.map(plan => (
                <div key={plan.id} className="plan-item">
                  <div className="plan-header">
                    <span className="plan-name">📋 {plan.shortName}</span>
                    <span className={`complexity-badge ${plan.estimatedComplexity}`}>{plan.estimatedComplexity}</span>
                  </div>
                  <p className="plan-desc">{plan.description}</p>
                  <div className="plan-actions">
                    <button className="approve-btn">✓ Approve</button>
                    <button className="reject-btn">✗ Reject</button>
                  </div>
                </div>
              ))}
              {agent.pendingPlans.length === 0 && <p className="empty-hint">No plans pending approval.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SuperAgentView

