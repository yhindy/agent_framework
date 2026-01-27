import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SuperAgentView from '../SuperAgentView'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import React from 'react'
import { KeyboardShortcutsProvider } from '../../contexts/KeyboardShortcutsContext'
import { SnackbarProvider } from '../../contexts/SnackbarContext'
import { usePRPolling } from '../../hooks/usePRPolling'

// Mock Terminal component to avoid xterm issues in test environment
vi.mock('../Terminal', () => ({
  default: () => <div data-testid="mock-terminal">Terminal Component</div>
}))

// Mock usePRPolling hook
vi.mock('../../hooks/usePRPolling', () => ({
  usePRPolling: vi.fn(() => ({}))
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

    // Wait for data to load - branch name displayed in header
    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })
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

  it('renders header with crown icon for super minion', async () => {
    const { container } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
      expect(container.querySelector('[data-testid="crown-icon"]')).toBeInTheDocument()
    })
  })

  it('renders action buttons', async () => {
    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })

    // Check common action buttons are present
    expect(screen.getByText('Make PR')).toBeInTheDocument()
    expect(screen.getByText('Cursor')).toBeInTheDocument()
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
      expect(expandButton.querySelector('[data-testid="chevron-right-icon"]')).toBeInTheDocument()
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
      expect(collapseButton.querySelector('[data-testid="chevron-left-icon"]')).toBeInTheDocument()
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

describe('SuperAgentView PR Status Check on Load', () => {
  const mockSuperAgentWithPR = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/test-project/master-coordination',
    project: 'test-project',
    feature: 'Master feature',
    status: 'pr_open',
    prUrl: 'https://github.com/test/repo/pull/123',
    prStatus: 'OPEN',
    tool: 'claude',
    mode: 'planning',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    children: [],
    pendingPlans: [],
    taskInvocations: []
  }

  const mockSuperAgentWithoutPR = {
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
    taskInvocations: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])
    vi.mocked(window.electronAPI.checkPullRequestStatus).mockResolvedValue({ status: 'OPEN' })
    vi.mocked(window.electronAPI.detectPullRequest).mockResolvedValue({ found: false })
  })

  it('checks PR status on load when agent has existing prUrl', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithPR)

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(window.electronAPI.checkPullRequestStatus).toHaveBeenCalledWith('super-1')
    })

    // Should refresh agent details after checking PR status
    await waitFor(() => {
      // First call is initial load, second call is after checkPullRequestStatus
      expect(window.electronAPI.getSuperAgentDetails).toHaveBeenCalledTimes(2)
    })
  })

  it('does not check PR status when agent has no prUrl', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithoutPR)

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })

    // Should not check PR status since there's no prUrl
    expect(window.electronAPI.checkPullRequestStatus).not.toHaveBeenCalled()
  })

  it('handles PR status check error gracefully', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithPR)
    vi.mocked(window.electronAPI.checkPullRequestStatus).mockRejectedValue(new Error('PR check failed'))

    // Spy on console.error to verify error is logged
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(window.electronAPI.checkPullRequestStatus).toHaveBeenCalledWith('super-1')
    })

    // Component should still render properly despite the error
    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })

    // Error should be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[SuperAgentView] Failed to check PR status:',
        expect.any(Error)
      )
    })

    consoleSpy.mockRestore()
  })

  it('displays updated PR status after check completes', async () => {
    const initialAgent = { ...mockSuperAgentWithPR, prStatus: 'OPEN' }
    const updatedAgent = { ...mockSuperAgentWithPR, prStatus: 'MERGED' }

    vi.mocked(window.electronAPI.getSuperAgentDetails)
      .mockResolvedValueOnce(initialAgent)
      .mockResolvedValueOnce(updatedAgent)
    vi.mocked(window.electronAPI.checkPullRequestStatus).mockResolvedValue({ status: 'MERGED', mergedAt: new Date().toISOString() })

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    // Wait for PR status to be updated
    await waitFor(() => {
      expect(screen.getByText('PR: MERGED')).toBeInTheDocument()
    })
  })

  it('tries detectPullRequest when no prUrl, not checkPullRequestStatus', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithoutPR)
    vi.mocked(window.electronAPI.detectPullRequest).mockResolvedValue({ found: false })

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })

    // Should call detectPullRequest (not checkPullRequestStatus) when no prUrl
    expect(window.electronAPI.detectPullRequest).toHaveBeenCalledWith('super-1')
    expect(window.electronAPI.checkPullRequestStatus).not.toHaveBeenCalled()
  })

  it('only checks PR status once per session (ref prevents redundant checks)', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithPR)
    vi.mocked(window.electronAPI.checkPullRequestStatus).mockResolvedValue({ status: 'OPEN' })

    const { rerender } = render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    // Wait for initial load and PR check
    await waitFor(() => {
      expect(window.electronAPI.checkPullRequestStatus).toHaveBeenCalledTimes(1)
    })

    // Simulate agent list update which triggers loadAgent again
    // First, reset the getSuperAgentDetails mock to return same data
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithPR)

    // Force a re-render by updating activeProjects (triggers component update)
    rerender(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[{ id: 'test' }]} />} />
        </Routes>
      </TestWrapper>
    )

    // Give time for any potential additional calls
    await new Promise(resolve => setTimeout(resolve, 100))

    // PR status should still only have been checked once
    expect(window.electronAPI.checkPullRequestStatus).toHaveBeenCalledTimes(1)
  })
})

describe('SuperAgentView PR Polling', () => {
  const mockSuperAgentWithOpenPR = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/test-project/master-coordination',
    project: 'test-project',
    feature: 'Master feature',
    status: 'pr_open',
    prUrl: 'https://github.com/test/repo/pull/123',
    prStatus: 'OPEN',
    tool: 'claude',
    mode: 'planning',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    children: [],
    pendingPlans: [],
    taskInvocations: []
  }

  const mockSuperAgentNotPROpen = {
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
    taskInvocations: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])
    vi.mocked(window.electronAPI.checkPullRequestStatus).mockResolvedValue({ status: 'OPEN' })
    vi.mocked(window.electronAPI.detectPullRequest).mockResolvedValue({ found: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls usePRPolling with correct parameters when agent has pr_open status', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentWithOpenPR)

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })

    // The hook should be called - verify it was invoked
    expect(usePRPolling).toHaveBeenCalled()

    // Get the last call arguments
    const lastCallArgs = vi.mocked(usePRPolling).mock.calls[vi.mocked(usePRPolling).mock.calls.length - 1][0]

    // When agent has pr_open status, usePRPolling should be called with enabled: true
    expect(lastCallArgs.enabled).toBe(true)
    expect(lastCallArgs.assignmentIds).toContain('super-1')
  })

  it('calls usePRPolling with enabled: false when agent status is not pr_open', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgentNotPROpen)

    render(
      <TestWrapper initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('master-coordination')).toBeInTheDocument()
    })

    // The hook should be called
    expect(usePRPolling).toHaveBeenCalled()

    // Get the last call arguments - when status is not pr_open, enabled should be false
    const lastCallArgs = vi.mocked(usePRPolling).mock.calls[vi.mocked(usePRPolling).mock.calls.length - 1][0]
    expect(lastCallArgs.enabled).toBe(false)
  })
})

