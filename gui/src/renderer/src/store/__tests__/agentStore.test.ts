import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from '../agentStore'

// Mock window.electronAPI
const mockUnsubscribeAgentList = vi.fn()
const mockUnsubscribeAssignments = vi.fn()
const mockUnsubscribeStateChanged = vi.fn()

const mockElectronAPI = {
  getActiveProjects: vi.fn(),
  listAgentsForProject: vi.fn(),
  getAssignmentsForProject: vi.fn(),
  onAgentListUpdate: vi.fn(() => mockUnsubscribeAgentList),
  onAssignmentsUpdate: vi.fn(() => mockUnsubscribeAssignments),
  onAgentStateChanged: vi.fn(() => mockUnsubscribeStateChanged),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

describe('agentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the store to its initial state between tests
    useAgentStore.setState({
      activeProjects: [],
      agentsByProject: {},
      assignments: {},
      agentStates: {},
    })
  })

  describe('initialization', () => {
    it('has correct initial state', () => {
      const state = useAgentStore.getState()

      expect(state.activeProjects).toEqual([])
      expect(state.agentsByProject).toEqual({})
      expect(state.assignments).toEqual({})
      expect(state.agentStates).toEqual({})
    })

    it('exposes action methods', () => {
      const state = useAgentStore.getState()

      expect(typeof state.fetchActiveProjects).toBe('function')
      expect(typeof state.fetchAgentsForProject).toBe('function')
      expect(typeof state.fetchAssignments).toBe('function')
      expect(typeof state.subscribeToEvents).toBe('function')
      expect(typeof state.refreshAll).toBe('function')
    })
  })

  describe('fetchActiveProjects', () => {
    it('fetches projects via electronAPI and updates state', async () => {
      const mockProjects = [
        { name: 'project-a', path: '/path/to/project-a' },
        { name: 'project-b', path: '/path/to/project-b' },
      ]
      mockElectronAPI.getActiveProjects.mockResolvedValue(mockProjects)

      await useAgentStore.getState().fetchActiveProjects()

      expect(mockElectronAPI.getActiveProjects).toHaveBeenCalledOnce()
      expect(useAgentStore.getState().activeProjects).toEqual(mockProjects)
    })

    it('handles empty projects list', async () => {
      mockElectronAPI.getActiveProjects.mockResolvedValue([])

      await useAgentStore.getState().fetchActiveProjects()

      expect(useAgentStore.getState().activeProjects).toEqual([])
    })

    it('handles API errors gracefully', async () => {
      mockElectronAPI.getActiveProjects.mockRejectedValue(new Error('IPC failed'))

      // Should not throw
      await expect(
        useAgentStore.getState().fetchActiveProjects()
      ).resolves.not.toThrow()

      // State should remain unchanged
      expect(useAgentStore.getState().activeProjects).toEqual([])
    })
  })

  describe('fetchAgentsForProject', () => {
    it('fetches agents for a given project path and updates agentsByProject', async () => {
      const projectPath = '/path/to/project-a'
      const mockAgents = [
        { id: 'agent-1', name: 'Agent One', status: 'running' },
        { id: 'agent-2', name: 'Agent Two', status: 'stopped' },
      ]
      mockElectronAPI.listAgentsForProject.mockResolvedValue(mockAgents)

      await useAgentStore.getState().fetchAgentsForProject(projectPath)

      expect(mockElectronAPI.listAgentsForProject).toHaveBeenCalledWith(projectPath)
      expect(useAgentStore.getState().agentsByProject[projectPath]).toEqual(mockAgents)
    })

    it('updates only the specified project without affecting others', async () => {
      const pathA = '/path/to/project-a'
      const pathB = '/path/to/project-b'
      const agentsA = [{ id: 'agent-a1' }]
      const agentsB = [{ id: 'agent-b1' }]

      mockElectronAPI.listAgentsForProject
        .mockResolvedValueOnce(agentsA)
        .mockResolvedValueOnce(agentsB)

      await useAgentStore.getState().fetchAgentsForProject(pathA)
      await useAgentStore.getState().fetchAgentsForProject(pathB)

      expect(useAgentStore.getState().agentsByProject[pathA]).toEqual(agentsA)
      expect(useAgentStore.getState().agentsByProject[pathB]).toEqual(agentsB)
    })

    it('handles API errors gracefully', async () => {
      mockElectronAPI.listAgentsForProject.mockRejectedValue(new Error('IPC failed'))

      await expect(
        useAgentStore.getState().fetchAgentsForProject('/path/to/project')
      ).resolves.not.toThrow()

      expect(useAgentStore.getState().agentsByProject).toEqual({})
    })
  })

  describe('fetchAssignments', () => {
    it('fetches assignments for all active projects and updates state', async () => {
      const mockProjects = [
        { name: 'project-a', path: '/path/to/project-a' },
        { name: 'project-b', path: '/path/to/project-b' },
      ]
      const assignmentsA = { assignments: [{ id: 'assign-1', prompt: 'Do task A' }] }
      const assignmentsB = { assignments: [{ id: 'assign-2', prompt: 'Do task B' }] }

      // Set active projects first
      useAgentStore.setState({ activeProjects: mockProjects })

      mockElectronAPI.getAssignmentsForProject
        .mockResolvedValueOnce(assignmentsA)
        .mockResolvedValueOnce(assignmentsB)

      await useAgentStore.getState().fetchAssignments()

      expect(mockElectronAPI.getAssignmentsForProject).toHaveBeenCalledWith('/path/to/project-a')
      expect(mockElectronAPI.getAssignmentsForProject).toHaveBeenCalledWith('/path/to/project-b')
      expect(useAgentStore.getState().assignments['/path/to/project-a']).toEqual(assignmentsA)
      expect(useAgentStore.getState().assignments['/path/to/project-b']).toEqual(assignmentsB)
    })

    it('handles no active projects', async () => {
      useAgentStore.setState({ activeProjects: [] })

      await useAgentStore.getState().fetchAssignments()

      expect(mockElectronAPI.getAssignmentsForProject).not.toHaveBeenCalled()
      expect(useAgentStore.getState().assignments).toEqual({})
    })
  })

  describe('subscribeToEvents', () => {
    it('sets up IPC event listeners and returns unsubscribe function', () => {
      const unsubscribe = useAgentStore.getState().subscribeToEvents()

      expect(mockElectronAPI.onAgentListUpdate).toHaveBeenCalledOnce()
      expect(mockElectronAPI.onAssignmentsUpdate).toHaveBeenCalledOnce()
      expect(mockElectronAPI.onAgentStateChanged).toHaveBeenCalledOnce()

      expect(typeof unsubscribe).toBe('function')
    })

    it('onAgentListUpdate triggers fetchAgentsForProject for all active projects', async () => {
      const mockProjects = [
        { name: 'project-a', path: '/path/to/project-a' },
      ]
      useAgentStore.setState({ activeProjects: mockProjects })
      mockElectronAPI.listAgentsForProject.mockResolvedValue([])

      useAgentStore.getState().subscribeToEvents()

      // Extract the callback passed to onAgentListUpdate and invoke it
      const agentListCallback = mockElectronAPI.onAgentListUpdate.mock.calls[0][0]
      await agentListCallback()

      expect(mockElectronAPI.listAgentsForProject).toHaveBeenCalledWith('/path/to/project-a')
    })

    it('onAssignmentsUpdate triggers fetchAssignments', async () => {
      const mockProjects = [
        { name: 'project-a', path: '/path/to/project-a' },
      ]
      useAgentStore.setState({ activeProjects: mockProjects })
      mockElectronAPI.getAssignmentsForProject.mockResolvedValue({ assignments: [] })

      useAgentStore.getState().subscribeToEvents()

      // Extract the callback passed to onAssignmentsUpdate and invoke it
      const assignmentsCallback = mockElectronAPI.onAssignmentsUpdate.mock.calls[0][0]
      await assignmentsCallback()

      expect(mockElectronAPI.getAssignmentsForProject).toHaveBeenCalled()
    })

    it('onAgentStateChanged updates agentStates map', () => {
      useAgentStore.getState().subscribeToEvents()

      // Extract the callback passed to onAgentStateChanged and invoke it
      const stateChangedCallback = mockElectronAPI.onAgentStateChanged.mock.calls[0][0]
      stateChangedCallback('agent-123', 'working')

      expect(useAgentStore.getState().agentStates['agent-123']).toBe('working')

      // Update to a different state
      stateChangedCallback('agent-123', 'waiting')
      expect(useAgentStore.getState().agentStates['agent-123']).toBe('waiting')

      // Multiple agents tracked independently
      stateChangedCallback('agent-456', 'unknown')
      expect(useAgentStore.getState().agentStates['agent-123']).toBe('waiting')
      expect(useAgentStore.getState().agentStates['agent-456']).toBe('unknown')
    })

    it('unsubscribe function removes all listeners', () => {
      const unsubscribe = useAgentStore.getState().subscribeToEvents()

      unsubscribe()

      expect(mockUnsubscribeAgentList).toHaveBeenCalledOnce()
      expect(mockUnsubscribeAssignments).toHaveBeenCalledOnce()
      expect(mockUnsubscribeStateChanged).toHaveBeenCalledOnce()
    })
  })

  describe('refreshAll', () => {
    it('re-fetches projects, agents for all projects, and assignments', async () => {
      const mockProjects = [
        { name: 'project-a', path: '/path/to/project-a' },
      ]
      mockElectronAPI.getActiveProjects.mockResolvedValue(mockProjects)
      mockElectronAPI.listAgentsForProject.mockResolvedValue([{ id: 'agent-1' }])
      mockElectronAPI.getAssignmentsForProject.mockResolvedValue({ assignments: [] })

      await useAgentStore.getState().refreshAll()

      // Should have fetched projects
      expect(mockElectronAPI.getActiveProjects).toHaveBeenCalledOnce()

      // Should have fetched agents for each project
      expect(mockElectronAPI.listAgentsForProject).toHaveBeenCalledWith('/path/to/project-a')

      // Should have fetched assignments for each project
      expect(mockElectronAPI.getAssignmentsForProject).toHaveBeenCalledWith('/path/to/project-a')

      // State should be fully populated
      expect(useAgentStore.getState().activeProjects).toEqual(mockProjects)
      expect(useAgentStore.getState().agentsByProject['/path/to/project-a']).toEqual([{ id: 'agent-1' }])
      expect(useAgentStore.getState().assignments['/path/to/project-a']).toEqual({ assignments: [] })
    })

    it('handles errors without crashing', async () => {
      mockElectronAPI.getActiveProjects.mockRejectedValue(new Error('Network error'))

      await expect(
        useAgentStore.getState().refreshAll()
      ).resolves.not.toThrow()
    })
  })
})
