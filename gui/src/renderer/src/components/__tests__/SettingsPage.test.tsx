import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SettingsPage from '../SettingsPage'
import { DEFAULT_SETTINGS } from '../../../../shared/types/settings'

// Mock child components that have their own tests
vi.mock('../WorkflowSettings', () => ({
  default: () => <div data-testid="workflow-settings">WorkflowSettings</div>
}))

vi.mock('../ImportedAgentsSettings', () => ({
  default: () => <div data-testid="imported-agents-settings">ImportedAgentsSettings</div>
}))

// Mock functions
const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockCheckTmuxAvailable = vi.fn()
const mockOpenFeedback = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  mockGetSettings.mockResolvedValue({ ...DEFAULT_SETTINGS })
  mockUpdateSettings.mockResolvedValue(undefined)
  mockCheckTmuxAvailable.mockResolvedValue(true)
  mockOpenFeedback.mockResolvedValue(undefined)

  // Mock the existing electronAPI methods (set up in test/setup.ts)
  ;(window.electronAPI as any).getSettings = mockGetSettings
  ;(window.electronAPI as any).updateSettings = mockUpdateSettings
  ;(window.electronAPI as any).checkTmuxAvailable = mockCheckTmuxAvailable
  ;(window.electronAPI as any).openFeedback = mockOpenFeedback
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SettingsPage', () => {
  describe('loading state', () => {
    it('shows loading state initially', () => {
      // Don't resolve getSettings yet
      mockGetSettings.mockReturnValue(new Promise(() => {}))

      render(<SettingsPage />)

      expect(screen.getByText('Loading settings...')).toBeInTheDocument()
    })

    it('shows settings after loading', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })

      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
  })

  describe('notifications section', () => {
    it('renders notifications section', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeInTheDocument()
      })

      expect(screen.getByText('Enable OS notifications')).toBeInTheDocument()
      expect(screen.getByText('Notification cooldown')).toBeInTheDocument()
    })

    it('renders notification toggle checkbox', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Enable OS notifications')).toBeInTheDocument()
      })

      const checkbox = screen.getByRole('checkbox', { name: /enable os notifications/i })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked() // Default is enabled
    })

    it('renders cooldown input with default value', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Notification cooldown')).toBeInTheDocument()
      })

      const input = screen.getByRole('spinbutton')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue(DEFAULT_SETTINGS.notifications.cooldownSeconds)
    })
  })

  describe('default tool section', () => {
    it('renders tool selection', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Default Tool & Model')).toBeInTheDocument()
      })

      expect(screen.getByTestId('tool-select')).toBeInTheDocument()
    })

    it('shows model select for claude', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultTool: { ...DEFAULT_SETTINGS.defaultTool, tool: 'claude' }
      })

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByTestId('model-select')).toBeInTheDocument()
      })
    })

    it('shows model select for cursor-cli', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultTool: { ...DEFAULT_SETTINGS.defaultTool, tool: 'cursor-cli' }
      })

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByTestId('model-select')).toBeInTheDocument()
      })
    })

    it('shows hardcoded model info for codex', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultTool: { ...DEFAULT_SETTINGS.defaultTool, tool: 'codex' }
      })

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Codex model')).toBeInTheDocument()
      })

      expect(screen.getByText('gpt-5.2-codex')).toBeInTheDocument()
      expect(screen.queryByTestId('model-select')).not.toBeInTheDocument()
    })
  })

  describe('default agent settings section', () => {
    it('renders workflow options', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Default Agent Settings')).toBeInTheDocument()
      })

      expect(screen.getByText('Plan First')).toBeInTheDocument()
      expect(screen.getByText('Start Immediately')).toBeInTheDocument()
    })

    it('renders YOLO mode toggle', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('YOLO mode')).toBeInTheDocument()
      })

      expect(screen.getByText('Auto-approve edits and commands without confirmation')).toBeInTheDocument()
    })

    it('renders Chrome integration toggle', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Chrome integration')).toBeInTheDocument()
      })

      expect(screen.getByText('Enable browser automation capabilities')).toBeInTheDocument()
    })

    it('shows planning workflow selected by default', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Default Agent Settings')).toBeInTheDocument()
      })

      const planningRadio = screen.getByDisplayValue('planning') as HTMLInputElement
      expect(planningRadio.checked).toBe(true)
    })
  })

  describe('terminal section', () => {
    it('renders terminal mode selector', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Terminal')).toBeInTheDocument()
      })

      expect(screen.getByText('Terminal mode')).toBeInTheDocument()
    })

    it('shows tmux description when tmux mode selected', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        terminal: { terminalMode: 'tmux' }
      })

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText(/Agent terminals run inside tmux sessions/)).toBeInTheDocument()
      })
    })

    it('shows tabs description when tabs mode selected', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        terminal: { terminalMode: 'tabs' }
      })

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText(/Agent terminals use traditional GUI tabs/)).toBeInTheDocument()
      })
    })

    it('shows warning when tmux not available', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        terminal: { terminalMode: 'tmux' }
      })
      mockCheckTmuxAvailable.mockResolvedValue(false)

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText(/tmux is not installed/)).toBeInTheDocument()
      })
    })

    it('does not show warning when tmux is available', async () => {
      mockGetSettings.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        terminal: { terminalMode: 'tmux' }
      })
      mockCheckTmuxAvailable.mockResolvedValue(true)

      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Terminal')).toBeInTheDocument()
      })

      expect(screen.queryByText(/tmux is not installed/)).not.toBeInTheDocument()
    })
  })

  describe('child component sections', () => {
    it('renders WorkflowSettings component', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByTestId('workflow-settings')).toBeInTheDocument()
      })
    })

    it('renders ImportedAgentsSettings component', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByTestId('imported-agents-settings')).toBeInTheDocument()
      })
    })
  })

  describe('feedback section', () => {
    it('renders feedback section', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Feedback')).toBeInTheDocument()
      })

      expect(screen.getByText('Leave Feedback')).toBeInTheDocument()
      expect(screen.getByText(/Help us improve/)).toBeInTheDocument()
    })

    it('has feedback button', async () => {
      render(<SettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Leave Feedback')).toBeInTheDocument()
      })

      const button = screen.getByRole('button', { name: 'Leave Feedback' })
      expect(button).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('handles settings load error gracefully', async () => {
      mockGetSettings.mockRejectedValue(new Error('Failed to load'))

      render(<SettingsPage />)

      // Should eventually render with default settings (component catches error)
      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })
})
