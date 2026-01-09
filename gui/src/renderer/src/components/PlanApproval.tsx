import React, { useState } from 'react'
import './PlanApproval.css'
import { ChildPlan } from '../types/agent'

interface PlanApprovalProps {
  plans: ChildPlan[]
  onApprove: (planId: string) => void
  onReject: (planId: string) => void
}

const PlanApproval: React.FC<PlanApprovalProps> = ({ plans, onApprove, onReject }) => {
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set())

  const toggleExpand = (planId: string) => {
    setExpandedPlans(prev => {
      const next = new Set(prev)
      if (next.has(planId)) {
        next.delete(planId)
      } else {
        next.add(planId)
      }
      return next
    })
  }

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

            {plan.prompt && (
              <div className="plan-prompt-section">
                <button
                  className="expand-prompt-btn"
                  onClick={() => toggleExpand(plan.id)}
                >
                  {expandedPlans.has(plan.id) ? '▼ Hide Details' : '▶ View Details'}
                </button>
                {expandedPlans.has(plan.id) && (
                  <pre className="plan-prompt">{plan.prompt}</pre>
                )}
              </div>
            )}

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

