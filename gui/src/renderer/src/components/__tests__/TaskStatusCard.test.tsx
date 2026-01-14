import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import TaskStatusCard from '../TaskStatusCard'
import { TaskInvocation } from '../../../../main/services/ClaudeSessionInfoService'
import React from 'react'

describe('TaskStatusCard', () => {
  const mockRunningTask: TaskInvocation = {
    toolUseId: 'task-1',
    description: 'Implement user authentication',
    subagentType: 'general-purpose',
    prompt: 'Implement user auth with JWT',
    status: 'running',
    startedAt: new Date(Date.now() - 120000).toISOString() // 2 minutes ago
  }

  const mockCompletedTask: TaskInvocation = {
    toolUseId: 'task-2',
    description: 'Explore codebase structure',
    subagentType: 'Explore',
    prompt: 'Find all authentication files',
    status: 'completed',
    startedAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    completedAt: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
    resultSummary: 'Found 3 authentication files in src/auth/'
  }

  const mockFailedTask: TaskInvocation = {
    toolUseId: 'task-3',
    description: 'Run bash command',
    subagentType: 'Bash',
    prompt: 'Run npm test',
    status: 'failed',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    completedAt: new Date(Date.now() - 30000).toISOString(),
    resultSummary: 'Command failed with exit code 1'
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders running task correctly', () => {
    const { container } = render(<TaskStatusCard task={mockRunningTask} />)

    expect(screen.getByText('Implement user authentication')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('general-purpose')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="hammer-icon"]')).toBeInTheDocument()
  })

  it('renders completed task correctly', () => {
    const { container } = render(<TaskStatusCard task={mockCompletedTask} />)

    expect(screen.getByText('Explore codebase structure')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="search-icon"]')).toBeInTheDocument()
  })

  it('renders failed task correctly', () => {
    const { container } = render(<TaskStatusCard task={mockFailedTask} />)

    expect(screen.getByText('Run bash command')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="terminal-icon"]')).toBeInTheDocument()
  })

  it('shows expand hint when task has result summary but is collapsed', () => {
    render(<TaskStatusCard task={mockCompletedTask} />)

    expect(screen.getByText('Click to view result')).toBeInTheDocument()
    expect(screen.queryByText('Found 3 authentication files in src/auth/')).not.toBeInTheDocument()
  })

  it('expands to show result summary when clicked', () => {
    render(<TaskStatusCard task={mockCompletedTask} />)

    // Click to expand
    fireEvent.click(screen.getByText('Explore codebase structure').closest('.task-card')!)

    expect(screen.getByText('Found 3 authentication files in src/auth/')).toBeInTheDocument()
    expect(screen.queryByText('Click to view result')).not.toBeInTheDocument()
  })

  it('applies correct status class for running task', () => {
    const { container } = render(<TaskStatusCard task={mockRunningTask} />)
    const statusDot = container.querySelector('.status-dot')
    expect(statusDot).toHaveClass('in_progress')
  })

  it('applies correct status class for completed task', () => {
    const { container } = render(<TaskStatusCard task={mockCompletedTask} />)
    const statusDot = container.querySelector('.status-dot')
    expect(statusDot).toHaveClass('completed')
  })

  it('applies correct status class for failed task', () => {
    const { container } = render(<TaskStatusCard task={mockFailedTask} />)
    const statusDot = container.querySelector('.status-dot')
    expect(statusDot).toHaveClass('blocked')
  })

  it('uses default icon for unknown subagent type', () => {
    const customTask: TaskInvocation = {
      ...mockRunningTask,
      subagentType: 'custom-unknown-type'
    }
    const { container } = render(<TaskStatusCard task={customTask} />)

    expect(container.querySelector('[data-testid="hammer-icon"]')).toBeInTheDocument()
  })

  it('shows Plan icon for Plan subagent type', () => {
    const planTask: TaskInvocation = {
      ...mockRunningTask,
      subagentType: 'Plan'
    }
    const { container } = render(<TaskStatusCard task={planTask} />)

    expect(container.querySelector('[data-testid="clipboard-icon"]')).toBeInTheDocument()
  })

  it('does not show expand hint when task has no result summary', () => {
    render(<TaskStatusCard task={mockRunningTask} />)

    expect(screen.queryByText('Click to view result')).not.toBeInTheDocument()
  })
})
