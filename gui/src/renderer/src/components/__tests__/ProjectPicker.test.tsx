import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProjectPicker from '../ProjectPicker'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

// Mock SnackbarContext
vi.mock('../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({
    addSnackbar: vi.fn().mockReturnValue('snackbar-1'),
    removeSnackbar: vi.fn()
  })
}))

// Mock ConfirmModal
vi.mock('../ConfirmModal', () => ({
  default: ({ isOpen, title, onConfirm, onCancel, isLoading }: any) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <h3>{title}</h3>
        <button onClick={onConfirm} disabled={isLoading}>Confirm</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null
}))

// Mock functions
const mockGetRecentProjects = vi.fn()
const mockCheckWizard = vi.fn()
const mockSelectProject = vi.fn()
const mockMigrateProject = vi.fn()
const mockStartWizard = vi.fn()
const mockQuickSetup = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  mockGetRecentProjects.mockResolvedValue([])
  mockCheckWizard.mockResolvedValue({ needsWizard: false, hasLegacy: false })
  mockSelectProject.mockResolvedValue({ name: 'test-project', path: '/test/path' })
  mockMigrateProject.mockResolvedValue(undefined)
  mockStartWizard.mockResolvedValue({ agentId: 'wizard-agent-1' })
  mockQuickSetup.mockResolvedValue(undefined)

  // Mock the existing electronAPI methods (set up in test/setup.ts)
  ;(window.electronAPI as any).getRecentProjects = mockGetRecentProjects
  ;(window.electronAPI as any).checkWizard = mockCheckWizard
  ;(window.electronAPI as any).selectProject = mockSelectProject
  ;(window.electronAPI as any).migrateProject = mockMigrateProject
  ;(window.electronAPI as any).startWizard = mockStartWizard
  ;(window.electronAPI as any).quickSetup = mockQuickSetup
})

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ProjectPicker', () => {
  const mockOnProjectSelect = vi.fn()

  describe('initial rendering', () => {
    it('renders title and subtitle', () => {
      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      expect(screen.getByText('Minion Laboratory')).toBeInTheDocument()
      expect(screen.getByText('Select a project to manage AI agents')).toBeInTheDocument()
    })

    it('renders select folder button', () => {
      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      expect(screen.getByText('Select Project Folder')).toBeInTheDocument()
    })

    it('loads recent projects on mount', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'Project 1', path: '/path/to/project1' },
        { name: 'Project 2', path: '/path/to/project2' }
      ])

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(mockGetRecentProjects).toHaveBeenCalled()
      })

      expect(screen.getByText('Recent Projects')).toBeInTheDocument()
      expect(screen.getByText('Project 1')).toBeInTheDocument()
      expect(screen.getByText('Project 2')).toBeInTheDocument()
    })

    it('does not show recent projects section when empty', async () => {
      mockGetRecentProjects.mockResolvedValue([])

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(mockGetRecentProjects).toHaveBeenCalled()
      })

      expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument()
    })
  })

  describe('project selection', () => {
    it('calls onProjectSelect for already configured project', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'Configured Project', path: '/configured/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: false, hasLegacy: false })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('Configured Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Configured Project'))

      await waitFor(() => {
        expect(mockSelectProject).toHaveBeenCalledWith('/configured/path')
        expect(mockOnProjectSelect).toHaveBeenCalled()
      })
    })

    it('shows error message on selection failure', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'Project', path: '/path' }
      ])
      mockCheckWizard.mockRejectedValue(new Error('Selection failed'))

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Project'))

      await waitFor(() => {
        expect(screen.getByText('Selection failed')).toBeInTheDocument()
      })
    })
  })

  describe('legacy migration', () => {
    it('shows migration modal for legacy projects', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'Legacy Project', path: '/legacy/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: false, hasLegacy: true })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('Legacy Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Legacy Project'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
        expect(screen.getByText('Migrate Project?')).toBeInTheDocument()
      })
    })

    it('migrates project when confirmed', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'Legacy Project', path: '/legacy/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: false, hasLegacy: true })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('Legacy Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Legacy Project'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Confirm'))

      await waitFor(() => {
        expect(mockMigrateProject).toHaveBeenCalledWith('/legacy/path')
        expect(mockSelectProject).toHaveBeenCalledWith('/legacy/path')
        expect(mockOnProjectSelect).toHaveBeenCalled()
      })
    })

    it('closes migration modal when cancelled', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'Legacy Project', path: '/legacy/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: false, hasLegacy: true })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('Legacy Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Legacy Project'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('setup wizard', () => {
    it('shows setup modal for new projects', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        expect(screen.getByText('New Project Detected')).toBeInTheDocument()
      })
    })

    it('shows setup options in confirm step', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        expect(screen.getByText('Start Auto-Setup')).toBeInTheDocument()
        expect(screen.getByText('Skip & Import Project')).toBeInTheDocument()
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })
    })

    it('starts wizard when auto-setup is clicked', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })
      mockStartWizard.mockResolvedValue({ agentId: 'wizard-123' })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        expect(screen.getByText('Start Auto-Setup')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Start Auto-Setup'))

      await waitFor(() => {
        expect(mockStartWizard).toHaveBeenCalledWith('/new/path')
      })
    })

    it('performs quick setup when skip is clicked', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        expect(screen.getByText('Skip & Import Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Skip & Import Project'))

      await waitFor(() => {
        expect(mockQuickSetup).toHaveBeenCalledWith('/new/path')
        expect(mockSelectProject).toHaveBeenCalledWith('/new/path')
        expect(mockOnProjectSelect).toHaveBeenCalled()
      })
    })

    it('closes setup modal when cancel is clicked', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        expect(screen.getByText('New Project Detected')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByText('New Project Detected')).not.toBeInTheDocument()
      })
    })

    it('shows error state when setup fails', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })
      mockStartWizard.mockRejectedValue(new Error('not a git repository'))

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        expect(screen.getByText('Start Auto-Setup')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Start Auto-Setup'))

      await waitFor(() => {
        expect(screen.getByText('Setup Failed')).toBeInTheDocument()
        expect(screen.getByText(/not a git repository/)).toBeInTheDocument()
      })
    })

    it('shows go back button in error state', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })
      mockStartWizard.mockRejectedValue(new Error('Setup failed'))

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        fireEvent.click(screen.getByText('Start Auto-Setup'))
      })

      await waitFor(() => {
        expect(screen.getByText('Setup Failed')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Go Back'))

      await waitFor(() => {
        expect(screen.queryByText('Setup Failed')).not.toBeInTheDocument()
      })
    })
  })

  describe('disabled state during setup', () => {
    it('disables select button during setup', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })
      // Make setup hang
      mockStartWizard.mockReturnValue(new Promise(() => {}))

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        fireEvent.click(screen.getByText('Start Auto-Setup'))
      })

      // Button should be disabled during setup
      await waitFor(() => {
        expect(screen.getByText('Select Project Folder')).toBeDisabled()
      })
    })

    it('disables project items during setup', async () => {
      mockGetRecentProjects.mockResolvedValue([
        { name: 'New Project', path: '/new/path' },
        { name: 'Other Project', path: '/other/path' }
      ])
      mockCheckWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })
      mockStartWizard.mockReturnValue(new Promise(() => {}))

      renderWithRouter(<ProjectPicker onProjectSelect={mockOnProjectSelect} />)

      await waitFor(() => {
        expect(screen.getByText('New Project')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Project'))

      await waitFor(() => {
        fireEvent.click(screen.getByText('Start Auto-Setup'))
      })

      await waitFor(() => {
        const otherProject = screen.getByText('Other Project').closest('.project-item')
        expect(otherProject).toHaveClass('disabled')
      })
    })
  })
})
