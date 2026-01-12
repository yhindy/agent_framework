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
    getAssignmentsForProject: vi.fn().mockResolvedValue({ assignments: [] }),
    createAssignmentForProject: vi.fn().mockResolvedValue({ agentId: 'test-agent-123' }),
    createSuperAssignment: vi.fn().mockResolvedValue({ agentId: 'super-agent-123' }),
    onAssignmentsUpdate: vi.fn().mockReturnValue(() => {}),
    checkDependencies: vi.fn().mockResolvedValue({ ghInstalled: true, ghAuthenticated: true }),
    getProjects: vi.fn().mockResolvedValue([])
  },
  writable: true
})

const mockProjects = [
  { name: 'test-project', path: '/path/to/project' }
]

// Helper to find select elements by their associated label text
const getSelectByLabelText = (labelText: string): HTMLSelectElement => {
  const label = screen.getByText(labelText)
  const formGroup = label.closest('.form-group')
  return formGroup?.querySelector('select') as HTMLSelectElement
}

// Helper to open type selection modal
const openTypeSelection = async () => {
  const newMissionButton = screen.getByText('+ New Mission')
  fireEvent.click(newMissionButton)

  await waitFor(() => {
    expect(screen.getByText('New Minion')).toBeInTheDocument()
  })
  fireEvent.click(screen.getByText('New Minion'))

  // Should show type selection modal
  await waitFor(() => {
    expect(screen.getByText('New Mission')).toBeInTheDocument()
    expect(screen.getByText('Choose how you want to work')).toBeInTheDocument()
  })
}

// Helper to open Single Agent creation form from dropdown
const openSingleAgentForm = async () => {
  await openTypeSelection()

  // Click Single Agent card - find by the title inside the card
  const cards = screen.getAllByText('Single Agent')
  const singleAgentCard = cards.find(el => el.className === 'type-title')?.closest('.type-card')
  fireEvent.click(singleAgentCard!)

  await waitFor(() => {
    expect(screen.getByText('Create Single Agent')).toBeInTheDocument()
  })
}

// Helper to open Orchestrator creation form from dropdown
const openOrchestratorForm = async () => {
  await openTypeSelection()

  // Click Orchestrator card - find by the title inside the card
  const cards = screen.getAllByText('Orchestrator')
  const orchestratorCard = cards.find(el => el.className === 'type-title')?.closest('.type-card')
  fireEvent.click(orchestratorCard!)

  await waitFor(() => {
    expect(screen.getByText('Create Orchestrator')).toBeInTheDocument()
  })
}

describe('Dashboard Creation Modal - Single Agent Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clicking New Minion shows type selection, then Single Agent form', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Should show Single Agent form title
    expect(screen.getByText('Create Single Agent')).toBeInTheDocument()
    // Should show Task label (not Goal)
    expect(screen.getByText('Task')).toBeInTheDocument()
  })

  it('shows Workflow radio cards for Single Agent', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Should show workflow options
    expect(screen.getByText('Plan First')).toBeInTheDocument()
    expect(screen.getByText('Start Immediately')).toBeInTheDocument()
    expect(screen.getByText('Agent proposes a plan for your review before making changes')).toBeInTheDocument()
  })

  it('defaults to Plan First workflow with opusplan model', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Plan First should be selected by default
    const planFirstRadio = screen.getByDisplayValue('planning') as HTMLInputElement
    expect(planFirstRadio.checked).toBe(true)

    // Model should be opusplan
    const modelSelect = getSelectByLabelText('Model')
    expect(modelSelect.value).toBe('opusplan')
  })

  it('switches model to haiku when Start Immediately is selected', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Click Start Immediately
    const startImmediatelyRadio = screen.getByDisplayValue('dev')
    fireEvent.click(startImmediatelyRadio)

    // Model should switch to haiku
    const modelSelect = getSelectByLabelText('Model')
    expect(modelSelect.value).toBe('haiku')
  })

  it('switches model to opusplan when Plan First is selected', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // First switch to Start Immediately
    const startImmediatelyRadio = screen.getByDisplayValue('dev')
    fireEvent.click(startImmediatelyRadio)

    // Then switch back to Plan First
    const planFirstRadio = screen.getByDisplayValue('planning')
    fireEvent.click(planFirstRadio)

    // Model should switch to opusplan
    const modelSelect = getSelectByLabelText('Model')
    expect(modelSelect.value).toBe('opusplan')
  })

  it('shows Start Agent CTA button for Single Agent', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    expect(screen.getByText('Start Agent')).toBeInTheDocument()
  })

  it('displays all available Claude models', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    const modelSelect = getSelectByLabelText('Model')
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

  it('includes correct values when creating Single Agent assignment', async () => {
    const mockCreateAssignment = vi.fn().mockResolvedValue({ agentId: 'test-agent-123' })
    window.electronAPI.createAssignmentForProject = mockCreateAssignment

    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Fill in required fields
    const branchInput = screen.getByPlaceholderText('user-auth')
    fireEvent.change(branchInput, { target: { value: 'test-feature' } })

    // Find the textarea in the form
    const textareas = screen.getAllByRole('textbox')
    const promptTextarea = textareas.find(t => t.tagName === 'TEXTAREA')
    fireEvent.change(promptTextarea!, { target: { value: 'Test task description' } })

    // Submit the form
    const submitButton = screen.getByText('Start Agent')
    fireEvent.click(submitButton)

    // Wait for the API call
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalled()
    })

    // Verify the call arguments
    const callArgs = mockCreateAssignment.mock.calls[0]
    expect(callArgs[0]).toBe('/path/to/project') // projectPath
    expect(callArgs[1]).toMatchObject({
      mode: 'planning',
      model: 'opusplan',
      tool: 'claude'
    })
  })
})

