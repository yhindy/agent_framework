import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ArchivePage } from '../ArchivePage'
import { SnackbarProvider } from '../../../contexts/SnackbarContext'
import type { ArchivedAgent } from '../../../../../main/services/types/ProjectConfig'

// Mock window.electronAPI
const mockListArchivedAgents = vi.fn()
const mockRestoreArchivedAgent = vi.fn()
const mockGetCurrentProject = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  global.window.electronAPI = {
    listArchivedAgents: mockListArchivedAgents,
    restoreArchivedAgent: mockRestoreArchivedAgent,
    getCurrentProject: mockGetCurrentProject
  } as any
})

const mockArchives: ArchivedAgent[] = [
  {
    archiveId: 'test-agent-1',
    archivedAt: '2024-01-12T10:00:00Z',
    archiveVersion: 1,
    agentId: 'test-agent',
    assignmentId: 'test-agent-123',
    branch: 'feature/user-auth',
    feature: 'user-auth',
    prompt: 'Add user authentication',
    tool: 'claude',
    model: 'opus',
    mode: 'auto',
    createdAt: '2024-01-10T09:00:00Z',
    completedAt: '2024-01-11T14:30:00Z',
    finalStatus: 'completed',
    prUrl: 'https://github.com/test/repo/pull/123',
    prStatus: 'merged',
    totalCostUsd: 0.42
  },
  {
    archiveId: 'test-agent-2',
    archivedAt: '2024-01-11T15:00:00Z',
    archiveVersion: 1,
    agentId: 'test-agent-2',
    assignmentId: 'test-agent-456',
    branch: 'feature/api-refactor',
    feature: 'api-refactor',
    tool: 'cursor-cli',
    mode: 'auto',
    createdAt: '2024-01-09T10:00:00Z',
    completedAt: '2024-01-11T12:00:00Z',
    finalStatus: 'failed'
  }
]

function renderArchivePage() {
  return render(
    <MemoryRouter initialEntries={['/workspace/archive']}>
      <SnackbarProvider>
        <Routes>
          <Route path="/workspace/archive" element={<ArchivePage />} />
          <Route path="/workspace/agent/:agentId" element={<div>Agent View</div>} />
        </Routes>
      </SnackbarProvider>
    </MemoryRouter>
  )
}

describe('ArchivePage', () => {
  beforeEach(() => {
    mockGetCurrentProject.mockResolvedValue({ path: '/test/project' })
  })

  it('should render loading state initially', () => {
    mockListArchivedAgents.mockImplementation(() => new Promise(() => {})) // Never resolves

    renderArchivePage()

    expect(screen.getByText('Loading archives...')).toBeInTheDocument()
  })

  it('should render empty state when no archives exist', async () => {
    mockListArchivedAgents.mockResolvedValue([])

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('No archived agents yet')).toBeInTheDocument()
    })

    expect(screen.getByText(/When you clean up completed agents/)).toBeInTheDocument()
  })

  it('should render list of archived agents', async () => {
    mockListArchivedAgents.mockResolvedValue(mockArchives)

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('feature/user-auth')).toBeInTheDocument()
    })

    expect(screen.getByText('feature/api-refactor')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('should display cost when available', async () => {
    mockListArchivedAgents.mockResolvedValue(mockArchives)

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('$0.42')).toBeInTheDocument()
    })
  })

  it('should call restore API when Restore button is clicked', async () => {
    mockListArchivedAgents.mockResolvedValue([mockArchives[0]])
    mockRestoreArchivedAgent.mockResolvedValue({
      id: 'new-agent-123',
      agentId: 'restored-agent'
    })

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('feature/user-auth')).toBeInTheDocument()
    })

    const restoreButton = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(restoreButton)

    await waitFor(() => {
      expect(mockRestoreArchivedAgent).toHaveBeenCalledWith(
        '/test/project',
        'test-agent-1'
      )
    })
  })

  it('should show "Restoring..." text while restoring', async () => {
    mockListArchivedAgents.mockResolvedValue([mockArchives[0]])
    mockRestoreArchivedAgent.mockImplementation(() => new Promise(() => {})) // Never resolves

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('feature/user-auth')).toBeInTheDocument()
    })

    const restoreButton = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(restoreButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restoring...' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Restoring...' })).toBeDisabled()
  })

  it('should navigate to agent view after successful restore', async () => {
    mockListArchivedAgents.mockResolvedValue([mockArchives[0]])
    mockRestoreArchivedAgent.mockResolvedValue({
      id: 'new-agent-123',
      agentId: 'restored-agent'
    })

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('feature/user-auth')).toBeInTheDocument()
    })

    const restoreButton = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(restoreButton)

    await waitFor(() => {
      expect(screen.getByText('Agent View')).toBeInTheDocument()
    })
  })

  it('should show correct status badge colors', async () => {
    mockListArchivedAgents.mockResolvedValue(mockArchives)

    renderArchivePage()

    await waitFor(() => {
      const completedBadge = screen.getByText('completed')
      expect(completedBadge).toHaveStyle({ color: 'var(--color-success)' })
    })

    const failedBadge = screen.getByText('failed')
    expect(failedBadge).toHaveStyle({ color: 'var(--color-error)' })
  })

  it('should handle restore errors gracefully', async () => {
    mockListArchivedAgents.mockResolvedValue([mockArchives[0]])
    mockRestoreArchivedAgent.mockRejectedValue(new Error('Restore failed'))

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('feature/user-auth')).toBeInTheDocument()
    })

    const restoreButton = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(restoreButton)

    await waitFor(() => {
      expect(mockRestoreArchivedAgent).toHaveBeenCalled()
    })

    // Button should be enabled again after error
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore' })).not.toBeDisabled()
    })
  })

  it('should show tool and model information', async () => {
    mockListArchivedAgents.mockResolvedValue(mockArchives)

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText(/claude.*opus/)).toBeInTheDocument()
    })

    expect(screen.getByText('cursor-cli')).toBeInTheDocument()
  })

  it('should refresh archives when refresh button is clicked', async () => {
    mockListArchivedAgents.mockResolvedValue(mockArchives)

    renderArchivePage()

    await waitFor(() => {
      expect(screen.getByText('feature/user-auth')).toBeInTheDocument()
    })

    // Click refresh button
    const refreshButton = screen.getByTitle('Refresh')
    fireEvent.click(refreshButton)

    // Should call API again
    await waitFor(() => {
      expect(mockListArchivedAgents).toHaveBeenCalledTimes(2)
    })
  })
})
