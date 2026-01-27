import { render, fireEvent } from '@testing-library/react'
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
    focus: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    rows: 24,
    cols: 80
  }

  // Export mock instance globally for tests to access
  ;(globalThis as any).mockTerminalInstance = mockTerminalInstance

  // Track constructor calls with options
  const constructorCalls: any[] = []

  class Terminal {
    loadAddon = mockTerminalInstance.loadAddon
    open = mockTerminalInstance.open
    dispose = mockTerminalInstance.dispose
    onData = mockTerminalInstance.onData
    write = mockTerminalInstance.write
    scrollToBottom = mockTerminalInstance.scrollToBottom
    focus = mockTerminalInstance.focus
    attachCustomKeyEventHandler = mockTerminalInstance.attachCustomKeyEventHandler
    rows = mockTerminalInstance.rows
    cols = mockTerminalInstance.cols

    constructor(options?: any) {
      constructorCalls.push(options)
      ;(globalThis as any).xtermConstructorCalls = constructorCalls
    }
  }

  return { Terminal }
})

// Import after mocking
import PlainTerminal from '../PlainTerminal'

// Mock xterm-addon-fit module
vi.mock('xterm-addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
  }

  return { FitAddon }
})

// Mock xterm css
vi.mock('xterm/css/xterm.css', () => ({}))

describe('PlainTerminal - Auto-Scroll Feature', () => {
  const mockAgentId = 'test-agent-1'
  const mockTerminalId = 'terminal-1'
  const fullTerminalId = `${mockAgentId}-${mockTerminalId}`

  beforeEach(() => {
    vi.clearAllMocks()

    window.electronAPI.onPlainTerminalOutput = vi.fn((callback) => {
      callback(fullTerminalId, 'test output')
      return vi.fn()
    })
    window.electronAPI.sendPlainTerminalInput = vi.fn()
    window.electronAPI.resizePlainTerminal = vi.fn()
    window.electronAPI.startPlainTerminal = vi.fn()
  })

  it('calls scrollToBottom after replaying cached content', () => {
    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('calls focus on terminal initialization', () => {
    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    expect(mockTerminalInstance.focus).toHaveBeenCalled()
  })

  it('calls scrollToBottom and focus when container is clicked', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()
    mockTerminalInstance.focus.mockClear()

    const { container } = render(
      <PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />
    )

    const terminalContainer = container.querySelector('.terminal-container') as HTMLElement
    fireEvent.click(terminalContainer)

    // Should have called both focus and scrollToBottom on click
    expect(mockTerminalInstance.focus).toHaveBeenCalled()
    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('calls scrollToBottom when container gains focus', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    const { container } = render(
      <PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />
    )

    const terminalContainer = container.querySelector('.terminal-container') as HTMLElement

    // Simulate focus event on the container
    const focusEvent = new FocusEvent('focus', { bubbles: true })
    terminalContainer?.dispatchEvent(focusEvent)

    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('cleans up event listeners on unmount', () => {
    const { unmount } = render(
      <PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />
    )

    // Should not throw on unmount
    expect(() => unmount()).not.toThrow()
  })

  it('scrolls to bottom even with empty cached output', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.scrollToBottom.mockClear()

    window.electronAPI.onPlainTerminalOutput = vi.fn()

    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    expect(mockTerminalInstance.scrollToBottom).toHaveBeenCalled()
  })

  it('starts plain terminal on mount', () => {
    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    expect(window.electronAPI.startPlainTerminal).toHaveBeenCalledWith(
      mockAgentId,
      mockTerminalId
    )
  })
})

describe('PlainTerminal - xterm Configuration', () => {
  const mockAgentId = 'test-agent-limit'
  const mockTerminalId = 'terminal-limit'

  beforeEach(() => {
    vi.clearAllMocks()

    window.electronAPI.onPlainTerminalOutput = vi.fn(() => vi.fn())
    window.electronAPI.sendPlainTerminalInput = vi.fn()
    window.electronAPI.resizePlainTerminal = vi.fn()
    window.electronAPI.startPlainTerminal = vi.fn()

    // Clear constructor tracking
    ;(globalThis as any).xtermConstructorCalls = []
  })

  it('configures xterm with scrollback limit', () => {
    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    const constructorCalls = (globalThis as any).xtermConstructorCalls
    expect(constructorCalls.length).toBeGreaterThan(0)

    const lastCall = constructorCalls[constructorCalls.length - 1]
    expect(lastCall).toHaveProperty('scrollback')
    expect(lastCall.scrollback).toBe(10000)
  })
})
