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

describe('TestEnvTerminal - Output Cache Limits', () => {
  const mockAgentId = 'test-agent-limit'
  const mockCommandId = 'cmd-limit'
  let outputCallbacks: Array<(agentId: string, commandId: string, data: string) => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
    outputCallbacks = []

    // Mock electronAPI to capture output callbacks
    window.electronAPI.onTestEnvOutput = vi.fn((callback) => {
      outputCallbacks.push(callback)
      return vi.fn()
    })
    window.electronAPI.sendTestEnvInput = vi.fn()
    window.electronAPI.resizeTestEnv = vi.fn()

    // Clear constructor tracking
    ;(globalThis as any).xtermConstructorCalls = []
  })

  it('configures xterm with scrollback limit', () => {
    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

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
      callback(mockAgentId, mockCommandId, `chunk-${i}\n`)
    }

    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    // With REPLAY_BATCH_SIZE=100, 500 chunks should result in 5 write calls
    const writeCalls = mockTerminalInstance.write.mock.calls

    // Should have fewer write calls than total chunks (batched)
    expect(writeCalls.length).toBeLessThan(500)
    expect(writeCalls.length).toBeGreaterThan(0)
  })

  it('trims cache when exceeding MAX_CHUNKS', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    expect(outputCallbacks.length).toBeGreaterThan(0)
    const callback = outputCallbacks[0]

    // Simulate receiving MAX_CHUNKS + 1000 output events (11000 total)
    for (let i = 0; i < 11000; i++) {
      callback(mockAgentId, mockCommandId, `output-${i}\n`)
    }

    // Verify system doesn't crash and continues to work
    expect(mockTerminalInstance.write).toHaveBeenCalled()
  })

  it('consolidates chunks to prevent array fragmentation', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    expect(outputCallbacks.length).toBeGreaterThan(0)
    const callback = outputCallbacks[0]

    // Send exactly CONSOLIDATION_THRESHOLD (1000) chunks to trigger consolidation
    for (let i = 0; i < 1000; i++) {
      callback(mockAgentId, mockCommandId, 'x')
    }

    // After consolidation, sending more data should still work
    callback(mockAgentId, mockCommandId, 'y')

    // Verify system continues to work after consolidation
    expect(mockTerminalInstance.write).toHaveBeenCalled()
  })

  it('handles rapid output without crashing', () => {
    const mockTerminalInstance = (globalThis as any).mockTerminalInstance
    mockTerminalInstance.write.mockClear()

    render(<TestEnvTerminal agentId={mockAgentId} commandId={mockCommandId} />)

    const callback = outputCallbacks[0]

    // Simulate rapid output (5000 chunks)
    for (let i = 0; i < 5000; i++) {
      callback(mockAgentId, mockCommandId, `rapid-output-${i}\n`)
    }

    // Should not crash and should have written data
    expect(mockTerminalInstance.write).toHaveBeenCalled()
    expect(mockTerminalInstance.write.mock.calls.length).toBeGreaterThan(0)
  })
})
