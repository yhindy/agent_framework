import React from 'react'
import './PlanApproval.css'
import { ChildPlan } from '../../main/services/types/ProjectConfig'

interface PlanApprovalProps {
  plans: ChildPlan[]
  onApprove: (planId: string) => void
  onReject: (planId: string) => void
}

const PlanApproval: React.FC<PlanApprovalProps> = ({ plans, onApprove, onReject }) => {
  return (
    <div className="plan-approval-container">
      <h3>Proposed Plans ({plans.length})</h3>
      <div className="plan-list">
        {plans.map(plan => (
          <div key={plan.id} className="plan-item">
            <div className="plan-header">
              <span className="plan-name">📋 {plan.shortName}</span>
              {plan.estimatedComplexity && (
                <span className={`complexity-badge ${plan.estimatedComplexity}`}>
                  {plan.estimatedComplexity}
                </span>
              )}
            </div>
            <p className="plan-desc">{plan.description}</p>
            <div className="plan-actions">
              <button 
                className="approve-btn" 
                onClick={() => onApprove(plan.id)}
              >
                ✓ Approve
              </button>
              <button 
                className="reject-btn" 
                onClick={() => onReject(plan.id)}
              >
                ✗ Reject
              </button>
            </div>
          </div>
        ))}
        {plans.length === 0 && <p className="empty-hint">No plans pending approval.</p>}
      </div>
    </div>
  )
}

export default PlanApproval

