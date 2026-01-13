import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcutsContext
} from '../KeyboardShortcutsContext'

/**
 * Test component that exposes context functions for testing
 */
const TestComponent = () => {
  const {
    modalControls,
    navigationControls,
    showHelpOverlay,
    registerModalControls,
    unregisterModalControls,
    registerNavigationControls,
    unregisterNavigationControls,
    setShowHelpOverlay,
    toggleHelpOverlay
  } = useKeyboardShortcutsContext()

  return (
    <div>
      <span data-testid="modal-registered">{modalControls ? 'yes' : 'no'}</span>
      <span data-testid="nav-registered">{navigationControls ? 'yes' : 'no'}</span>
      <span data-testid="help-visible">{showHelpOverlay ? 'yes' : 'no'}</span>
      <span data-testid="is-modal-open">
        {modalControls?.isModalOpen ? 'yes' : 'no'}
      </span>
      <span data-testid="can-nav-prev">
        {navigationControls?.canNavigatePrevious ? 'yes' : 'no'}
      </span>
      <span data-testid="can-nav-next">
        {navigationControls?.canNavigateNext ? 'yes' : 'no'}
      </span>
      <button data-testid="toggle-help" onClick={toggleHelpOverlay}>
        Toggle Help
      </button>
      <button data-testid="show-help" onClick={() => setShowHelpOverlay(true)}>
        Show Help
      </button>
      <button data-testid="hide-help" onClick={() => setShowHelpOverlay(false)}>
        Hide Help
      </button>
      <button
        data-testid="register-modal"
        onClick={() =>
          registerModalControls({
            openNewMinionModal: vi.fn(),
            openSuperMinionModal: vi.fn(),
            openTeleportModal: vi.fn(),
            openProjectPicker: vi.fn(),
            closeCurrentModal: vi.fn(),
            isModalOpen: true
          })
        }
      >
        Register Modal
      </button>
      <button data-testid="unregister-modal" onClick={unregisterModalControls}>
        Unregister Modal
      </button>
      <button
        data-testid="register-nav"
        onClick={() =>
          registerNavigationControls({
            navigateToPreviousMinion: vi.fn(),
            navigateToNextMinion: vi.fn(),
            canNavigatePrevious: true,
            canNavigateNext: true
          })
        }
      >
        Register Nav
      </button>
      <button data-testid="unregister-nav" onClick={unregisterNavigationControls}>
        Unregister Nav
      </button>
    </div>
  )
}

