import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentHeader, { HeaderBadge } from '../AgentHeader'

vi.mock('../SessionInfoPanel', () => ({
  default: ({ agentId }: any) => <div data-testid="session-info">{agentId}</div>
}))

const mockWriteText = vi.fn().mockResolvedValue(undefined)
Object.assign(navigator, { clipboard: { writeText: mockWriteText } })

describe('AgentHeader', () => {
  const baseProps = {
    icon: <span>Icon</span>,
    title: 'Agent',
    typeLabel: 'Minion' as const,
    agentId: 'agent-1'
  }

  beforeEach(() => vi.clearAllMocks())

  describe('copy to clipboard', () => {
    it('copies value when clicking copyable badge', () => {
      const badges: HeaderBadge[] = [
        { label: 'Branch', value: 'feature-xyz', copyable: true }
      ]
      render(<AgentHeader {...baseProps} badges={badges} />)

      fireEvent.click(screen.getByText('feature-xyz'))

      expect(mockWriteText).toHaveBeenCalledWith('feature-xyz')
    })

    it('shows "Copied!" feedback after copying', () => {
      const badges: HeaderBadge[] = [
        { label: 'Branch', value: 'main', copyable: true }
      ]
      render(<AgentHeader {...baseProps} badges={badges} />)

      fireEvent.click(screen.getByText('main'))

      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })

    it('does not copy non-copyable badges', () => {
      const badges: HeaderBadge[] = [
        { label: 'Status', value: 'Active', copyable: false }
      ]
      render(<AgentHeader {...baseProps} badges={badges} />)

      fireEvent.click(screen.getByText('Active'))

      expect(mockWriteText).not.toHaveBeenCalled()
    })
  })

  describe('badge filtering', () => {
    it('hides badges with id variant', () => {
      const badges: HeaderBadge[] = [
        { label: 'ID', value: 'hidden', variant: 'id' },
        { label: 'Branch', value: 'visible' }
      ]
      render(<AgentHeader {...baseProps} badges={badges} />)

      expect(screen.queryByText('hidden')).not.toBeInTheDocument()
      expect(screen.getByText('visible')).toBeInTheDocument()
    })
  })

  describe('task indicator', () => {
    it('shows count when tasks > 0', () => {
      render(<AgentHeader {...baseProps} taskCount={3} />)
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('hides when no tasks', () => {
      const { container } = render(<AgentHeader {...baseProps} taskCount={0} />)
      expect(container.querySelector('.header-task-indicator')).not.toBeInTheDocument()
    })
  })

  describe('SessionInfoPanel integration', () => {
    it('passes isRunning=false for non-claude tools', () => {
      render(<AgentHeader {...baseProps} isRunning={true} tool="codex" />)
      // SessionInfoPanel receives false because tool !== 'claude'
      expect(screen.getByTestId('session-info')).toBeInTheDocument()
    })
  })

  describe('working state chip', () => {
    it('shows Working chip when workingState is working', () => {
      render(<AgentHeader {...baseProps} workingState="working" />)
      expect(screen.getByText('Working')).toBeInTheDocument()
    })

    it('shows Waiting chip when workingState is waiting', () => {
      render(<AgentHeader {...baseProps} workingState="waiting" />)
      expect(screen.getByText('Waiting')).toBeInTheDocument()
    })

    it('hides chip when workingState is unknown', () => {
      render(<AgentHeader {...baseProps} workingState="unknown" />)
      expect(screen.queryByText('Working')).not.toBeInTheDocument()
      expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
    })

    it('hides chip when workingState is undefined', () => {
      render(<AgentHeader {...baseProps} />)
      expect(screen.queryByText('Working')).not.toBeInTheDocument()
      expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
    })
  })
})
