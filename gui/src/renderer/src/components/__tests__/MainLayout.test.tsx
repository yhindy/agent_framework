import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MainLayout from '../MainLayout'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import { KeyboardShortcutsProvider } from '../../contexts/KeyboardShortcutsContext'
import { SnackbarProvider } from '../../contexts/SnackbarContext'

// Wrapper component with all required providers
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>
    <SnackbarProvider>
      <KeyboardShortcutsProvider>
        {children}
      </KeyboardShortcutsProvider>
    </SnackbarProvider>
  </MemoryRouter>
)

describe('MainLayout Left Sidebar Collapse', () => {
  const mockProps = {
    activeProjects: [],
    onProjectRemove: vi.fn(),
    onProjectAdd: vi.fn(),
    onRefresh: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(window.electronAPI.listAgentsForProject).mockResolvedValue([])
  })

  it('loads collapsed state from localStorage on mount', async () => {
    localStorage.setItem('leftSidebarCollapsed', 'true')

    const { container } = render(
      <TestWrapper>
        <MainLayout {...mockProps} />
      </TestWrapper>
    )

    await waitFor(() => {
      const sidebar = container.querySelector('.sidebar')
      expect(sidebar).toHaveClass('collapsed')
    })
  })

  it('does not collapse sidebar when localStorage is not set', async () => {
    const { container } = render(
      <TestWrapper>
        <MainLayout {...mockProps} />
      </TestWrapper>
    )

    await waitFor(() => {
      const sidebar = container.querySelector('.sidebar')
      expect(sidebar).not.toHaveClass('collapsed')
    })
  })

  it('saves collapsed state to localStorage when toggled', async () => {
    const { container } = render(
      <TestWrapper>
        <MainLayout {...mockProps} />
      </TestWrapper>
    )

    const collapseButton = screen.getByTitle('Collapse sidebar')
    fireEvent.click(collapseButton)

    await waitFor(() => {
      expect(localStorage.getItem('leftSidebarCollapsed')).toBe('true')
      const sidebar = container.querySelector('.sidebar')
      expect(sidebar).toHaveClass('collapsed')
    })
  })

  it('saves expanded state to localStorage when toggled back', async () => {
    localStorage.setItem('leftSidebarCollapsed', 'true')

    const { container } = render(
      <TestWrapper>
        <MainLayout {...mockProps} />
      </TestWrapper>
    )

    await waitFor(() => {
      const sidebar = container.querySelector('.sidebar')
      expect(sidebar).toHaveClass('collapsed')
    })

    const expandButton = screen.getByTitle('Expand sidebar')
    fireEvent.click(expandButton)

    await waitFor(() => {
      expect(localStorage.getItem('leftSidebarCollapsed')).toBe('false')
      const sidebar = container.querySelector('.sidebar')
      expect(sidebar).not.toHaveClass('collapsed')
    })
  })

  it('persists collapsed state across component remounts', async () => {
    const { container, unmount } = render(
      <TestWrapper>
        <MainLayout {...mockProps} />
      </TestWrapper>
    )

    const collapseButton = screen.getByTitle('Collapse sidebar')
    fireEvent.click(collapseButton)

    await waitFor(() => {
      const sidebar = container.querySelector('.sidebar')
      expect(sidebar).toHaveClass('collapsed')
    })

    unmount()

    // Remount the component
    const { container: newContainer } = render(
      <TestWrapper>
        <MainLayout {...mockProps} />
      </TestWrapper>
    )

    await waitFor(() => {
      const sidebar = newContainer.querySelector('.sidebar')
      expect(sidebar).toHaveClass('collapsed')
    })
  })
})
