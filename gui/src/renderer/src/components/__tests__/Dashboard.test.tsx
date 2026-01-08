import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Dashboard from '../Dashboard'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// Mock the hooks
vi.mock('../../hooks/useLoadingSnackbar', () => ({
  useLoadingSnackbar: () => ({
    showLoading: vi.fn(),
    hideLoading: vi.fn()
  })
}))

vi.mock('../../hooks/usePRPolling', () => ({
  usePRPolling: () => ({})
}))

// Mock window.electronAPI
global.window = Object.create(window)
Object.defineProperty(window, 'electronAPI', {
  value: {
    listAssignments: vi.fn().mockResolvedValue([]),
    createAssignment: vi.fn().mockResolvedValue({ agentId: 'test-agent-123' }),
    onAssignmentsUpdate: vi.fn().mockReturnValue(() => {}),
    checkGitHubCLI: vi.fn().mockResolvedValue({ available: true, error: '' }),
    getProjects: vi.fn().mockResolvedValue([])
  },
  writable: true
})

describe('Dashboard Model Selection', () => {
  const mockProjects = [
    { name: 'test-project', path: '/path/to/project' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays all available Claude models including OpusPlan', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Find the model dropdown (it should be visible for claude tool which is default)
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement

    // Check all options are present
    const options = Array.from(modelSelect.options).map(opt => ({
      value: opt.value,
      text: opt.textContent
    }))

    expect(options).toEqual([
      { value: 'haiku', text: 'Haiku' },
      { value: 'sonnet', text: 'Sonnet' },
      { value: 'opus', text: 'Opus' },
      { value: 'opusplan', text: 'Opus Plan' }
    ])
  })

  it('sets model to opusplan when selected', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Find and change the model dropdown
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    fireEvent.change(modelSelect, { target: { value: 'opusplan' } })

    // Verify the value changed
    expect(modelSelect.value).toBe('opusplan')
  })

  it('includes opusplan model in assignment creation', async () => {
    const mockCreateAssignment = vi.fn().mockResolvedValue({ agentId: 'test-agent-123' })
    window.electronAPI.createAssignment = mockCreateAssignment

    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Fill in the form
    const shortNameInput = screen.getByLabelText('Short Name')
    fireEvent.change(shortNameInput, { target: { value: 'test-feature' } })

    const promptTextarea = screen.getByLabelText('Prompt')
    fireEvent.change(promptTextarea, { target: { value: 'test prompt' } })

    // Select opusplan model
    const modelSelect = screen.getByLabelText('Model')
    fireEvent.change(modelSelect, { target: { value: 'opusplan' } })

    // Submit the form
    const submitButton = screen.getByText('Create Mission')
    fireEvent.click(submitButton)

    // Wait for the API call
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalled()
    })

    // Verify the model was included in the call
    const callArgs = mockCreateAssignment.mock.calls[0][0]
    expect(callArgs.model).toBe('opusplan')
  })

  it('defaults to opusplan model when form is initialized', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Check default value
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    expect(modelSelect.value).toBe('opusplan')
  })

  it('preserves model selection when switching between fields', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Select opusplan model
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    fireEvent.change(modelSelect, { target: { value: 'opusplan' } })
    expect(modelSelect.value).toBe('opusplan')

    // Fill in other fields
    const shortNameInput = screen.getByLabelText('Short Name')
    fireEvent.change(shortNameInput, { target: { value: 'test-feature' } })

    const promptTextarea = screen.getByLabelText('Prompt')
    fireEvent.change(promptTextarea, { target: { value: 'test prompt' } })

    // Verify model selection persisted
    expect(modelSelect.value).toBe('opusplan')
  })

  it('switches to haiku when mode changes to dev', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Default should be opusplan with planning mode
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    expect(modelSelect.value).toBe('opusplan')

    // Switch to dev mode
    const modeSelect = screen.getByLabelText('Mode') as HTMLSelectElement
    fireEvent.change(modeSelect, { target: { value: 'dev' } })

    // Model should automatically switch to haiku
    expect(modelSelect.value).toBe('haiku')
  })

  it('switches to opusplan when mode changes to planning', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    // Open the create mission form
    const createButton = screen.getByText('Create New Mission')
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })

    // Switch to dev mode first
    const modeSelect = screen.getByLabelText('Mode') as HTMLSelectElement
    fireEvent.change(modeSelect, { target: { value: 'dev' } })

    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    expect(modelSelect.value).toBe('haiku')

    // Switch back to planning mode
    fireEvent.change(modeSelect, { target: { value: 'planning' } })

    // Model should automatically switch to opusplan
    expect(modelSelect.value).toBe('opusplan')
  })
})
