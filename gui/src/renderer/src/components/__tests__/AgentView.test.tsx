import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AgentView from '../AgentView'

// Mock dependencies
vi.mock('../Terminal', () => ({
  default: () => <div>Mocked Terminal</div>
}))

vi.mock('../PlainTerminal', () => ({
  default: () => <div>Mocked PlainTerminal</div>
}))

vi.mock('../TestEnvTerminal', () => ({
  default: () => <div>Mocked TestEnvTerminal</div>
}))

vi.mock('../ConfirmModal', () => ({
  default: () => <div>Mocked ConfirmModal</div>
}))

vi.mock('../../hooks/usePRCreation', () => ({
  usePRCreation: () => ({
    showPRConfirm: false,
    setShowPRConfirm: vi.fn(),
    autoCommit: false,
    setAutoCommit: vi.fn(),
    isCreatingPR: false,
    prMessages: [],
    handleCreatePRClick: vi.fn(),
    handleConfirmCreatePR: vi.fn()
  })
}))

vi.mock('../../hooks/useLoadingSnackbar', () => ({
  useLoadingSnackbar: () => ({
    showLoading: vi.fn(),
    hideLoading: vi.fn()
  })
}))

vi.mock('../../hooks/usePRPolling', () => ({
  usePRPolling: () => ({})
}))

vi.mock('../../utils/debounce', () => ({
  debounce: (fn: any) => {
    fn.cancel = vi.fn()
    return fn
  }
}))

// Wrapper component to provide routing context
const TestWrapper = ({ children, agentId = 'test-agent' }: { children: React.ReactNode; agentId?: string }) => (
  <MemoryRouter initialEntries={[`/workspace/agent/${agentId}`]}>
    <Routes>
      <Route path="/workspace/agent/:agentId" element={children} />
    </Routes>
  </MemoryRouter>
)

describe('AgentView Header Consolidation', () => {
  const mockAssignment = {
    id: 'assign-1',
    agentId: 'test-agent',
    branch: 'feature/test-project/add-feature',
    feature: 'Test Feature Implementation',
    status: 'working',
    specFile: '/path/to/spec.md',
    tool: 'claude',
    model: 'opus',
    mode: 'dev',
    prUrl: undefined,
    prStatus: undefined,
    isBaseBranchAgent: false
  }

  const mockAgent = {
    id: 'test-agent',
    assignmentId: 'assign-1',
    worktreePath: '/path/to/worktree',
    terminalPid: null,
    hasUnread: false,
    lastActivity: new Date().toISOString()
  }

  beforeEach(() => {
    // Setup electronAPI mock using vi.mocked to update the already-defined mock
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue([mockAgent])
    vi.mocked(window.electronAPI.getAssignmentsForProject).mockResolvedValue({
      assignments: [mockAssignment]
    })
    vi.mocked(window.electronAPI.getTestEnvConfig).mockResolvedValue({ defaultCommands: [] })
    vi.mocked(window.electronAPI.getTestEnvStatus).mockResolvedValue([])
    vi.mocked(window.electronAPI.detectPullRequest).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders consolidated header with shortened branch name and bot icon', async () => {
    const { container } = render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('add-feature')).toBeInTheDocument()
      expect(container.querySelector('[data-testid="bot-icon"]')).toBeInTheDocument()
    })
  })

  it('renders agent info when assignment exists', async () => {
    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      // Shortened branch name should be displayed
      expect(screen.getByText('add-feature')).toBeInTheDocument()
    })
  })

  it('does not render old tool dropdown', async () => {
    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.queryByLabelText('Tool:')).not.toBeInTheDocument()
    })
  })

  it('does not render old model dropdown', async () => {
    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.queryByLabelText('Model:')).not.toBeInTheDocument()
    })
  })

  it('does not render old mode dropdown', async () => {
    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.queryByLabelText('Mode:')).not.toBeInTheDocument()
    })
  })

  it('does not render old agent-info-bar section', async () => {
    const { container } = render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      const infoBar = container.querySelector('.agent-info-bar')
      expect(infoBar).not.toBeInTheDocument()
    })
  })

  it('does not render agent-controls section', async () => {
    const { container } = render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      const controls = container.querySelector('.agent-controls')
      expect(controls).not.toBeInTheDocument()
    })
  })

  it('renders action buttons in correct section', async () => {
    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      const openCursorBtn = screen.getByText('Cursor')
      expect(openCursorBtn).toBeInTheDocument()
    })
  })

  it('renders minion terminal tab name when tool is claude', async () => {
    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('Minion Terminal')).toBeInTheDocument()
    })
  })

  it('renders Cursor IDE tab name when tool is cursor and not running', async () => {
    const cursorAssignment = { ...mockAssignment, tool: 'cursor' }
    vi.mocked(window.electronAPI.getAssignmentsForProject).mockResolvedValue({
      assignments: [cursorAssignment]
    })

    render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('Cursor IDE')).toBeInTheDocument()
    })
  })

  it('does not render feature info when no assignment exists', async () => {
    vi.mocked(window.electronAPI.getAssignmentsForProject).mockResolvedValue({
      assignments: []
    })

    const { container } = render(
      <TestWrapper>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('test-agent')).toBeInTheDocument()
      expect(container.querySelector('[data-testid="bot-icon"]')).toBeInTheDocument()
      // Feature label should not be present when no assignment
      expect(screen.queryByText('Feature:')).not.toBeInTheDocument()
    })
  })
})
