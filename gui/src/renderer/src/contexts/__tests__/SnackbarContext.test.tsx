import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SnackbarProvider, useSnackbar } from '../SnackbarContext'

const TestComponent = () => {
  const { snackbars, addSnackbar, removeSnackbar } = useSnackbar()
  return (
    <div>
      <span data-testid="count">{snackbars.length}</span>
      <button
        data-testid="add-btn"
        onClick={() => addSnackbar({ title: 'Test', messages: ['Msg'] })}
      >
        Add
      </button>
      <button
        data-testid="remove-btn"
        onClick={() => snackbars[0] && removeSnackbar(snackbars[0].id)}
      >
        Remove
      </button>
      {snackbars.map((s) => (
        <span key={s.id} data-testid={`snackbar-${s.id}`}>
          {s.title}
        </span>
      ))}
    </div>
  )
}

describe('SnackbarContext', () => {
  it('provides initial empty snackbars array', () => {
    render(
      <SnackbarProvider>
        <TestComponent />
      </SnackbarProvider>
    )

    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('adds snackbar to state', () => {
    render(
      <SnackbarProvider>
        <TestComponent />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-btn'))

    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('removes snackbar from state', () => {
    render(
      <SnackbarProvider>
        <TestComponent />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-btn'))
    expect(screen.getByTestId('count').textContent).toBe('1')

    fireEvent.click(screen.getByTestId('remove-btn'))
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('supports multiple concurrent snackbars', () => {
    render(
      <SnackbarProvider>
        <TestComponent />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-btn'))
    fireEvent.click(screen.getByTestId('add-btn'))
    fireEvent.click(screen.getByTestId('add-btn'))

    expect(screen.getByTestId('count').textContent).toBe('3')
  })

  it('generates unique IDs for each snackbar', () => {
    const IdCapture = () => {
      const { snackbars, addSnackbar } = useSnackbar()
      return (
        <div>
          <button onClick={() => addSnackbar({ title: 'Test', messages: ['Msg'] })}>
            Add
          </button>
          {snackbars.map((s) => (
            <span key={s.id} data-testid="snackbar-id">
              {s.id}
            </span>
          ))}
        </div>
      )
    }

    render(
      <SnackbarProvider>
        <IdCapture />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByText('Add'))
    fireEvent.click(screen.getByText('Add'))

    const ids = screen.getAllByTestId('snackbar-id').map((el) => el.textContent)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('does nothing when removing non-existent ID', () => {
    const RemoveNonExistent = () => {
      const { snackbars, addSnackbar, removeSnackbar } = useSnackbar()
      return (
        <div>
          <span data-testid="count">{snackbars.length}</span>
          <button onClick={() => addSnackbar({ title: 'Test', messages: ['Msg'] })}>
            Add
          </button>
          <button onClick={() => removeSnackbar('non-existent-id')}>Remove Fake</button>
        </div>
      )
    }

    render(
      <SnackbarProvider>
        <RemoveNonExistent />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByText('Add'))
    expect(screen.getByTestId('count').textContent).toBe('1')

    fireEvent.click(screen.getByText('Remove Fake'))
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('throws error when useSnackbar is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<TestComponent />)
    }).toThrow('useSnackbar must be used within a SnackbarProvider')

    consoleSpy.mockRestore()
  })
})
