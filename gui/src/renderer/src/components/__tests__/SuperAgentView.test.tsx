import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SuperAgentView from '../SuperAgentView'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import React from 'react'

// Mock Terminal component to avoid xterm issues in test environment
vi.mock('../Terminal', () => ({
  default: () => <div data-testid="mock-terminal">Terminal Component</div>
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

