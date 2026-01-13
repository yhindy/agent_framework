import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((callback) => {
  callback(0)
  return 0
})

global.cancelAnimationFrame = vi.fn()

// Mock Electron API
Object.defineProperty(window, 'electronAPI', {
  value: {
    listAgentsForProject: vi.fn(),
    getAssignmentsForProject: vi.fn(),
    onAgentListUpdate: vi.fn(() => vi.fn()),
    onTestEnvStarted: vi.fn(() => vi.fn()),
    onTestEnvStopped: vi.fn(() => vi.fn()),
    onTestEnvExited: vi.fn(() => vi.fn()),
    clearUnread: vi.fn(),
    getSuperAgentDetails: vi.fn(),
    approvePlan: vi.fn(),
    updateAssignment: vi.fn(),
    createAssignmentForProject: vi.fn(),
    stopAgent: vi.fn(),
    openInCursor: vi.fn(),
    teardownAgent: vi.fn(),
    unassignAgent: vi.fn(),
    createPullRequest: vi.fn(),
    checkPullRequestStatus: vi.fn(),
    checkDependencies: vi.fn(),
    getTestEnvConfig: vi.fn().mockResolvedValue({ defaultCommands: [] }),
    getTestEnvStatus: vi.fn().mockResolvedValue([]),
    startTestEnv: vi.fn(),
    stopTestEnv: vi.fn(),
    stopPlainTerminal: vi.fn(),
    onAssignmentsUpdate: vi.fn(() => vi.fn()),
    onAgentWaitingForInput: vi.fn(() => vi.fn()),
    onAgentResumedWork: vi.fn(() => vi.fn()),
    onAgentStateChanged: vi.fn(() => vi.fn()),
    getAgentState: vi.fn(),
    onPlainTerminalWaitingForInput: vi.fn(() => vi.fn()),
    onPlainTerminalResumedWork: vi.fn(() => vi.fn()),
    onTerminalOutput: vi.fn(() => vi.fn()),
    onTestEnvOutput: vi.fn(() => vi.fn()),
    getClaudeSessionInfo: vi.fn().mockResolvedValue(null),
    detectPullRequest: vi.fn().mockResolvedValue(null),
    onSuperAgentDetailsUpdate: vi.fn(() => vi.fn()),
    saveUIState: vi.fn().mockResolvedValue(undefined),
    loadUIState: vi.fn().mockResolvedValue(null),
    stopAllPRPolling: vi.fn().mockResolvedValue(undefined),
    startPRPolling: vi.fn().mockResolvedValue(undefined),
    onPRStatusUpdate: vi.fn(() => vi.fn()),
    getProjects: vi.fn().mockResolvedValue([]),
    createSuperAssignment: vi.fn().mockResolvedValue({ agentId: 'super-agent-123' }),
    selectProject: vi.fn().mockResolvedValue(null),
  }
})

