import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn()
}))

vi.mock('path', async () => {
  const actual = await vi.importActual('path')
  return {
    ...actual,
    join: vi.fn((...args) => args.join('/'))
  }
})

describe('AgentService - restoreArchivedAgent', () => {
  let agentService: AgentService
  const mockProjectPath = '/test/project'
  const mockArchiveId = 'test-agent-1234567890'

  const mockArchivedAgent = {
    archiveId: mockArchiveId,
    archivedAt: '2024-01-12T10:00:00Z',
    archiveVersion: 1,
    agentId: 'test-agent',
    assignmentId: 'test-agent-1234',
    branch: 'feature/user-auth',
    feature: 'user-auth',
    prompt: 'Add user authentication',
    tool: 'claude',
    model: 'opus',
    mode: 'auto',
    createdAt: '2024-01-10T09:00:00Z',
    completedAt: '2024-01-11T14:30:00Z',
    finalStatus: 'completed',
    prUrl: 'https://github.com/test/repo/pull/123',
    prStatus: 'merged'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('restoreArchivedAgent', () => {
    it('should create new assignment with archived agent configuration', async () => {
      // Mock getArchivedAgent to return test data
      const archivePath = `${mockProjectPath}/minions/archive/${mockArchiveId}.json`
      vi.mocked(existsSync).mockImplementation((path) => path === archivePath)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockArchivedAgent))

      // Mock createAssignment
      const mockNewAgent = {
        id: 'new-agent-123456',
        agentId: 'project-abc123',
        branch: 'feature/user-auth-restored-1234567890',
        feature: 'user-auth',
        status: 'active',
        tool: 'claude',
        model: 'opus',
        mode: 'auto'
      }
      const createAssignmentSpy = vi.spyOn(agentService, 'createAssignment').mockResolvedValue(mockNewAgent as any)

      // Call restoreArchivedAgent
      const result = await agentService.restoreArchivedAgent(mockProjectPath, mockArchiveId)

      // Verify createAssignment was called with correct parameters
      expect(createAssignmentSpy).toHaveBeenCalledWith(
        mockProjectPath,
        expect.objectContaining({
          feature: 'user-auth',
          branch: expect.stringMatching(/^user-auth-restored-\d+$/),
          prompt: 'Add user authentication',
          tool: 'claude',
          model: 'opus',
          mode: 'auto'
        })
      )

      // Verify returned agent
      expect(result).toEqual(mockNewAgent)
    })

    it('should generate new branch name with -restored suffix', async () => {
      const archivePath = `${mockProjectPath}/minions/archive/${mockArchiveId}.json`
      vi.mocked(existsSync).mockImplementation((path) => path === archivePath)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockArchivedAgent))

      const createAssignmentSpy = vi.spyOn(agentService, 'createAssignment').mockResolvedValue({} as any)

      await agentService.restoreArchivedAgent(mockProjectPath, mockArchiveId)

      const callArgs = createAssignmentSpy.mock.calls[0][1]
      expect(callArgs.branch).toMatch(/^user-auth-restored-\d+$/)
    })

    it('should throw error if archive not found', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await expect(
        agentService.restoreArchivedAgent(mockProjectPath, mockArchiveId)
      ).rejects.toThrow(`Archive not found: ${mockArchiveId}`)
    })

    it('should handle archived agent without model field', async () => {
      const archivedAgentNoModel = { ...mockArchivedAgent, model: undefined }
      const archivePath = `${mockProjectPath}/minions/archive/${mockArchiveId}.json`
      vi.mocked(existsSync).mockImplementation((path) => path === archivePath)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(archivedAgentNoModel))

      const createAssignmentSpy = vi.spyOn(agentService, 'createAssignment').mockResolvedValue({} as any)

      await agentService.restoreArchivedAgent(mockProjectPath, mockArchiveId)

      const callArgs = createAssignmentSpy.mock.calls[0][1]
      expect(callArgs.model).toBeUndefined()
    })

    it('should handle archived agent without prompt', async () => {
      const archivedAgentNoPrompt = { ...mockArchivedAgent, prompt: undefined }
      const archivePath = `${mockProjectPath}/minions/archive/${mockArchiveId}.json`
      vi.mocked(existsSync).mockImplementation((path) => path === archivePath)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(archivedAgentNoPrompt))

      const createAssignmentSpy = vi.spyOn(agentService, 'createAssignment').mockResolvedValue({} as any)

      await agentService.restoreArchivedAgent(mockProjectPath, mockArchiveId)

      const callArgs = createAssignmentSpy.mock.calls[0][1]
      expect(callArgs.prompt).toMatch(/^Restored from archive:/)
    })

    it('should preserve tool type when restoring', async () => {
      const cursorAgent = { ...mockArchivedAgent, tool: 'cursor-cli' }
      const archivePath = `${mockProjectPath}/minions/archive/${mockArchiveId}.json`
      vi.mocked(existsSync).mockImplementation((path) => path === archivePath)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cursorAgent))

      const createAssignmentSpy = vi.spyOn(agentService, 'createAssignment').mockResolvedValue({} as any)

      await agentService.restoreArchivedAgent(mockProjectPath, mockArchiveId)

      const callArgs = createAssignmentSpy.mock.calls[0][1]
      expect(callArgs.tool).toBe('cursor-cli')
    })
  })
})
