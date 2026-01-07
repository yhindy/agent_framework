import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
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

vi.mock('../hooks/usePRCreation', () => ({
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

vi.mock('../hooks/useLoadingSnackbar', () => ({
  useLoadingSnackbar: () => ({
    showLoading: vi.fn(),
    hideLoading: vi.fn()
  })
}))

vi.mock('../utils/debounce', () => ({
  debounce: (fn: any) => fn
}))

// Mock useParams
const mockUseParams = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useParams: mockUseParams
  }
})

describe('AgentView Header Consolidation', () => {
  const mockAssignment = {
    id: 'assign-1',
    agentId: 'test-agent',
    branch: 'feature/test-branch',
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
    mockUseParams.mockReturnValue({ agentId: 'test-agent' })

    // Setup electronAPI mock
    global.window.electronAPI = {
      listAgentsForProject: vi.fn().mockResolvedValue([mockAgent]),
      getAssignmentsForProject: vi.fn().mockResolvedValue({
        assignments: [mockAssignment]
      }),
      getTestEnvConfig: vi.fn().mockResolvedValue({ defaultCommands: [] }),
      getTestEnvStatus: vi.fn().mockResolvedValue([]),
      openInCursor: vi.fn().mockResolvedValue(undefined),
      stopAgent: vi.fn().mockResolvedValue(undefined),
      saveUIState: vi.fn().mockResolvedValue(undefined)
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders consolidated header with agent ID and banana emoji', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/🍌 test-agent/)).toBeInTheDocument()
    })
  })

  it('renders feature, branch, and status badges when assignment exists', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Feature:')).toBeInTheDocument()
      expect(screen.getByText('Test Feature Implementation')).toBeInTheDocument()
      expect(screen.getByText('feature/test-branch')).toBeInTheDocument()
      expect(screen.getByText('working')).toBeInTheDocument()
    })
  })

  it('does not render old tool dropdown', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.queryByLabelText('Tool:')).not.toBeInTheDocument()
    })
  })

  it('does not render old model dropdown', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.queryByLabelText('Model:')).not.toBeInTheDocument()
    })
  })

  it('does not render old mode dropdown', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.queryByLabelText('Mode:')).not.toBeInTheDocument()
    })
  })

  it('does not render old agent-info-bar section', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const infoBar = container.querySelector('.agent-info-bar')
      expect(infoBar).not.toBeInTheDocument()
    })
  })

  it('does not render agent-controls section', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const controls = container.querySelector('.agent-controls')
      expect(controls).not.toBeInTheDocument()
    })
  })

  it('renders status dot with correct color class for working status', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const statusDot = container.querySelector('.status-dot.working')
      expect(statusDot).toBeInTheDocument()
    })
  })

  it('renders status dot with correct color class for idle status', async () => {
    const idleAssignment = { ...mockAssignment, status: 'idle' }
    global.window.electronAPI.getAssignmentsForProject = vi.fn().mockResolvedValue({
      assignments: [idleAssignment]
    })

    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const statusDot = container.querySelector('.status-dot.idle')
      expect(statusDot).toBeInTheDocument()
    })
  })

  it('renders status dot with correct color class for pr_open status', async () => {
    const prOpenAssignment = { ...mockAssignment, status: 'pr_open', prUrl: 'https://github.com/test/pr' }
    global.window.electronAPI.getAssignmentsForProject = vi.fn().mockResolvedValue({
      assignments: [prOpenAssignment]
    })

    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const statusDot = container.querySelector('.status-dot.pr_open')
      expect(statusDot).toBeInTheDocument()
    })
  })

  it('renders status dot with correct color class for merged status', async () => {
    const mergedAssignment = { ...mockAssignment, status: 'merged', prUrl: 'https://github.com/test/pr' }
    global.window.electronAPI.getAssignmentsForProject = vi.fn().mockResolvedValue({
      assignments: [mergedAssignment]
    })

    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const statusDot = container.querySelector('.status-dot.merged')
      expect(statusDot).toBeInTheDocument()
    })
  })

  it('renders badges in agent-header-left container', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const headerLeft = container.querySelector('.agent-header-left')
      expect(headerLeft).toBeInTheDocument()

      const featureBadge = headerLeft?.querySelector('.feature-badge')
      expect(featureBadge).toBeInTheDocument()

      const branchBadge = headerLeft?.querySelector('.branch-badge')
      expect(branchBadge).toBeInTheDocument()

      const statusBadge = headerLeft?.querySelector('.status-badge')
      expect(statusBadge).toBeInTheDocument()
    })
  })

  it('displays feature badge with label and value', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const featureBadge = screen.getByText('Feature:').closest('.feature-badge')
      expect(featureBadge).toBeInTheDocument()
      expect(featureBadge?.textContent).toContain('Feature:')
      expect(featureBadge?.textContent).toContain('Test Feature Implementation')
    })
  })

  it('displays branch badge with monospace font styling', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const branchBadge = container.querySelector('.branch-badge')
      expect(branchBadge).toBeInTheDocument()

      const badgeValue = branchBadge?.querySelector('.info-badge-value')
      expect(badgeValue?.textContent).toBe('feature/test-branch')
    })
  })

  it('renders action buttons in correct section', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const openCursorBtn = screen.getByText('Open in Cursor')
      expect(openCursorBtn).toBeInTheDocument()
      expect(openCursorBtn.closest('.agent-actions')).toBeInTheDocument()
    })
  })

  it('renders minion terminal tab name when tool is claude', async () => {
    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Minion Terminal')).toBeInTheDocument()
    })
  })

  it('renders Cursor IDE tab name when tool is cursor and not running', async () => {
    const cursorAssignment = { ...mockAssignment, tool: 'cursor' }
    global.window.electronAPI.getAssignmentsForProject = vi.fn().mockResolvedValue({
      assignments: [cursorAssignment]
    })

    render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Cursor IDE')).toBeInTheDocument()
    })
  })

  it('renders feature badge with title attribute for truncation', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const badgeValue = container.querySelector('.feature-badge .info-badge-value')
      expect(badgeValue).toHaveAttribute('title', 'Test Feature Implementation')
    })
  })

  it('renders branch badge with title attribute for truncation', async () => {
    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      const badgeValue = container.querySelector('.branch-badge .info-badge-value')
      expect(badgeValue).toHaveAttribute('title', 'feature/test-branch')
    })
  })

  it('does not render badges when no assignment exists', async () => {
    global.window.electronAPI.getAssignmentsForProject = vi.fn().mockResolvedValue({
      assignments: []
    })

    const { container } = render(
      <BrowserRouter>
        <AgentView activeProjects={[{ path: '/test/project' }]} />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/🍌 test-agent/)).toBeInTheDocument()
      expect(container.querySelector('.feature-badge')).not.toBeInTheDocument()
      expect(container.querySelector('.branch-badge')).not.toBeInTheDocument()
      expect(container.querySelector('.status-badge')).not.toBeInTheDocument()
    })
  })
})
