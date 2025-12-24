import React from 'react'
import './ChildStatusCard.css'
import { AgentInfo } from '../services/types/ProjectConfig'

interface ChildStatusCardProps {
  child: AgentInfo
  onClick: () => void
}

const ChildStatusCard: React.FC<ChildStatusCardProps> = ({ child, onClick }) => {
  return (
    <div className="child-card" onClick={onClick}>
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
  )
}

export default ChildStatusCard

