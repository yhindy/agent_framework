import React from 'react'
import './ChildStatusCard.css'
import { AgentInfo } from '../../../main/services/types/ProjectConfig'
import { extractBranchName } from '../utils/branchUtils'
import { BotIcon, SyncIcon, CheckCircleIcon, XCircleIcon } from './icons'

interface ChildStatusCardProps {
  child: AgentInfo
  onClick: () => void
}

const ChildStatusCard: React.FC<ChildStatusCardProps> = ({ child, onClick }) => {
  return (
    <div className="child-card" onClick={onClick}>
      <div className="child-card-header">
        <span className="child-icon"><BotIcon size="sm" /></span>
        <span className="child-id" title={`${child.branch || child.agentId}`}>{extractBranchName(child.branch) || child.agentId}</span>
        {child.prStatus && (
          <span className={`pr-badge pr-${child.prStatus.toLowerCase()}`}>
            {child.prStatus === 'OPEN' ? <SyncIcon size="sm" /> : child.prStatus === 'MERGED' ? <CheckCircleIcon size="sm" /> : <XCircleIcon size="sm" />}
          </span>
        )}
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

