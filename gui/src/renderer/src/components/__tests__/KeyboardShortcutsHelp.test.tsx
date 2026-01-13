import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import KeyboardShortcutsHelp from '../KeyboardShortcutsHelp'

describe('KeyboardShortcutsHelp', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render when isOpen is true', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('should not render when isOpen is false', () => {
    render(<KeyboardShortcutsHelp isOpen={false} onClose={mockOnClose} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('should display all shortcuts', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    // Check for all shortcut descriptions
    expect(screen.getByText('New Minion')).toBeInTheDocument()
    expect(screen.getByText('New Super Minion')).toBeInTheDocument()
    expect(screen.getByText('Open Project')).toBeInTheDocument()
    expect(screen.getByText('Teleport from Cloud')).toBeInTheDocument()
    expect(screen.getByText('Previous Minion')).toBeInTheDocument()
    expect(screen.getByText('Next Minion')).toBeInTheDocument()
    expect(screen.getByText('Close Dialog')).toBeInTheDocument()
    expect(screen.getByText('Show Shortcuts')).toBeInTheDocument()
  })

  it('should call onClose when overlay is clicked', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    // Click on the overlay (the backdrop)
    const overlay = screen.getByRole('dialog').parentElement
    expect(overlay).toHaveClass('shortcuts-help-overlay')
    fireEvent.click(overlay!)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('should not close when content is clicked', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    // Click on the modal content (the dialog itself)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)

    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('should have proper accessibility attributes', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('should render key caps for each shortcut', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    // Check for some key cap elements
    const keyCaps = document.querySelectorAll('.key-cap')
    expect(keyCaps.length).toBeGreaterThan(0)
  })

  it('should display platform-appropriate modifier key', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={mockOnClose} />)

    // On most test environments, navigator.platform will indicate Mac or not
    // The component should display either ⌘ or Ctrl based on platform
    const modifierKeys = screen.getAllByText(/⌘|Ctrl/)
    expect(modifierKeys.length).toBeGreaterThan(0)
  })
})
