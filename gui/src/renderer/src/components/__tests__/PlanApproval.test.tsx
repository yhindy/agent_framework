import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PlanApproval from '../PlanApproval'
import { ChildPlan } from '../../../../main/services/types/ProjectConfig'
import React from 'react'

describe('PlanApproval', () => {
  const mockPlans: ChildPlan[] = [
    {
      id: 'plan-1',
      shortName: 'fix-login',
      branch: 'feature/fix-login',
      description: 'Fix login bug',
      prompt: 'Prompt text',
      status: 'pending',
      estimatedComplexity: 'small'
    }
  ]

  it('renders plans correctly', () => {
    render(<PlanApproval plans={mockPlans} onApprove={() => {}} onReject={() => {}} />)
    
    expect(screen.getByText('Proposed Plans (1)')).toBeInTheDocument()
    expect(screen.getByText('📋 fix-login')).toBeInTheDocument()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
    expect(screen.getByText('small')).toBeInTheDocument()
  })

  it('calls onApprove when approve button is clicked', () => {
    const handleApprove = vi.fn()
    render(<PlanApproval plans={mockPlans} onApprove={handleApprove} onReject={() => {}} />)
    
    fireEvent.click(screen.getByText('✓ Approve'))
    expect(handleApprove).toHaveBeenCalledWith('plan-1')
  })

  it('calls onReject when reject button is clicked', () => {
    const handleReject = vi.fn()
    render(<PlanApproval plans={mockPlans} onApprove={() => {}} onReject={handleReject} />)
    
    fireEvent.click(screen.getByText('✗ Reject'))
    expect(handleReject).toHaveBeenCalledWith('plan-1')
  })

  it('renders empty hint when no plans', () => {
    render(<PlanApproval plans={[]} onApprove={() => {}} onReject={() => {}} />)
    
    expect(screen.getByText('No plans pending approval.')).toBeInTheDocument()
  })
})

