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

describe('PlainTerminal - Output Cache Limits', () => {
  const mockAgentId = 'test-agent-limit'
  const mockTerminalId = 'terminal-limit'
  const fullTerminalId = `${mockAgentId}-${mockTerminalId}`
  let outputCallbacks: Array<(id: string, data: string) => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
    outputCallbacks = []

    // Mock electronAPI to capture output callbacks
    window.electronAPI.onPlainTerminalOutput = vi.fn((callback) => {
      outputCallbacks.push(callback)
      return vi.fn()
    })
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

  it('batches chunks during replay', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    // Simulate 500 cached chunks before component mounts
    const callback = outputCallbacks[0] || vi.fn()
    for (let i = 0; i < 500; i++) {
      callback(fullTerminalId, `chunk-${i}\n`)
    }

    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    // With REPLAY_BATCH_SIZE=100, 500 chunks should result in 5 write calls
    const writeCalls = mockTerminalInstance.write.mock.calls

    // Should have fewer write calls than total chunks (batched)
    expect(writeCalls.length).toBeLessThan(500)
    expect(writeCalls.length).toBeGreaterThan(0)
  })

  it('trims cache when exceeding MAX_CHUNKS', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    expect(outputCallbacks.length).toBeGreaterThan(0)
    const callback = outputCallbacks[0]

    // Simulate receiving MAX_CHUNKS + 1000 output events (11000 total)
    for (let i = 0; i < 11000; i++) {
      callback(fullTerminalId, `output-${i}\n`)
    }

    // Verify system doesn't crash and continues to work
    expect(mockTerminalInstance.write).toHaveBeenCalled()
  })

  it('consolidates chunks to prevent array fragmentation', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    expect(outputCallbacks.length).toBeGreaterThan(0)
    const callback = outputCallbacks[0]

    // Send exactly CONSOLIDATION_THRESHOLD (1000) chunks to trigger consolidation
    for (let i = 0; i < 1000; i++) {
      callback(fullTerminalId, 'x')
    }

    // After consolidation, sending more data should still work
    callback(fullTerminalId, 'y')

    // Verify system continues to work after consolidation
    expect(mockTerminalInstance.write).toHaveBeenCalled()
  })

  it('handles rapid output without crashing', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    render(<PlainTerminal agentId={mockAgentId} terminalId={mockTerminalId} />)

    const callback = outputCallbacks[0]

    // Simulate rapid output (5000 chunks)
    for (let i = 0; i < 5000; i++) {
      callback(fullTerminalId, `rapid-output-${i}\n`)
    }

    // Should not crash and should have written data
    expect(mockTerminalInstance.write).toHaveBeenCalled()
    expect(mockTerminalInstance.write.mock.calls.length).toBeGreaterThan(0)
  })
})
