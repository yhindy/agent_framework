import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SettingsPage from '../SettingsPage'
import { DEFAULT_SETTINGS } from '../../../../shared/types/settings'

vi.mock('../WorkflowSettings', () => ({ default: () => null }))
vi.mock('../ImportedAgentsSettings', () => ({ default: () => null }))

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockCheckTmuxAvailable = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSettings.mockResolvedValue({ ...DEFAULT_SETTINGS })
  mockCheckTmuxAvailable.mockResolvedValue(true)
  ;(window.electronAPI as any).getSettings = mockGetSettings
  ;(window.electronAPI as any).updateSettings = mockUpdateSettings
  ;(window.electronAPI as any).checkTmuxAvailable = mockCheckTmuxAvailable
  ;(window.electronAPI as any).openFeedback = vi.fn()
})

afterEach(() => vi.clearAllMocks())

describe('SettingsPage', () => {
  it('shows loading state until settings load', () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}))
    render(<SettingsPage />)
    expect(screen.getByText('Loading settings...')).toBeInTheDocument()
  })

  it('renders settings page after loading', async () => {
    render(<SettingsPage />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    })
  })

  it('falls back to defaults when settings load fails', async () => {
    mockGetSettings.mockRejectedValue(new Error('Failed'))
    render(<SettingsPage />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  describe('tool-specific model selection', () => {
    it('shows model selector for claude', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultTool: { tool: 'claude', model: 'opus' }
      })
      render(<SettingsPage />)
      await waitFor(() => expect(screen.getByTestId('model-select')).toBeInTheDocument())
    })

    it('shows hardcoded model for codex (no selector)', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultTool: { tool: 'codex', model: '' }
      })
      render(<SettingsPage />)
      await waitFor(() => expect(screen.getByText('gpt-5.2-codex')).toBeInTheDocument())
      expect(screen.queryByTestId('model-select')).not.toBeInTheDocument()
    })
  })

  describe('tmux availability warning', () => {
    it('shows warning when tmux mode selected but not installed', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        terminal: { terminalMode: 'tmux' }
      })
      mockCheckTmuxAvailable.mockResolvedValue(false)
      render(<SettingsPage />)
      await waitFor(() => expect(screen.getByText(/tmux is not installed/)).toBeInTheDocument())
    })

    it('hides warning when tmux is available', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        terminal: { terminalMode: 'tmux' }
      })
      mockCheckTmuxAvailable.mockResolvedValue(true)
      render(<SettingsPage />)
      await waitFor(() => expect(screen.getByText('Terminal')).toBeInTheDocument())
      expect(screen.queryByText(/tmux is not installed/)).not.toBeInTheDocument()
    })
  })
})
