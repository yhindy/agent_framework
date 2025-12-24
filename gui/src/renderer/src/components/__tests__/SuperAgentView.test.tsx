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

  it('reloads data when PLANS_READY signal is received', async () => {
    let signalCallback: ((agentId: string, signal: string) => void) | null = null
    
    // Capture the signal callback
    vi.mocked(window.electronAPI.onAgentSignal).mockImplementation((cb) => {
      signalCallback = cb
      return vi.fn() // Return unsubscribe function
    })

    render(
      <MemoryRouter initialEntries={['/workspace/super/super-1']}>
        <Routes>
          <Route path="/workspace/super/:agentId" element={<SuperAgentView activeProjects={[]} />} />
        </Routes>
      </MemoryRouter>
    )

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('👑 super-1')).toBeInTheDocument()
    })

    // Initially no plans
    expect(screen.getByText('No plans pending approval.')).toBeInTheDocument()

    // Update mock to return agent with plans
    const agentWithPlans = {
      ...mockSuperAgent,
      pendingPlans: [
        {
          id: 'plan-1',
          shortName: 'auth-fix',
          description: 'Fix authentication',
          prompt: 'Fix the login bug...',
          status: 'pending',
          estimatedComplexity: 'small'
        }
      ]
    }
    vi.mocked(window.electronAPI.getSuperAgentDetails).mockResolvedValue(agentWithPlans)

    // Trigger the signal
    if (signalCallback) {
      signalCallback('super-1', 'PLANS_READY')
    }

    // Should reload and show the plan
    await waitFor(() => {
      expect(screen.getByText('📋 auth-fix')).toBeInTheDocument()
    })
    expect(screen.getByText('Fix authentication')).toBeInTheDocument()
  })
})

