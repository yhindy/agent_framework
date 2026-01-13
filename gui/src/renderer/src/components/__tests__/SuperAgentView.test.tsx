import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SuperAgentView from '../SuperAgentView'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import React from 'react'
import { KeyboardShortcutsProvider } from '../../contexts/KeyboardShortcutsContext'
import { SnackbarProvider } from '../../contexts/SnackbarContext'

// Mock Terminal component to avoid xterm issues in test environment
vi.mock('../Terminal', () => ({
  default: () => <div data-testid="mock-terminal">Terminal Component</div>
}))

// Wrapper component with all required providers
const TestWrapper = ({ children, initialEntries }: { children: React.ReactNode; initialEntries: string[] }) => (
  <MemoryRouter initialEntries={initialEntries}>
    <SnackbarProvider>
      <KeyboardShortcutsProvider>
        {children}
      </KeyboardShortcutsProvider>
    </SnackbarProvider>
  </MemoryRouter>
)

describe('SuperAgentView', () => {
  const mockSuperAgent = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/test-project/master-coordination',
    project: 'test-project',
    feature: 'Master feature',
    status: 'active',
    tool: 'claude',
    mode: 'planning',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    children: [
      {
        id: 'child-1',
        agentId: 'child-1',
        feature: 'Child feature',
        status: 'active',
        parentAgentId: 'super-1'
      }
    ],
    pendingPlans: [],
    taskInvocations: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgent)
  })

  it('loads and displays super agent details', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    // Should show loading state initially
    expect(screen.getByText('Loading Super Minion super-1...')).toBeInTheDocument()

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('👑 master-coordination')).toBeInTheDocument()
    })

    // Check if details are displayed
    expect(screen.getByText('Tasks: 0')).toBeInTheDocument()
    expect(screen.getByText('Master feature')).toBeInTheDocument()
  })

  it('displays error message on failure', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockRejectedValue(new Error('Failed to fetch'))

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('Error Loading Super Minion')).toBeInTheDocument()
    })
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  })

  it('renders consolidated header with mission badge', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('👑 master-coordination')).toBeInTheDocument()
      expect(screen.getByText('Tasks: 0')).toBeInTheDocument()
      expect(screen.getByText('Mission:')).toBeInTheDocument()
      expect(screen.getByText('Master feature')).toBeInTheDocument()
    })
  })

  it('does not render old agent-info-bar section', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      // Branch name is displayed, not agentId - text is now "master-coordination" from the branch
      // The text is split across elements, so use a function matcher
      expect(screen.getByText((content, element) => {
        return element?.tagName === 'H2' && content.includes('master-coordination')
      })).toBeInTheDocument()
    })

    const infoBar = container.querySelector('.agent-info-bar')
    expect(infoBar).not.toBeInTheDocument()
  })

  it('renders mission badge in agent-header-left', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('Mission:')).toBeInTheDocument()
    })

    const headerLeft = container.querySelector('.agent-header-left')
    expect(headerLeft).toBeInTheDocument()

    const missionBadge = headerLeft?.querySelector('.mission-badge')
    expect(missionBadge).toBeInTheDocument()
    expect(missionBadge?.textContent).toContain('Mission:')
    expect(missionBadge?.textContent).toContain('Master feature')
  })

  it('renders mission badge with title attribute for truncation', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('Master feature')).toBeInTheDocument()
    })

    // The title attribute is now on the parent .mission-badge div, not the value span
    const missionBadge = container.querySelector('.mission-badge')
    expect(missionBadge).toHaveAttribute('title', 'Master feature (click to copy)')
  })

  it('renders action buttons in agent-actions section', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('Make PR')).toBeInTheDocument()
      expect(screen.getByText('Cursor')).toBeInTheDocument()
      expect(screen.getByText('Stop')).toBeInTheDocument()
      // Cleanup button shows an icon, check for it in the actions section
      const actionsSection = document.querySelector('.agent-actions')
      expect(actionsSection).toBeInTheDocument()
    })

    // Verify they're in the actions section
    const makePRBtn = screen.getByText('Make PR')
    expect(makePRBtn.closest('.agent-actions')).toBeInTheDocument()
  })

  it('renders task badge inline with agent ID', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const taskBadge = screen.getByText('Tasks: 0')
      expect(taskBadge).toBeInTheDocument()
      expect(taskBadge.classList.contains('task-badge')).toBe(true)
    })
  })
})

