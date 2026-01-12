import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Sidebar from '../Sidebar'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

describe('Sidebar Collapse', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  const mockAgents = [
    {
      id: 'agent-1',
      agentId: 'agent-1',
      terminalPid: 123,
      hasUnread: false,
      lastActivity: new Date().toISOString(),
      branch: 'feature/test-project/test-feature'
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)
  })

  it('renders collapse button', async () => {
    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    const collapseButton = screen.getByTitle('Collapse sidebar')
    expect(collapseButton).toBeInTheDocument()
  })

  it('calls onToggleCollapse when collapse button is clicked', async () => {
    const mockToggle = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={mockToggle}
        />
      </MemoryRouter>
    )

    const collapseButton = screen.getByTitle('Collapse sidebar')
    fireEvent.click(collapseButton)

    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('applies collapsed class when isCollapsed is true', async () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={true}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    const sidebar = container.querySelector('.sidebar')
    expect(sidebar).toHaveClass('collapsed')
  })

  it('does not apply collapsed class when isCollapsed is false', async () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    const sidebar = container.querySelector('.sidebar')
    expect(sidebar).not.toHaveClass('collapsed')
  })

  it('shows correct icon when collapsed', async () => {
    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={true}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    const collapseButton = screen.getByTitle('Expand sidebar')
    expect(collapseButton.textContent).toContain('▶')
  })

  it('shows correct icon when expanded', async () => {
    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    const collapseButton = screen.getByTitle('Collapse sidebar')
    expect(collapseButton.textContent).toContain('◀')
  })
})

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
    localStorage.removeItem('collapsedSuperMinions')
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)
  })

  it('collapses super minion children by default on first load', async () => {
    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // Wait for agents to load
    await waitFor(() => {
      expect(screen.getByText('super-1')).toBeInTheDocument()
    })

    // Child should be hidden by default on first load
    expect(screen.queryByText('child-1')).not.toBeInTheDocument()

    // Super minion should have the leading icons container with crown
    const superItem = screen.getByText('super-1').closest('.agent-item')
    const leadingIcons = superItem?.querySelector('.agent-leading-icons')
    expect(leadingIcons).toBeInTheDocument()
    expect(leadingIcons).toContainHTML('👑')
  })

  it('toggles children when super minion chevron is clicked', async () => {
    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('super-1')).toBeInTheDocument()
    })

    const chevron = screen.getByTitle('Toggle child agents')
    fireEvent.click(chevron)

    expect(screen.getByText('child-1')).toBeInTheDocument()

    fireEvent.click(chevron)

    // Child should be gone again
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
          isCollapsed={false}
          onToggleCollapse={() => {}}
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
          isCollapsed={false}
          onToggleCollapse={() => {}}
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
    let agentStateCallback: ((agentId: string, state: 'working' | 'waiting' | 'unknown') => void) | null = null
    vi.mocked(window.electronAPI.onAgentStateChanged).mockImplementation((callback) => {
      agentStateCallback = callback
      return vi.fn()
    })

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger agent waiting via state change (not plain terminal)
    // At this point, agentStateCallback has been assigned during render
    agentStateCallback!('agent-1', 'waiting')

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

  let agentStateCallback: ((agentId: string, state: 'working' | 'waiting' | 'unknown') => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    vi.mocked(window.electronAPI.onAgentStateChanged).mockImplementation((callback) => {
      agentStateCallback = callback
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
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger agent-1 waiting via state change
    agentStateCallback?.('agent-1', 'waiting')

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
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    // Trigger agent-1 waiting via state change
    agentStateCallback?.('agent-1', 'waiting')

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
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
      expect(screen.getByText('agent-2')).toBeInTheDocument()
    })

    // Trigger both agents waiting via state change
    agentStateCallback?.('agent-1', 'waiting')
    agentStateCallback?.('agent-2', 'waiting')

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

describe('Sidebar branch name display', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays branch name for regular agents with standard format', async () => {
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/add-dark-mode'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // Wait for async agent loading
    await waitFor(() => {
      // Should display only the descriptive part as the agent identifier
      expect(screen.getByText('add-dark-mode')).toBeInTheDocument()
    })

    // Should NOT display the agent ID when branch is available
    expect(screen.queryByText('agent-1')).not.toBeInTheDocument()

    // Should NOT display the full branch path
    expect(screen.queryByText('feature/test-project/add-dark-mode')).not.toBeInTheDocument()
  })

  it('displays full branch name when format does not match expected pattern', async () => {
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'main'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // When branch format doesn't match (less than 3 parts), display the full branch
    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    // Agent ID should NOT be displayed when branch is available
    expect(screen.queryByText('agent-1')).not.toBeInTheDocument()
  })

  it('displays agent ID as fallback when branch field is missing', async () => {
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString()
        // No branch field
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // When no branch is available, agent ID should be displayed
    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    const agentItem = screen.getByText('agent-1').closest('.agent-item')!
    // Should have agent-id class, not agent-branch
    expect(agentItem.querySelector('.agent-id')).toBeInTheDocument()
    expect(agentItem.querySelector('.agent-branch')).not.toBeInTheDocument()
  })

  it('does not display branch for base branch agents', async () => {
    const mockAgents = [
      {
        id: 'base-1',
        agentId: 'base-1',
        assignmentId: 'project-base-123',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        isBaseBranchAgent: true,
        branch: 'main'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/\(Base\)/)).toBeInTheDocument()
    })

    // Should not display branch name even though branch field exists
    expect(screen.queryByText('main')).not.toBeInTheDocument()

    const agentItem = screen.getByText(/\(Base\)/).closest('.agent-item')!
    expect(agentItem.querySelector('.agent-branch')).not.toBeInTheDocument()
  })

  it('handles nested branch names correctly', async () => {
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/ui/button-improvements'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // Should display the nested path after feature/project-id
    await waitFor(() => {
      expect(screen.getByText('ui/button-improvements')).toBeInTheDocument()
    })

    // Agent ID should NOT be displayed when branch is available
    expect(screen.queryByText('agent-1')).not.toBeInTheDocument()
  })

  it('shows full branch path in title attribute on hover', async () => {
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/add-dark-mode'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('add-dark-mode')).toBeInTheDocument()
    })

    const branchElement = screen.getByText('add-dark-mode')
    expect(branchElement).toHaveAttribute('title', 'feature/test-project/add-dark-mode')
  })

  it('displays branch for super minions', async () => {
    const mockAgents = [
      {
        id: 'super-1',
        agentId: 'super-1',
        isSuperMinion: true,
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/super-task'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // Super minions with a branch should display the branch name, not the agent ID
    await waitFor(() => {
      expect(screen.getByText('super-task')).toBeInTheDocument()
    })

    // Agent ID should NOT be displayed when branch is available
    expect(screen.queryByText('super-1')).not.toBeInTheDocument()
  })

  it('truncates very long branch names with ellipsis', async () => {
    const longBranchPart = 'this-is-a-very-long-branch-name-that-should-be-truncated-with-ellipsis'
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: `feature/test-project/${longBranchPart}`
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // Wait for the branch name to be displayed
    await waitFor(() => {
      expect(screen.getByText(longBranchPart)).toBeInTheDocument()
    })

    const branchElement = container.querySelector('.agent-branch')!
    expect(branchElement).toBeInTheDocument()

    // Verify the branch element has the correct CSS class which applies truncation styles
    expect(branchElement).toHaveClass('agent-branch')

    // Verify it's inside the name container that enables truncation
    const nameContainer = container.querySelector('.agent-name-container')
    expect(nameContainer).toBeInTheDocument()
    expect(nameContainer?.contains(branchElement)).toBe(true)
  })
})

