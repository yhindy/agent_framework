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
    fireEvent.click(superItem)

    // Child should be gone
    expect(screen.queryByText('child-1')).not.toBeInTheDocument()
  })
})

describe('Sidebar plain terminal waiting', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  const mockAgents = [
    {
      id: 'agent-1',
      agentId: 'agent-1',
      terminalPid: 123,
      hasUnread: false,
      lastActivity: new Date().toISOString()
    },
    {
      id: 'agent-2',
      agentId: 'agent-2',
      terminalPid: 456,
      hasUnread: false,
      lastActivity: new Date().toISOString()
    }
  ]

  let waitingForInputCallback: ((terminalId: string, promptText: string) => void) | null = null
  let resumedWorkCallback: ((terminalId: string) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    // Capture the callbacks when they're registered
    vi.mocked(window.electronAPI.onPlainTerminalWaitingForInput).mockImplementation((callback) => {
      waitingForInputCallback = callback
      return vi.fn()
    })

    vi.mocked(window.electronAPI.onPlainTerminalResumedWork).mockImplementation((callback) => {
      resumedWorkCallback = callback
      return vi.fn()
    })
  })

  it('shows badge when plain terminal is waiting', async () => {
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
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Initially no attention badge
    const agentItem = screen.getByText('agent-1').closest('.agent-item')!
    expect(agentItem.querySelector('.attention-badge')).not.toBeInTheDocument()

    // Trigger plain terminal waiting
    waitingForInputCallback?.('agent-1-shell-1', 'Terminal is waiting')

    // Should now show attention badge
    await waitFor(() => {
      const updatedAgentItem = screen.getByText('agent-1').closest('.agent-item')!
      expect(updatedAgentItem.querySelector('.attention-badge')).toBeInTheDocument()
    })
  })

  it('clears badge when plain terminal resumes', async () => {
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
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger waiting state
    waitingForInputCallback?.('agent-1-shell-1', 'Terminal is waiting')

    await waitFor(() => {
      const agentItem = screen.getByText('agent-1').closest('.agent-item')!
      expect(agentItem.querySelector('.attention-badge')).toBeInTheDocument()
    })

    // Trigger resumed state
    resumedWorkCallback?.('agent-1-shell-1')

    // Badge should be cleared
    await waitFor(() => {
      const agentItem = screen.getByText('agent-1').closest('.agent-item')!
      expect(agentItem.querySelector('.attention-badge')).not.toBeInTheDocument()
    })
  })

  it('shows badge if either agent or plain terminal is waiting', async () => {
    let agentWaitingCallback: ((agentId: string, promptText: string) => void) | null = null
    vi.mocked(window.electronAPI.onAgentWaitingForInput).mockImplementation((callback) => {
      agentWaitingCallback = callback
      return vi.fn()
    })

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
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger agent waiting (not plain terminal)
    agentWaitingCallback?.('agent-1', 'Claude is waiting')

    // Should show badge
    await waitFor(() => {
      const agentItem = screen.getByText('agent-1').closest('.agent-item')!
      expect(agentItem.querySelector('.attention-badge')).toBeInTheDocument()
    })

    // Also trigger plain terminal waiting for agent-2
    waitingForInputCallback?.('agent-2-shell-1', 'Terminal is waiting')

    // Both agents should show badges
    await waitFor(() => {
      const agent1Item = screen.getByText('agent-1').closest('.agent-item')!
      const agent2Item = screen.getByText('agent-2').closest('.agent-item')!
      expect(agent1Item.querySelector('.attention-badge')).toBeInTheDocument()
      expect(agent2Item.querySelector('.attention-badge')).toBeInTheDocument()
    })
  })
})

describe('Sidebar waiting indicator suppression', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  const mockAgents = [
    {
      id: 'agent-1',
      agentId: 'agent-1',
      terminalPid: 123,
      hasUnread: false,
      lastActivity: new Date().toISOString()
    },
    {
      id: 'agent-2',
      agentId: 'agent-2',
      terminalPid: 456,
      hasUnread: false,
      lastActivity: new Date().toISOString()
    }
  ]

  let agentWaitingCallback: ((agentId: string, promptText: string) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    vi.mocked(window.electronAPI.onAgentWaitingForInput).mockImplementation((callback) => {
      agentWaitingCallback = callback
      return vi.fn()
    })
  })

  it('shows indicator for waiting agent when viewing different agent', async () => {
    // Start at a different agent route
    render(
      <MemoryRouter initialEntries={['/workspace/agent/agent-2']}>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger agent-1 waiting
    agentWaitingCallback?.('agent-1', 'Claude is waiting')

    // Should show badge for agent-1 (we're viewing agent-2)
    await waitFor(() => {
      const agent1Item = screen.getByText('agent-1').closest('.agent-item')!
      expect(agent1Item.querySelector('.attention-badge')).toBeInTheDocument()
    })
  })

  it('hides indicator for waiting agent when viewing that agent', async () => {
    // Start at agent-1 route (the one that will be waiting)
    render(
      <MemoryRouter initialEntries={['/workspace/agent/agent-1']}>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger agent-1 waiting
    agentWaitingCallback?.('agent-1', 'Claude is waiting')

    // Should NOT show badge for agent-1 (we're viewing it)
    await waitFor(() => {
      const agent1Item = screen.getByText('agent-1').closest('.agent-item')!
      // The item should have the 'active' class but no attention-badge
      expect(agent1Item).toHaveClass('active')
      expect(agent1Item.querySelector('.attention-badge')).not.toBeInTheDocument()
    })
  })

  it('shows badge for non-viewed waiting agent and hides for viewed one simultaneously', async () => {
    // This test verifies that when both agents are waiting,
    // only the non-active one shows the badge

    // Start viewing agent-2
    render(
      <MemoryRouter initialEntries={['/workspace/agent/agent-2']}>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
      expect(screen.getByText('agent-2')).toBeInTheDocument()
    })

    // Trigger both agents waiting
    agentWaitingCallback?.('agent-1', 'Claude is waiting')
    agentWaitingCallback?.('agent-2', 'Claude is waiting')

    // Badge should show for agent-1 (not viewing it)
    // Badge should NOT show for agent-2 (viewing it)
    await waitFor(() => {
      const agent1Item = screen.getByText('agent-1').closest('.agent-item')!
      const agent2Item = screen.getByText('agent-2').closest('.agent-item')!

      // agent-1 is NOT active but is waiting - should show badge
      expect(agent1Item).not.toHaveClass('active')
      expect(agent1Item).toHaveClass('waiting')
      expect(agent1Item.querySelector('.attention-badge')).toBeInTheDocument()

      // agent-2 IS active and waiting - should NOT show badge
      expect(agent2Item).toHaveClass('active')
      expect(agent2Item).toHaveClass('waiting')
      expect(agent2Item.querySelector('.attention-badge')).not.toBeInTheDocument()
    })
  })
})