describe('KeyboardShortcutsContext', () => {
  it('provides initial state with no controls registered', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    expect(screen.getByTestId('modal-registered').textContent).toBe('no')
    expect(screen.getByTestId('nav-registered').textContent).toBe('no')
    expect(screen.getByTestId('help-visible').textContent).toBe('no')
  })

  it('registers modal controls', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    expect(screen.getByTestId('modal-registered').textContent).toBe('no')

    fireEvent.click(screen.getByTestId('register-modal'))

    expect(screen.getByTestId('modal-registered').textContent).toBe('yes')
    expect(screen.getByTestId('is-modal-open').textContent).toBe('yes')
  })

  it('registers navigation controls', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    expect(screen.getByTestId('nav-registered').textContent).toBe('no')

    fireEvent.click(screen.getByTestId('register-nav'))

    expect(screen.getByTestId('nav-registered').textContent).toBe('yes')
    expect(screen.getByTestId('can-nav-prev').textContent).toBe('yes')
    expect(screen.getByTestId('can-nav-next').textContent).toBe('yes')
  })

  it('toggles help overlay', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    expect(screen.getByTestId('help-visible').textContent).toBe('no')

    fireEvent.click(screen.getByTestId('toggle-help'))
    expect(screen.getByTestId('help-visible').textContent).toBe('yes')

    fireEvent.click(screen.getByTestId('toggle-help'))
    expect(screen.getByTestId('help-visible').textContent).toBe('no')
  })

  it('sets help overlay visibility directly', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    expect(screen.getByTestId('help-visible').textContent).toBe('no')

    fireEvent.click(screen.getByTestId('show-help'))
    expect(screen.getByTestId('help-visible').textContent).toBe('yes')

    fireEvent.click(screen.getByTestId('hide-help'))
    expect(screen.getByTestId('help-visible').textContent).toBe('no')
  })

  it('throws error when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<TestComponent />)
    }).toThrow('useKeyboardShortcutsContext must be used within KeyboardShortcutsProvider')

    consoleSpy.mockRestore()
  })

  it('unregisters modal controls properly', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    // Register first
    fireEvent.click(screen.getByTestId('register-modal'))
    expect(screen.getByTestId('modal-registered').textContent).toBe('yes')

    // Then unregister
    fireEvent.click(screen.getByTestId('unregister-modal'))
    expect(screen.getByTestId('modal-registered').textContent).toBe('no')
  })

  it('unregisters navigation controls properly', () => {
    render(
      <KeyboardShortcutsProvider>
        <TestComponent />
      </KeyboardShortcutsProvider>
    )

    // Register first
    fireEvent.click(screen.getByTestId('register-nav'))
    expect(screen.getByTestId('nav-registered').textContent).toBe('yes')

    // Then unregister
    fireEvent.click(screen.getByTestId('unregister-nav'))
    expect(screen.getByTestId('nav-registered').textContent).toBe('no')
  })

  it('calls modal control functions when invoked', () => {
    const mockOpenNewMinion = vi.fn()
    const mockOpenSuperMinion = vi.fn()
    const mockOpenTeleport = vi.fn()
    const mockOpenProjectPicker = vi.fn()
    const mockCloseModal = vi.fn()

    const ModalControlsConsumer = () => {
      const { modalControls, registerModalControls } = useKeyboardShortcutsContext()

      return (
        <div>
          <button
            data-testid="register"
            onClick={() =>
              registerModalControls({
                openNewMinionModal: mockOpenNewMinion,
                openSuperMinionModal: mockOpenSuperMinion,
                openTeleportModal: mockOpenTeleport,
                openProjectPicker: mockOpenProjectPicker,
                closeCurrentModal: mockCloseModal,
                isModalOpen: false
              })
            }
          >
            Register
          </button>
          <button
            data-testid="call-new-minion"
            onClick={() => modalControls?.openNewMinionModal()}
          >
            Open New Minion
          </button>
          <button
            data-testid="call-super-minion"
            onClick={() => modalControls?.openSuperMinionModal()}
          >
            Open Super Minion
          </button>
          <button
            data-testid="call-teleport"
            onClick={() => modalControls?.openTeleportModal()}
          >
            Open Teleport
          </button>
          <button
            data-testid="call-project-picker"
            onClick={() => modalControls?.openProjectPicker()}
          >
            Open Project Picker
          </button>
          <button
            data-testid="call-close"
            onClick={() => modalControls?.closeCurrentModal()}
          >
            Close Modal
          </button>
        </div>
      )
    }

    render(
      <KeyboardShortcutsProvider>
        <ModalControlsConsumer />
      </KeyboardShortcutsProvider>
    )

    // Register first
    fireEvent.click(screen.getByTestId('register'))

    // Call each function
    fireEvent.click(screen.getByTestId('call-new-minion'))
    expect(mockOpenNewMinion).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('call-super-minion'))
    expect(mockOpenSuperMinion).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('call-teleport'))
    expect(mockOpenTeleport).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('call-project-picker'))
    expect(mockOpenProjectPicker).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('call-close'))
    expect(mockCloseModal).toHaveBeenCalledTimes(1)
  })

  it('calls navigation control functions when invoked', () => {
    const mockNavigatePrev = vi.fn()
    const mockNavigateNext = vi.fn()

    const NavControlsConsumer = () => {
      const { navigationControls, registerNavigationControls } =
        useKeyboardShortcutsContext()

      return (
        <div>
          <button
            data-testid="register"
            onClick={() =>
              registerNavigationControls({
                navigateToPreviousMinion: mockNavigatePrev,
                navigateToNextMinion: mockNavigateNext,
                canNavigatePrevious: true,
                canNavigateNext: true
              })
            }
          >
            Register
          </button>
          <button
            data-testid="nav-prev"
            onClick={() => navigationControls?.navigateToPreviousMinion()}
          >
            Previous
          </button>
          <button
            data-testid="nav-next"
            onClick={() => navigationControls?.navigateToNextMinion()}
          >
            Next
          </button>
        </div>
      )
    }

    render(
      <KeyboardShortcutsProvider>
        <NavControlsConsumer />
      </KeyboardShortcutsProvider>
    )

    // Register first
    fireEvent.click(screen.getByTestId('register'))

    // Call each function
    fireEvent.click(screen.getByTestId('nav-prev'))
    expect(mockNavigatePrev).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('nav-next'))
    expect(mockNavigateNext).toHaveBeenCalledTimes(1)
  })
})