describe('Sidebar long branch name with status indicators', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  let agentStateCallback: ((agentId: string, state: 'working' | 'waiting' | 'unknown') => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(window.electronAPI.onAgentStateChanged).mockImplementation((callback) => {
      agentStateCallback = callback
      return vi.fn()
    })
  })

  it('keeps status indicators visible with very long branch names', async () => {
    const veryLongBranchPart = 'this-is-an-extremely-long-branch-name-that-would-definitely-overflow-the-sidebar-width-and-push-indicators-out-of-view'
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        tool: 'claude',
        lastActivity: new Date().toISOString(),
        branch: `feature/test-project/${veryLongBranchPart}`
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      const branchElement = container.querySelector('.agent-branch')
      expect(branchElement).toBeInTheDocument()
    })

    // Trigger waiting state
    agentStateCallback?.('agent-1', 'waiting')

    await waitFor(() => {
      // The attention badge should be in its own container that cannot be pushed out
      const statusContainer = container.querySelector('.agent-status-indicators')
      expect(statusContainer).toBeInTheDocument()

      const attentionBadge = statusContainer?.querySelector('.attention-badge')
      expect(attentionBadge).toBeInTheDocument()
    })

    // Verify the layout structure: status-indicators is a sibling of agent-info, not inside it
    const agentItem = container.querySelector('.agent-item')!
    const agentInfo = agentItem.querySelector('.agent-info')!
    const statusIndicators = agentItem.querySelector('.agent-status-indicators')!

    // Both should be direct children of agent-item
    expect(agentInfo.parentElement).toBe(agentItem)
    expect(statusIndicators.parentElement).toBe(agentItem)

    // status-indicators should NOT be inside agent-info (this ensures it won't be pushed out)
    expect(agentInfo.contains(statusIndicators)).toBe(false)

    // Verify the DOM structure has the name container for truncation
    const nameContainer = agentInfo.querySelector('.agent-name-container')
    expect(nameContainer).toBeInTheDocument()
  })

  it('keeps spinner visible with very long branch names', async () => {
    const veryLongBranchName = 'feature/test-project/another-extremely-long-branch-name-for-testing-spinner-visibility'
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: false,
        tool: 'claude',
        lastActivity: new Date().toISOString(),
        branch: veryLongBranchName
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      const branchElement = container.querySelector('.agent-branch')
      expect(branchElement).toBeInTheDocument()
    })

    // Spinner should be visible (agent has terminalPid and is not waiting)
    const statusContainer = container.querySelector('.agent-status-indicators')
    expect(statusContainer).toBeInTheDocument()

    const spinner = statusContainer?.querySelector('.agent-spinner')
    expect(spinner).toBeInTheDocument()
  })

  it('keeps unread badge visible with very long branch names', async () => {
    const veryLongBranchName = 'feature/test-project/yet-another-extremely-long-branch-name-for-testing-unread-badge-visibility'
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: null, // No terminal, so no spinner
        hasUnread: true,
        lastActivity: new Date().toISOString(),
        branch: veryLongBranchName
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      const branchElement = container.querySelector('.agent-branch')
      expect(branchElement).toBeInTheDocument()
    })

    // Unread badge should be visible in the status container
    const statusContainer = container.querySelector('.agent-status-indicators')
    expect(statusContainer).toBeInTheDocument()

    const unreadBadge = statusContainer?.querySelector('.unread-badge')
    expect(unreadBadge).toBeInTheDocument()
  })

  it('has correct DOM structure with agent-name-container', async () => {
    const mockAgents = [
      {
        id: 'agent-1',
        agentId: 'agent-1',
        terminalPid: 123,
        hasUnread: true,
        tool: 'claude',
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/some-branch'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    const { container } = render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      const agentItem = container.querySelector('.agent-item')
      expect(agentItem).toBeInTheDocument()
    })

    const agentItem = container.querySelector('.agent-item')!

    // Verify new DOM structure
    const agentInfo = agentItem.querySelector('.agent-info')
    expect(agentInfo).toBeInTheDocument()

    // agent-info should contain: leading-icons + name-container
    const leadingIcons = agentInfo?.querySelector('.agent-leading-icons')
    expect(leadingIcons).toBeInTheDocument()

    const nameContainer = agentInfo?.querySelector('.agent-name-container')
    expect(nameContainer).toBeInTheDocument()

    // branch should be inside name-container
    const branch = nameContainer?.querySelector('.agent-branch')
    expect(branch).toBeInTheDocument()

    // status-indicators should be a sibling of agent-info, not inside it
    const statusIndicators = agentItem.querySelector('.agent-status-indicators')
    expect(statusIndicators).toBeInTheDocument()
    expect(agentInfo?.contains(statusIndicators)).toBe(false)
  })
})

