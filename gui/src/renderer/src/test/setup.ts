import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Electron API
Object.defineProperty(window, 'electronAPI', {
  value: {
    listAgentsForProject: vi.fn(),
    getAssignmentsForProject: vi.fn(),
    onAgentSignal: vi.fn(() => vi.fn()),
    onAgentListUpdate: vi.fn(() => vi.fn()),
    onTestEnvStarted: vi.fn(() => vi.fn()),
    onTestEnvStopped: vi.fn(() => vi.fn()),
    onTestEnvExited: vi.fn(() => vi.fn()),
    clearUnread: vi.fn(),
    updateAssignment: vi.fn(),
    createAssignmentForProject: vi.fn(),
    stopAgent: vi.fn(),
    openInCursor: vi.fn(),
    teardownAgent: vi.fn(),
    unassignAgent: vi.fn(),
    createPullRequest: vi.fn(),
    checkPullRequestStatus: vi.fn(),
    checkDependencies: vi.fn(),
    getTestEnvConfig: vi.fn(),
    getTestEnvStatus: vi.fn(),
    startTestEnv: vi.fn(),
    stopTestEnv: vi.fn(),
    stopPlainTerminal: vi.fn(),
    onAssignmentsUpdate: vi.fn(() => vi.fn()),
    onAgentWaitingForInput: vi.fn(() => vi.fn()),
    onAgentResumedWork: vi.fn(() => vi.fn()),
  }
})

