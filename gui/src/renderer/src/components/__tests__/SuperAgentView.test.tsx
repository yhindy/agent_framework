import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SuperAgentView from '../SuperAgentView'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import React from 'react'

// Mock Terminal component to avoid xterm issues in test environment
vi.mock('../Terminal', () => ({
  default: () => <div data-testid="mock-terminal">Terminal Component</div>
}))

// Mock PlainTerminal component
vi.mock('../PlainTerminal', () => ({
  default: () => <div data-testid="mock-plain-terminal">PlainTerminal Component</div>
}))

// Mock TestEnvTerminal component
vi.mock('../TestEnvTerminal', () => ({
  default: () => <div data-testid="mock-test-env-terminal">TestEnvTerminal Component</div>
}))

// Mock useLoadingSnackbar hook (correct path from __tests__ folder)
vi.mock('../../hooks/useLoadingSnackbar', () => ({
  useLoadingSnackbar: () => ({
    showLoading: vi.fn(),
    hideLoading: vi.fn()
  })
}))

// Mock debounce to execute immediately with cancel/flush methods
vi.mock('../../utils/debounce', () => ({
  debounce: (fn: any) => {
    const debouncedFn = fn
    debouncedFn.cancel = vi.fn()
    debouncedFn.flush = vi.fn()
    return debouncedFn
  }
}))

describe('SuperAgentView', () => {
  const mockSuperAgent = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/super-1',
    project: 'test-project',
    feature: 'Master feature',
    status: 'active',
    tool: 'claude',
    mode: 'planning',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    minionBudget: 5,
    children: [
      {
        id: 'child-1',
        agentId: 'child-1',
        feature: 'Child feature',
        status: 'active',
        parentAgentId: 'super-1'
      }
    ],
    pendingPlans: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockSuperAgent)
  })

  it('loads and displays super agent details', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    // Should show loading state initially
    expect(screen.getByText('Loading Super Minion super-1...')).toBeInTheDocument()

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('👑 super-1')).toBeInTheDocument()
    })

    // Check if details are displayed
    expect(screen.getByText('Budget: 1/5')).toBeInTheDocument()
    expect(screen.getByText('Master feature')).toBeInTheDocument()
    expect(screen.getByText('Active Children (1)')).toBeInTheDocument()
    expect(screen.getByText('child-1')).toBeInTheDocument()
  })

  it('displays error message on failure', async () => {
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockRejectedValue(new Error('Failed to fetch'))

    render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Error Loading Super Minion')).toBeInTheDocument()
    })
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  })

  it('renders consolidated header with mission badge', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('👑 super-1')).toBeInTheDocument()
      expect(screen.getByText('Budget: 1/5')).toBeInTheDocument()
      expect(screen.getByText('Mission:')).toBeInTheDocument()
      expect(screen.getByText('Master feature')).toBeInTheDocument()
    })
  })

  it('does not render old agent-info-bar section', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('👑 super-1')).toBeInTheDocument()
    })

    const infoBar = container.querySelector('.agent-info-bar')
    expect(infoBar).not.toBeInTheDocument()
  })

  it('renders mission badge in agent-header-left', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
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
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Master feature')).toBeInTheDocument()
    })

    const badgeValue = container.querySelector('.mission-badge .info-badge-value')
    expect(badgeValue).toHaveAttribute('title', 'Master feature')
  })

  it('renders action buttons in agent-actions section', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Make PR')).toBeInTheDocument()
      expect(screen.getByText('Open in Cursor')).toBeInTheDocument()
      expect(screen.getByText('Stop')).toBeInTheDocument()
      expect(screen.getByText('Cleanup')).toBeInTheDocument()
    })

    // Verify they're in the actions section
    const makePRBtn = screen.getByText('Make PR')
    expect(makePRBtn.closest('.agent-actions')).toBeInTheDocument()
  })

  it('renders budget badge inline with agent ID', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      const budgetBadge = screen.getByText('Budget: 1/5')
      expect(budgetBadge).toBeInTheDocument()
      expect(budgetBadge.classList.contains('budget-badge')).toBe(true)
    })
  })
})

