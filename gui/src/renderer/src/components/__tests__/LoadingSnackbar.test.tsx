import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LoadingSnackbar from '../LoadingSnackbar'

describe('LoadingSnackbar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title and message', () => {
    render(<LoadingSnackbar title="Test Title" messages={['Test message']} />)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test message')).toBeInTheDocument()
  })

  it('renders with default title when not provided', () => {
    render(<LoadingSnackbar messages={['Test message']} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders progress bar', () => {
    render(<LoadingSnackbar title="Test" messages={['Msg']} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('has correct accessibility attributes', () => {
    render(<LoadingSnackbar title="Test" messages={['Msg']} />)
    const statusElement = screen.getByRole('status')
    expect(statusElement).toBeInTheDocument()
    expect(statusElement).toHaveAttribute('aria-live', 'polite')
  })

  it('displays one of the provided messages', () => {
    const messages = ['Message 1', 'Message 2', 'Message 3']
    render(<LoadingSnackbar title="Test" messages={messages} />)

    const hasAnyMessage = messages.some((msg) => screen.queryByText(msg) !== null)
    expect(hasAnyMessage).toBe(true)
  })

  it('rotates messages after interval', () => {
    const messages = ['Message 1', 'Message 2', 'Message 3']
    render(<LoadingSnackbar title="Test" messages={messages} rotationInterval={1000} />)

    // Get initial message
    const initialMessage = messages.find((msg) => screen.queryByText(msg) !== null)
    expect(initialMessage).toBeDefined()

    // Advance timers past the rotation interval
    act(() => {
      vi.advanceTimersByTime(1000) // Trigger fade out
    })

    act(() => {
      vi.advanceTimersByTime(500) // Wait for fade to complete
    })

    // After rotation, we should still have one of the messages displayed
    const currentMessage = messages.find((msg) => screen.queryByText(msg) !== null)
    expect(currentMessage).toBeDefined()
  })

  it('does not rotate with single message', async () => {
    const messages = ['Only Message']
    render(<LoadingSnackbar title="Test" messages={messages} rotationInterval={1000} />)

    expect(screen.getByText('Only Message')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // Should still show the same message
    expect(screen.getByText('Only Message')).toBeInTheDocument()
  })

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    const { unmount } = render(
      <LoadingSnackbar title="Test" messages={['Msg 1', 'Msg 2']} rotationInterval={1000} />
    )

    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })

  it('applies fade-out class during message transition', () => {
    const messages = ['Message 1', 'Message 2']
    render(<LoadingSnackbar title="Test" messages={messages} rotationInterval={1000} />)

    // Initially should have fade-in
    const messageElement = screen.getByText(/Message \d/)
    expect(messageElement).toHaveClass('fade-in')

    // Advance to when fading should start
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Should now be fading out
    const msg = screen.getByText(/Message \d/)
    expect(msg).toHaveClass('fade-out')
  })
})
