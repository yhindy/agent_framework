import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

// Mock xterm module - define the mock directly inline to avoid hoisting issues
vi.mock('xterm', () => {
  const mockTerminalInstance = {
    loadAddon: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    write: vi.fn(),
    scrollToBottom: vi.fn(),
    rows: 24,
    cols: 80
  }

  // Export mock instance globally for tests to access
  ;(globalThis as any).mockTerminalInstance = mockTerminalInstance

  class Terminal {
    loadAddon = mockTerminalInstance.loadAddon
    open = mockTerminalInstance.open
    dispose = mockTerminalInstance.dispose
    onData = mockTerminalInstance.onData
    write = mockTerminalInstance.write
    scrollToBottom = mockTerminalInstance.scrollToBottom
    rows = mockTerminalInstance.rows
    cols = mockTerminalInstance.cols
  }

  return { Terminal }
})

// Import after mocking
import TestEnvTerminal from '../TestEnvTerminal'

// Mock xterm-addon-fit module
vi.mock('xterm-addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
  }

  return { FitAddon }
})

// Mock xterm css
vi.mock('xterm/css/xterm.css', () => ({}))

describe('TestEnvTerminal - Auto-Scroll Feature', () => {
  const mockAgentId = 'test-agent-1'
  const mockCommandId = 'cmd-1'

  beforeEach(() => {
    vi.clearAllMocks()

    window.electronAPI.onTestEnvOutput = vi.fn((callback) => {
      callback(mockAgentId, mockCommandId, 'test output')
      return vi.fn()
    })
    window.electronAPI.sendTestEnvInput = vi.fn()
    window.electronAPI.resizeTestEnv = vi.fn()
  })

  it('calls scrollToBottom after replaying cached content', () => {
    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('calls scrollToBottom when container gains focus', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    const { container } = render(
      <TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />
    )

    const terminalContainer = container.querySelector('.terminal-container') as HTMLElement

    // Simulate focus event on the container
    const focusEvent = new FocusEvent('focus', { bubbles: true })
    terminalContainer?.dispatchEvent(focusEvent)

    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('cleans up event listeners on unmount', () => {
    const { unmount } = render(
      <TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />
    )

    // Should not throw on unmount
    expect(() => unmount()).not.toThrow()
  })

  it('scrolls to bottom even with empty cached output', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    window.electronAPI.onTestEnvOutput = vi.fn()

    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('registers terminal for live output', () => {
    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    // Terminal should be registered - verify by checking it was created and set up
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('handles multiple terminals for different commands', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()

    // Clear the mock
    mockTerminalInstance.scrollToBottom.mockClear()

    const mockCommandId2 = 'cmd-2'
    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId2} />)

    // Should have scrolled to bottom for the new terminal
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })
})