describe('Dashboard Creation Modal - Orchestrator Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clicking New Minion shows type selection, then Orchestrator form', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openOrchestratorForm()

    // Should show Orchestrator form title
    expect(screen.getByText('Create Orchestrator')).toBeInTheDocument()
    // Should show Goal label (not Task)
    expect(screen.getByText('Goal')).toBeInTheDocument()
  })

  it('shows Create Plan CTA button for Orchestrator', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openOrchestratorForm()

    expect(screen.getByText('Create Plan')).toBeInTheDocument()
  })

  it('does not show Workflow selector for Orchestrator', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openOrchestratorForm()

    // Should NOT show workflow options
    expect(screen.queryByText('Plan First')).not.toBeInTheDocument()
    expect(screen.queryByText('Start Immediately')).not.toBeInTheDocument()
  })

  it('shows inline education text for Orchestrator', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openOrchestratorForm()

    expect(screen.getByText(/The orchestrator will analyze your goal and create a plan/)).toBeInTheDocument()
  })
})

describe('Dashboard Creation Modal - Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Cancel button closes modal', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Click cancel
    const cancelButton = screen.getByText('Back')
    fireEvent.click(cancelButton)

    // Modal should still be open but show type selection (Back goes to type selection)
    // Actually with the new flow, Back should go to type selection
    await waitFor(() => {
      expect(screen.getByText('New Mission')).toBeInTheDocument()
    })
  })
})

describe('Dashboard Model Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves model selection when switching between fields', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Select a different model
    const modelSelect = getSelectByLabelText('Model')
    fireEvent.change(modelSelect, { target: { value: 'opus' } })
    expect(modelSelect.value).toBe('opus')

    // Fill in other fields
    const branchInput = screen.getByPlaceholderText('user-auth')
    fireEvent.change(branchInput, { target: { value: 'test-feature' } })

    // Verify model selection persisted
    expect(modelSelect.value).toBe('opus')
  })
})

describe('Dashboard Codex Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays Codex as a tool option', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    const toolSelect = getSelectByLabelText('Tool')
    const options = Array.from(toolSelect.options).map(opt => ({
      value: opt.value,
      text: opt.textContent
    }))

    expect(options).toContainEqual({ value: 'codex', text: 'OpenAI Codex' })
  })

  it('does not show model dropdown when codex is selected', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Select codex tool
    const toolSelect = getSelectByLabelText('Tool')
    fireEvent.change(toolSelect, { target: { value: 'codex' } })

    // Model label should not exist
    expect(screen.queryByText('Model')).not.toBeInTheDocument()
  })

  it('automatically sets model to gpt-5.2-codex when codex is selected', async () => {
    const mockCreateAssignment = vi.fn().mockResolvedValue({ agentId: 'test-agent-123' })
    window.electronAPI.createAssignmentForProject = mockCreateAssignment

    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Select codex tool
    const toolSelect = getSelectByLabelText('Tool')
    fireEvent.change(toolSelect, { target: { value: 'codex' } })

    // Fill in required fields
    const branchInput = screen.getByPlaceholderText('user-auth')
    fireEvent.change(branchInput, { target: { value: 'test-feature' } })

    const textareas = screen.getAllByRole('textbox')
    const promptTextarea = textareas.find(t => t.tagName === 'TEXTAREA')
    fireEvent.change(promptTextarea!, { target: { value: 'Test task description' } })

    // Submit the form
    const submitButton = screen.getByText('Start Agent')
    fireEvent.click(submitButton)

    // Wait for the API call
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalled()
    })

    // Verify the model is set to gpt-5.2-codex
    const callArgs = mockCreateAssignment.mock.calls[0]
    expect(callArgs[1]).toMatchObject({
      tool: 'codex',
      model: 'gpt-5.2-codex'
    })
  })

  it('shows model dropdown when switching from codex to claude', async () => {
    render(
      <MemoryRouter>
        <Dashboard activeProjects={mockProjects} onRefresh={() => {}} />
      </MemoryRouter>
    )

    await openSingleAgentForm()

    // Select codex tool
    const toolSelect = getSelectByLabelText('Tool')
    fireEvent.change(toolSelect, { target: { value: 'codex' } })

    // Model dropdown should not exist
    expect(screen.queryByText('Model')).not.toBeInTheDocument()

    // Switch back to claude
    fireEvent.change(toolSelect, { target: { value: 'claude' } })

    // Model dropdown should now exist
    await waitFor(() => {
      expect(screen.getByText('Model')).toBeInTheDocument()
    })
  })
})