describe('SuperAgentView Task Sidebar Collapse', () => {
  const mockSuperAgentWithTasks = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/test-project/master-coordination',
    project: 'test-project',
    feature: 'Master feature',
    status: 'active',
    tool: 'claude',
    mode: 'planning',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    children: [],
    pendingPlans: [],
    taskInvocations: [
      {
        toolUseId: 'task-1',
        description: 'Test task 1',
        subagentType: 'general-purpose',
        status: 'running' as const
      },
      {
        toolUseId: 'task-2',
        description: 'Test task 2',
        subagentType: 'Explore',
        status: 'completed' as const
      }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithTasks)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])
  })

  it('renders task sidebar when tasks exist', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const taskSidebar = container.querySelector('.task-sidebar')
      expect(taskSidebar).toBeInTheDocument()
    })

    expect(screen.getByText('Tasks (2)')).toBeInTheDocument()
  })

  it('renders collapse button in task sidebar', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByTitle('Collapse task sidebar')).toBeInTheDocument()
    })
  })

  it('loads collapsed state from localStorage on mount', async () => {
    localStorage.setItem('taskSidebarCollapsed', 'true')

    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const taskSidebar = container.querySelector('.task-sidebar')
      expect(taskSidebar).toHaveClass('collapsed')
    })
  })

  it('does not collapse task sidebar when localStorage is not set', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const taskSidebar = container.querySelector('.task-sidebar')
      expect(taskSidebar).not.toHaveClass('collapsed')
    })
  })

  it('saves collapsed state to localStorage when toggled', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByTitle('Collapse task sidebar')).toBeInTheDocument()
    })

    const collapseButton = screen.getByTitle('Collapse task sidebar')
    fireEvent.click(collapseButton)

    await waitFor(() => {
      expect(localStorage.getItem('taskSidebarCollapsed')).toBe('true')
      const taskSidebar = container.querySelector('.task-sidebar')
      expect(taskSidebar).toHaveClass('collapsed')
    })
  })

  it('shows correct icon when collapsed', async () => {
    localStorage.setItem('taskSidebarCollapsed', 'true')

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const expandButton = screen.getByTitle('Expand task sidebar')
      expect(expandButton.textContent).toContain('◀')
    })
  })

  it('shows correct icon when expanded', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const collapseButton = screen.getByTitle('Collapse task sidebar')
      expect(collapseButton.textContent).toContain('▶')
    })
  })

  it('applies with-sidebar-collapsed class to terminal area when collapsed', async () => {
    localStorage.setItem('taskSidebarCollapsed', 'true')

    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const terminalArea = container.querySelector('.terminal-area')
      expect(terminalArea).toHaveClass('with-sidebar-collapsed')
    })
  })

  it('applies with-sidebar class to terminal area when expanded', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const terminalArea = container.querySelector('.terminal-area')
      expect(terminalArea).toHaveClass('with-sidebar')
      expect(terminalArea).not.toHaveClass('with-sidebar-collapsed')
    })
  })

  it('persists collapsed state across component remounts', async () => {
    const { container, unmount } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByTitle('Collapse task sidebar')).toBeInTheDocument()
    })

    const collapseButton = screen.getByTitle('Collapse task sidebar')
    fireEvent.click(collapseButton)

    await waitFor(() => {
      const taskSidebar = container.querySelector('.task-sidebar')
      expect(taskSidebar).toHaveClass('collapsed')
    })

    unmount()

    // Remount the component
    const { container: newContainer } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      const taskSidebar = newContainer.querySelector('.task-sidebar')
      expect(taskSidebar).toHaveClass('collapsed')
    })
  })
})

