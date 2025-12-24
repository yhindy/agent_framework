import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ChildStatusCard from '../ChildStatusCard'
import { AgentInfo } from '../../../../main/services/types/ProjectConfig'
import React from 'react'

describe('ChildStatusCard', () => {
  const mockChild: AgentInfo = {
    id: 'child-1',
    agentId: 'child-1',
    branch: 'feature/child-1',
    project: 'test-project',
    feature: 'Test sub-task feature description',
    status: 'in_progress',
    tool: 'claude',
    mode: 'dev',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  }

  it('renders child info correctly', () => {
    render(<ChildStatusCard child={mockChild} onClick={() => {}} />)
    
    expect(screen.getByText('child-1')).toBeInTheDocument()
    expect(screen.getByText('Test sub-task feature description')).toBeInTheDocument()
    expect(screen.getByText('View Terminal →')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<ChildStatusCard child={mockChild} onClick={handleClick} />)
    
    fireEvent.click(screen.getByText('child-1').closest('.child-card')!)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies correct status class', () => {
    const { container } = render(<ChildStatusCard child={mockChild} onClick={() => {}} />)
    const statusDot = container.querySelector('.status-dot')
    expect(statusDot).toHaveClass('in_progress')
  })
})

