import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProjectPicker from '../ProjectPicker'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => vi.fn()
}))

vi.mock('../../contexts/SnackbarContext', () => ({
  useSnackbar: () => ({ addSnackbar: vi.fn(), removeSnackbar: vi.fn() })
}))

vi.mock('../ConfirmModal', () => ({
  default: ({ isOpen, title, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <h3>{title}</h3>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null
}))

const mocks = {
  getRecentProjects: vi.fn(),
  checkWizard: vi.fn(),
  selectProject: vi.fn(),
  migrateProject: vi.fn(),
  startWizard: vi.fn(),
  quickSetup: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getRecentProjects.mockResolvedValue([])
  mocks.checkWizard.mockResolvedValue({ needsWizard: false, hasLegacy: false })
  mocks.selectProject.mockResolvedValue({ name: 'proj', path: '/path' })
  mocks.startWizard.mockResolvedValue({ agentId: 'wizard-1' })
  Object.assign(window.electronAPI, mocks)
})

const renderPicker = (onSelect = vi.fn()) =>
  render(<MemoryRouter><ProjectPicker onProjectSelect={onSelect} /></MemoryRouter>)

describe('ProjectPicker', () => {
  describe('recent projects', () => {
    it('shows recent projects when available', async () => {
      mocks.getRecentProjects.mockResolvedValue([
        { name: 'Project A', path: '/a' },
        { name: 'Project B', path: '/b' }
      ])

      renderPicker()

      await waitFor(() => {
        expect(screen.getByText('Project A')).toBeInTheDocument()
        expect(screen.getByText('Project B')).toBeInTheDocument()
      })
    })

    it('hides section when no recent projects', async () => {
      mocks.getRecentProjects.mockResolvedValue([])
      renderPicker()

      await waitFor(() => expect(mocks.getRecentProjects).toHaveBeenCalled())
      expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument()
    })
  })

  describe('configured project selection', () => {
    it('selects project directly when already configured', async () => {
      const onSelect = vi.fn()
      mocks.getRecentProjects.mockResolvedValue([{ name: 'Ready', path: '/ready' }])
      mocks.checkWizard.mockResolvedValue({ needsWizard: false, hasLegacy: false })

      renderPicker(onSelect)
      await waitFor(() => fireEvent.click(screen.getByText('Ready')))

      await waitFor(() => {
        expect(mocks.selectProject).toHaveBeenCalledWith('/ready')
        expect(onSelect).toHaveBeenCalled()
      })
    })

    it('shows error on selection failure', async () => {
      mocks.getRecentProjects.mockResolvedValue([{ name: 'Fail', path: '/fail' }])
      mocks.checkWizard.mockRejectedValue(new Error('Network error'))

      renderPicker()
      await waitFor(() => fireEvent.click(screen.getByText('Fail')))

      await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
    })
  })

  describe('legacy migration flow', () => {
    beforeEach(() => {
      mocks.getRecentProjects.mockResolvedValue([{ name: 'Old', path: '/old' }])
      mocks.checkWizard.mockResolvedValue({ needsWizard: false, hasLegacy: true })
    })

    it('prompts migration and migrates on confirm', async () => {
      const onSelect = vi.fn()
      renderPicker(onSelect)

      await waitFor(() => fireEvent.click(screen.getByText('Old')))
      await waitFor(() => expect(screen.getByText('Migrate Project?')).toBeInTheDocument())

      fireEvent.click(screen.getByText('Confirm'))

      await waitFor(() => {
        expect(mocks.migrateProject).toHaveBeenCalledWith('/old')
        expect(onSelect).toHaveBeenCalled()
      })
    })

    it('cancels migration without changes', async () => {
      renderPicker()

      await waitFor(() => fireEvent.click(screen.getByText('Old')))
      await waitFor(() => fireEvent.click(screen.getByText('Cancel')))

      await waitFor(() => expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument())
      expect(mocks.migrateProject).not.toHaveBeenCalled()
    })
  })

  describe('new project setup wizard', () => {
    beforeEach(() => {
      mocks.getRecentProjects.mockResolvedValue([{ name: 'New', path: '/new' }])
      mocks.checkWizard.mockResolvedValue({ needsWizard: true, hasLegacy: false })
    })

    it('starts wizard on auto-setup', async () => {
      renderPicker()

      await waitFor(() => fireEvent.click(screen.getByText('New')))
      await waitFor(() => fireEvent.click(screen.getByText('Start Auto-Setup')))

      await waitFor(() => expect(mocks.startWizard).toHaveBeenCalledWith('/new'))
    })

    it('performs quick setup when skipped', async () => {
      const onSelect = vi.fn()
      renderPicker(onSelect)

      await waitFor(() => fireEvent.click(screen.getByText('New')))
      await waitFor(() => fireEvent.click(screen.getByText('Skip & Import Project')))

      await waitFor(() => {
        expect(mocks.quickSetup).toHaveBeenCalledWith('/new')
        expect(onSelect).toHaveBeenCalled()
      })
    })

    it('shows error with recovery option when setup fails', async () => {
      mocks.startWizard.mockRejectedValue(new Error('not a git repository'))
      renderPicker()

      await waitFor(() => fireEvent.click(screen.getByText('New')))
      await waitFor(() => fireEvent.click(screen.getByText('Start Auto-Setup')))

      await waitFor(() => {
        expect(screen.getByText('Setup Failed')).toBeInTheDocument()
        expect(screen.getByText(/not a git repository/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Go Back'))
      await waitFor(() => expect(screen.queryByText('Setup Failed')).not.toBeInTheDocument())
    })

    it('disables UI during setup', async () => {
      mocks.startWizard.mockReturnValue(new Promise(() => {})) // Never resolves
      renderPicker()

      await waitFor(() => fireEvent.click(screen.getByText('New')))
      await waitFor(() => fireEvent.click(screen.getByText('Start Auto-Setup')))

      await waitFor(() => expect(screen.getByText('Select Project Folder')).toBeDisabled())
    })
  })
})
