import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ChildStatusCard from '../ChildStatusCard'
import { AgentInfo } from '../../../../main/services/types/ProjectConfig'
import React from 'react'

describe('ChildStatusCard', () => {
  const mockChild: AgentInfo = {
    id: 'child-1',
    agentId: 'child-1',
    branch: 'feature/test-project/implement-auth',
    project: 'test-project',
    feature: 'Test sub-task feature description',
    status: 'in_progress',
    tool: 'claude',
    mode: 'dev',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  }

  it('renders child info correctly with shortened branch name', () => {
    render(<ChildStatusCard child={mockChild} onClick={() => {}} />)

    expect(screen.getByText('implement-auth')).toBeInTheDocument()
    expect(screen.getByText('Test sub-task feature description')).toBeInTheDocument()
    expect(screen.getByText('View Terminal →')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn()
    const { container } = render(<ChildStatusCard child={mockChild} onClick={handleClick} />)

    const card = container.querySelector('.child-card')!
    fireEvent.click(card)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies correct status class', () => {
    const { container } = render(<ChildStatusCard child={mockChild} onClick={() => {}} />)
    const statusDot = container.querySelector('.status-dot')
    expect(statusDot).toHaveClass('in_progress')
  })
})

