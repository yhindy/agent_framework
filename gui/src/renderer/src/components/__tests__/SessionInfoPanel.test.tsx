import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import SessionInfoPanel from '../SessionInfoPanel'

describe('SessionInfoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats and lowercases model names for non-Claude tools', () => {
    render(
      <SessionInfoPanel
        agentId="agent-1"
        isRunning={false}
        status="idle"
        model="GPT-5-2-CODEX"
      />
    )

    expect(screen.getByText('gpt-5.2-codex')).toBeInTheDocument()
  })

  it('normalizes in_progress status to Working', () => {
    render(
      <SessionInfoPanel
        agentId="agent-1"
        isRunning={false}
        status="in_progress"
      />
    )

    expect(screen.getByText('Working')).toBeInTheDocument()
  })

  it('simplifies Claude model names in the collapsed badge', async () => {
    vi.mocked(window.electronAPI.getClaudeSessionInfo).mockResolvedValueOnce({
      sessionId: 'session-123',
      actualModel: 'claude-opus-4-5-20251101',
      lastUpdated: new Date().toISOString(),
      modelHistory: [],
      state: 'working'
    })

    render(
      <SessionInfoPanel
        agentId="agent-1"
        isRunning={true}
        status="working"
      />
    )

    expect(await screen.findByText('opus-4.5')).toBeInTheDocument()
  })
})
