import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentStateIndicator from '../AgentStateIndicator'

describe('AgentStateIndicator', () => {
  it.each([
    { claudeState: 'working' as const, isRunning: true, expectedTitle: 'Agent is working' },
    { claudeState: 'waiting' as const, isRunning: true, expectedTitle: 'Agent is waiting for input' },
    { claudeState: 'unknown' as const, isRunning: true, expectedTitle: 'Agent state unknown' },
    { claudeState: 'working' as const, isRunning: false, expectedTitle: 'Agent stopped' },
    { claudeState: 'waiting' as const, isRunning: false, expectedTitle: 'Agent stopped' },
  ])('shows "$expectedTitle" for claudeState=$claudeState, isRunning=$isRunning',
    ({ claudeState, isRunning, expectedTitle }) => {
      const { container } = render(
        <AgentStateIndicator claudeState={claudeState} isRunning={isRunning} />
      )

      const indicator = container.querySelector('.state-indicator')
      expect(indicator).toHaveAttribute('title', expectedTitle)
      expect(indicator).toHaveAttribute('aria-label', expectedTitle)
    }
  )

  it('overrides claudeState when not running', () => {
    const { container } = render(
      <AgentStateIndicator claudeState="working" isRunning={false} />
    )

    const indicator = container.querySelector('.state-indicator')
    // Should show "stopped" state even though claudeState is "working"
    expect(indicator).toHaveAttribute('title', 'Agent stopped')
  })
})
