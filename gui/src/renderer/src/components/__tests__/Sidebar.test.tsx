import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Sidebar from '../Sidebar'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

describe('Sidebar Integration', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  const mockAgents = [
    {
      id: 'super-1',
      agentId: 'super-1',
      isSuperMinion: true,
      terminalPid: 123,
      hasUnread: false,
      lastActivity: new Date().toISOString()
    },
    {
      id: 'child-1',
      agentId: 'child-1',
      parentAgentId: 'super-1',
      terminalPid: 456,
      hasUnread: false,
      lastActivity: new Date().toISOString()
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)
  })

  it('renders super minion and its child', async () => {
    render(
      <MemoryRouter>
        <Sidebar 
          activeProjects={mockProjects} 
          onNavigate={() => {}} 
          onProjectRemove={() => {}} 
          onProjectAdd={() => {}} 
        />
      </MemoryRouter>
    )

    // Wait for agents to load
    await waitFor(() => {
      expect(screen.getByText('super-1')).toBeInTheDocument()
    })

    // Child should also be visible by default (since not collapsed)
    expect(screen.getByText('child-1')).toBeInTheDocument()
    
    // Super minion should have the crown icon (or at least the container)
    const superItem = screen.getByText('super-1').closest('.agent-item')
    expect(superItem).toContainHTML('👑')
  })

  it('collapses children when super minion toggle is clicked', async () => {
    render(
      <MemoryRouter>
        <Sidebar 
          activeProjects={mockProjects} 
          onNavigate={() => {}} 
          onProjectRemove={() => {}} 
          onProjectAdd={() => {}} 
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('super-1')).toBeInTheDocument()
    })

    const superItem = screen.getByText('super-1').closest('.agent-item')!
    const toggle = superItem.querySelector('.collapse-icon')!
    fireEvent.click(toggle)

    // Child should be gone
    expect(screen.queryByText('child-1')).not.toBeInTheDocument()
  })
})

