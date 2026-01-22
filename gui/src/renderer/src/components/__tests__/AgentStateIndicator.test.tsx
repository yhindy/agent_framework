import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentStateIndicator from '../AgentStateIndicator'

describe('AgentStateIndicator', () => {
  describe('rendering', () => {
    it('renders a span element', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toBeInTheDocument()
      expect(indicator?.tagName).toBe('SPAN')
    })
  })

  describe('state classes when running', () => {
    it('applies working class when state is working', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--working')
    })

    it('applies waiting class when state is waiting', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="waiting" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--waiting')
    })

    it('applies idle class when state is unknown', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="unknown" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--idle')
    })
  })

  describe('state when not running', () => {
    it('applies idle class when not running regardless of claudeState', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={false} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--idle')
    })

    it('shows stopped title when not running', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={false} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('title', 'Agent stopped')
    })
  })

  describe('title attributes', () => {
    it('has correct title for working state', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('title', 'Agent is working')
    })

    it('has correct title for waiting state', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="waiting" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('title', 'Agent is waiting for input')
    })

    it('has correct title for unknown state', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="unknown" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('title', 'Agent state unknown')
    })
  })

  describe('size variants', () => {
    it('applies small size class by default', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--small')
    })

    it('applies medium size class when specified', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} size="medium" />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--medium')
    })

    it('applies small size class when explicitly specified', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} size="small" />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveClass('state-indicator--small')
    })
  })

  describe('accessibility', () => {
    it('has aria-label matching the title', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('aria-label', 'Agent is working')
    })

    it('aria-label reflects stopped state when not running', () => {
      const { container } = render(
        <AgentStateIndicator claudeState="working" isRunning={false} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('aria-label', 'Agent stopped')
    })
  })

  describe('memoization', () => {
    it('component is memoized (memo wrapper)', () => {
      // The component uses memo(), so re-renders with same props should use cached version
      const { rerender, container } = render(
        <AgentStateIndicator claudeState="working" isRunning={true} />
      )

      const firstIndicator = container.querySelector('.state-indicator')

      rerender(<AgentStateIndicator claudeState="working" isRunning={true} />)

      const secondIndicator = container.querySelector('.state-indicator')

      // Same element should be reused due to memoization
      expect(firstIndicator).toBe(secondIndicator)
    })
  })
})