describe('Sidebar icon alignment', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render consistent leading icon structure for all agent types', async () => {
    const mockAgents = [
      {
        id: 'super-1',
        agentId: 'super-1',
        isSuperMinion: true,
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/super-task'
      },
      {
        id: 'normal-1',
        agentId: 'normal-1',
        terminalPid: 456,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        branch: 'feature/test-project/normal-task'
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    // When agents have branches, the branch name is displayed instead of agent ID
    await waitFor(() => {
      expect(screen.getByText('super-task')).toBeInTheDocument()
      expect(screen.getByText('normal-task')).toBeInTheDocument()
    })

    // Both should have .agent-leading-icons container
    const superItem = screen.getByText('super-task').closest('.agent-item')
    const normalItem = screen.getByText('normal-task').closest('.agent-item')

    const superLeading = superItem?.querySelector('.agent-leading-icons')
    const normalLeading = normalItem?.querySelector('.agent-leading-icons')

    expect(superLeading).toBeInTheDocument()
    expect(normalLeading).toBeInTheDocument()

    // Both should have either chevron or chevron-placeholder
    expect(superLeading?.querySelector('.collapse-chevron')).toBeInTheDocument()
    expect(normalLeading?.querySelector('.chevron-placeholder')).toBeInTheDocument()

    // Both should have .agent-type-icon
    expect(superLeading?.querySelector('.agent-type-icon')).toBeInTheDocument()
    expect(normalLeading?.querySelector('.agent-type-icon')).toBeInTheDocument()
  })

  it('should render chevron-placeholder for non-super-minions', async () => {
    const mockAgents = [
      {
        id: 'normal-1',
        agentId: 'normal-1',
        terminalPid: 456,
        hasUnread: false,
        lastActivity: new Date().toISOString()
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('normal-1')).toBeInTheDocument()
    })

    const normalItem = screen.getByText('normal-1').closest('.agent-item')
    const leadingIcons = normalItem?.querySelector('.agent-leading-icons')

    expect(leadingIcons?.querySelector('.chevron-placeholder')).toBeInTheDocument()
    expect(leadingIcons?.querySelector('.collapse-chevron')).not.toBeInTheDocument()
  })

  it('should render banana indicator for normal minions', async () => {
    const mockAgents = [
      {
        id: 'normal-1',
        agentId: 'normal-1',
        terminalPid: 456,
        hasUnread: false,
        lastActivity: new Date().toISOString()
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('normal-1')).toBeInTheDocument()
    })

    const normalItem = screen.getByText('normal-1').closest('.agent-item')
    const typeIcon = normalItem?.querySelector('.agent-type-icon')

    expect(typeIcon).toBeInTheDocument()
    expect(typeIcon?.textContent).toBe('🍌')
  })

  it('should render correct icon for each agent type', async () => {
    // Using agents without branches so agent ID is displayed
    const mockAgents = [
      {
        id: 'super-1',
        agentId: 'super-1',
        isSuperMinion: true,
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString()
        // No branch - will display agent ID
      },
      {
        id: 'base-1',
        agentId: 'base-1',
        isBaseBranchAgent: true,
        assignmentId: 'project-base-123',
        terminalPid: 456,
        hasUnread: false,
        lastActivity: new Date().toISOString()
        // Base branch agents always show "(Base)" label
      },
      {
        id: 'normal-1',
        agentId: 'normal-1',
        terminalPid: 789,
        hasUnread: false,
        lastActivity: new Date().toISOString()
        // No branch - will display agent ID
      }
    ]

    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue(mockAgents)

    render(
      <MemoryRouter>
        <Sidebar
          activeProjects={mockProjects}
          onNavigate={() => {}}
          onProjectRemove={() => {}}
          onProjectAdd={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('super-1')).toBeInTheDocument()
      expect(screen.getByText(/\(Base\)/)).toBeInTheDocument()
      expect(screen.getByText('normal-1')).toBeInTheDocument()
    })

    // Super minion → 👑
    const superItem = screen.getByText('super-1').closest('.agent-item')
    const superIcon = superItem?.querySelector('.agent-type-icon')
    expect(superIcon?.textContent).toBe('👑')

    // Base branch → 🏠
    const baseItem = screen.getByText(/\(Base\)/).closest('.agent-item')
    const baseIcon = baseItem?.querySelector('.agent-type-icon')
    expect(baseIcon?.textContent).toBe('🏠')

    // Normal minion → 🍌
    const normalItem = screen.getByText('normal-1').closest('.agent-item')
    const normalIcon = normalItem?.querySelector('.agent-type-icon')
    expect(normalIcon?.textContent).toBe('🍌')
  })
})
