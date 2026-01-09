import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SnackbarContainer from '../SnackbarContainer'
import { SnackbarProvider, useSnackbar } from '../../contexts/SnackbarContext'

// Helper component to add snackbars for testing
const SnackbarAdder = ({
  snackbars
}: {
  snackbars: Array<{ title: string; messages: string[] }>
}) => {
  const { addSnackbar } = useSnackbar()
  return (
    <button
      data-testid="add-all"
      onClick={() => snackbars.forEach((s) => addSnackbar(s))}
    >
      Add All
    </button>
  )
}

describe('SnackbarContainer', () => {
  it('renders nothing when no snackbars', () => {
    const { container } = render(
      <SnackbarProvider>
        <SnackbarContainer />
      </SnackbarProvider>
    )

    expect(container.querySelector('.snackbar-container')).not.toBeInTheDocument()
  })

  it('renders single snackbar', () => {
    render(
      <SnackbarProvider>
        <SnackbarAdder snackbars={[{ title: 'Test Snackbar', messages: ['Message'] }]} />
        <SnackbarContainer />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-all'))

    expect(screen.getByText('Test Snackbar')).toBeInTheDocument()
    expect(screen.getByText('Message')).toBeInTheDocument()
  })

  it('renders multiple stacked snackbars', () => {
    render(
      <SnackbarProvider>
        <SnackbarAdder
          snackbars={[
            { title: 'First', messages: ['Msg 1'] },
            { title: 'Second', messages: ['Msg 2'] },
            { title: 'Third', messages: ['Msg 3'] }
          ]}
        />
        <SnackbarContainer />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-all'))

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
  })

  it('has correct container class for positioning', () => {
    const { container } = render(
      <SnackbarProvider>
        <SnackbarAdder snackbars={[{ title: 'Test', messages: ['Msg'] }]} />
        <SnackbarContainer />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-all'))

    expect(container.querySelector('.snackbar-container')).toBeInTheDocument()
  })

  it('renders snackbars in correct order (stacked)', () => {
    const { container } = render(
      <SnackbarProvider>
        <SnackbarAdder
          snackbars={[
            { title: 'First', messages: ['Msg 1'] },
            { title: 'Second', messages: ['Msg 2'] }
          ]}
        />
        <SnackbarContainer />
      </SnackbarProvider>
    )

    fireEvent.click(screen.getByTestId('add-all'))

    const snackbars = container.querySelectorAll('.loading-snackbar')
    expect(snackbars.length).toBe(2)
  })

  it('updates when snackbars are removed', () => {
    const RemovableSnackbar = () => {
      const { snackbars, addSnackbar, removeSnackbar } = useSnackbar()
      return (
        <div>
          <button onClick={() => addSnackbar({ title: 'Removable', messages: ['Msg'] })}>
            Add
          </button>
          <button onClick={() => snackbars[0] && removeSnackbar(snackbars[0].id)}>
            Remove
          </button>
        </div>
      )
    }

    const { container } = render(
      <SnackbarProvider>
        <RemovableSnackbar />
        <SnackbarContainer />
      </SnackbarProvider>
    )

    // Add a snackbar
    fireEvent.click(screen.getByText('Add'))
    expect(screen.getByText('Removable')).toBeInTheDocument()

    // Remove it
    fireEvent.click(screen.getByText('Remove'))
    expect(screen.queryByText('Removable')).not.toBeInTheDocument()
    expect(container.querySelector('.snackbar-container')).not.toBeInTheDocument()
  })
})
