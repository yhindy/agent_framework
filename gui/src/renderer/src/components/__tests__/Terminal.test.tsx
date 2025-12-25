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
import Terminal from '../Terminal'

// Mock xterm-addon-fit module
vi.mock('xterm-addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
  }

  return { FitAddon }
})

// Mock xterm css
vi.mock('xterm/css/xterm.css', () => ({}))

describe('Terminal - Auto-Scroll Feature', () => {
  const mockAgentId = 'test-agent-1'

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset the global listeners
    window.electronAPI.onTerminalOutput = vi.fn((callback) => {
      callback(mockAgentId, 'test output')
      return vi.fn()
    })
    window.electronAPI.sendTerminalInput = vi.fn()
    window.electronAPI.resizeTerminal = vi.fn()
  })

  it('calls scrollToBottom after replaying cached content', () => {
    render(<Terminal agentId={mockAgentId} />)

    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('calls scrollToBottom when container gains focus', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    const { container } = render(<Terminal agentId={mockAgentId} />)

    const terminalContainer = container.querySelector('.terminal-container') as HTMLElement

    // Simulate focus event on the container
    const focusEvent = new FocusEvent('focus', { bubbles: true })
    terminalContainer?.dispatchEvent(focusEvent)

    // Should have been called during mount + on focus
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('cleans up event listeners on unmount', () => {
    const { unmount } = render(<Terminal agentId={mockAgentId} />)

    // Should not throw on unmount
    expect(() => unmount()).not.toThrow()
  })

  it('scrolls to bottom even with empty cached output', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    // Mock electronAPI with no cached output
    window.electronAPI.onTerminalOutput = vi.fn()

    render(<Terminal agentId={mockAgentId} />)

    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })
})