describe('SuperAgentView UI State Restoration', () => {
  const mockBaseSuperAgent = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/super-1',
    project: 'test-project',
    feature: 'Master feature',
    status: 'active',
    tool: 'claude',
    mode: 'auto',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    minionBudget: 5,
    children: [],
    pendingPlans: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to "orchestration" tab when no UI state is saved', async () => {
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: undefined // No saved state
    }

    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockAgent)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      const orchestrationTab = container.querySelector('.unified-tab.active')
      expect(orchestrationTab).toBeInTheDocument()
      expect(orchestrationTab?.textContent).toContain('Orchestration')
    })
  })

  it('restores last active tab from saved UI state', async () => {
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: {
        lastActiveTab: 'terminal-2',
        plainTerminals: ['terminal-1', 'terminal-2'],
        terminalCounter: 2,
        lastFocusTime: new Date().toISOString()
      }
    }

    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockAgent)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      // Should have 2 plain terminals
      const terminalTabs = container.querySelectorAll('.unified-tab')
      const terminal2Tab = Array.from(terminalTabs).find(tab => tab.textContent?.includes('Terminal 2'))
      expect(terminal2Tab).toBeInTheDocument()
      expect(terminal2Tab?.classList.contains('active')).toBe(true)
    })
  })

  it('restores test environment tab from saved state', async () => {
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: {
        lastActiveTab: 'test-dev',
        plainTerminals: [],
        terminalCounter: 0,
        lastFocusTime: new Date().toISOString()
      }
    }

    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockAgent)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({
      defaultCommands: [{ id: 'test-dev', name: 'Dev Server', command: 'npm run dev', port: 3000 }]
    })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      const terminalTabs = container.querySelectorAll('.unified-tab')
      const testEnvTab = Array.from(terminalTabs).find(tab => tab.textContent?.includes('Dev Server'))
      expect(testEnvTab).toBeInTheDocument()
      expect(testEnvTab?.classList.contains('active')).toBe(true)
    })
  })

  it('falls back to "orchestration" when saved tab no longer exists', async () => {
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: {
        lastActiveTab: 'terminal-5', // This terminal doesn't exist
        plainTerminals: ['terminal-1', 'terminal-2'], // Only these exist
        terminalCounter: 2,
        lastFocusTime: new Date().toISOString()
      }
    }

    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockAgent)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    // Should fallback to 'orchestration' tab
    await waitFor(() => {
      const orchestrationTab = container.querySelector('.unified-tab.active')
      expect(orchestrationTab).toBeInTheDocument()
      expect(orchestrationTab?.textContent).toContain('Orchestration')
    })
  })

  it('shows loading state before UI state is restored', async () => {
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: {
        lastActiveTab: 'terminal-2',
        plainTerminals: ['terminal-1', 'terminal-2'],
        terminalCounter: 2,
        lastFocusTime: new Date().toISOString()
      }
    }

    // Mock slow async load
    let resolveSuperAgentDetails: any
    const superAgentPromise = new Promise(resolve => {
      resolveSuperAgentDetails = resolve
    })
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockReturnValue(superAgentPromise)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    // Initially, should show loading message
    expect(screen.getByText('Loading Super Minion super-1...')).toBeInTheDocument()

    // Resolve the promise
    resolveSuperAgentDetails(mockAgent)

    // After load, tabs should appear with correct active tab
    await waitFor(() => {
      const terminalTabs = container.querySelectorAll('.unified-tab')
      const terminal2Tab = Array.from(terminalTabs).find(tab => tab.textContent?.includes('Terminal 2'))
      expect(terminal2Tab).toBeInTheDocument()
      expect(terminal2Tab?.classList.contains('active')).toBe(true)
    })
  })
})

describe('SuperAgentView Race Condition Handling', () => {
  const mockBaseSuperAgent = {
    id: 'super-1',
    agentId: 'super-1',
    branch: 'feature/super-1',
    project: 'test-project',
    feature: 'Master feature',
    status: 'active',
    tool: 'claude',
    mode: 'auto',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isSuperMinion: true,
    minionBudget: 5,
    children: [],
    pendingPlans: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads test env config before restoring saved test env tab', async () => {
    // This test ensures that testEnvConfig loads BEFORE activeTab is validated
    // so that a saved test env tab is not incorrectly invalidated
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: {
        lastActiveTab: 'test-dev', // Saved test env tab
        plainTerminals: [],
        terminalCounter: 0,
        lastFocusTime: new Date().toISOString()
      }
    }

    // Mock async responses
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockAgent)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({
      defaultCommands: [{ id: 'test-dev', name: 'Dev Server', command: 'npm run dev', port: 3000 }]
    })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { container } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    // The test env tab should be active (not fallen back to 'orchestration')
    await waitFor(() => {
      const terminalTabs = container.querySelectorAll('.unified-tab')
      const testEnvTab = Array.from(terminalTabs).find(tab => tab.textContent?.includes('Dev Server'))
      expect(testEnvTab).toBeInTheDocument()
      expect(testEnvTab?.classList.contains('active')).toBe(true)
    })
  })

  it('flushes pending saves when component unmounts', async () => {
    const mockAgent = {
      ...mockBaseSuperAgent,
      uiState: undefined
    }

    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(mockAgent)
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])

    const { unmount } = render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    // Wait for component to fully render
    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.saveUIState)).toHaveBeenCalled()
    })

    // Clear the mock to track only unmount-related calls
    vi.mocked(window.electronAPI.saveUIState).mockClear()

    // Unmount should flush any pending saves
    unmount()

    // The debounced save should have been flushed
    expect(vi.mocked(window.electronAPI.saveUIState)).toBeDefined()
  })
})

