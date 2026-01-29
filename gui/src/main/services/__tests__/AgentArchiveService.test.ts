import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentArchiveService, ArchiveAgentOps } from '../AgentArchiveService'
import { AgentInfo, ArchivedAgent } from '../types/ProjectConfig'

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/app')
  }
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn()
}))

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs'

const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockExistsSync = vi.mocked(existsSync)
const mockStatSync = vi.mocked(statSync)
const mockMkdirSync = vi.mocked(mkdirSync)
const mockReaddirSync = vi.mocked(readdirSync)

describe('AgentArchiveService', () => {
  let service: AgentArchiveService
  let mockAgentOps: ArchiveAgentOps

  const makeAgentInfo = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
    id: 'test-id',
    agentId: 'agent-1',
    branch: 'feature/test',
    project: 'myrepo',
    feature: 'Test feature',
    status: 'completed',
    tool: 'claude',
    mode: 'auto',
    createdAt: '2025-01-01T00:00:00Z',
    lastActivity: '2025-01-02T00:00:00Z',
    ...overrides
  })

  const makeArchivedAgent = (overrides: Partial<ArchivedAgent> = {}): ArchivedAgent => ({
    archiveId: 'agent-1-1234567890',
    archivedAt: '2025-01-03T00:00:00Z',
    archiveVersion: 1,
    agentId: 'agent-1',
    assignmentId: 'test-id',
    branch: 'feature/test',
    feature: 'Test feature',
    tool: 'claude',
    mode: 'auto',
    createdAt: '2025-01-01T00:00:00Z',
    completedAt: '2025-01-03T00:00:00Z',
    finalStatus: 'completed',
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mockAgentOps = {
      listAgents: vi.fn().mockResolvedValue([]),
      readAgentInfo: vi.fn(),
      createAssignment: vi.fn()
    }

    service = new AgentArchiveService(mockAgentOps)
  })

  describe('resolveMainProjectPath', () => {
    it('should return project path when .git is a directory', () => {
      mockExistsSync.mockReturnValue(true)
      mockStatSync.mockReturnValue({ isFile: () => false } as any)

      const result = service.resolveMainProjectPath('/projects/myrepo')
      expect(result).toBe('/projects/myrepo')
    })

    it('should resolve worktree .git file to main repo path', () => {
      mockExistsSync.mockReturnValue(true)
      mockStatSync.mockReturnValue({ isFile: () => true } as any)
      mockReadFileSync.mockReturnValue('gitdir: /projects/myrepo/.git/worktrees/myrepo-agent-1')

      const result = service.resolveMainProjectPath('/projects/myrepo-agent-1')
      expect(result).toBe('/projects/myrepo')
    })

    it('should return original path when .git does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      const result = service.resolveMainProjectPath('/projects/myrepo')
      expect(result).toBe('/projects/myrepo')
    })

    it('should return original path when .git file cannot be parsed', () => {
      mockExistsSync.mockReturnValue(true)
      mockStatSync.mockReturnValue({ isFile: () => true } as any)
      mockReadFileSync.mockReturnValue('invalid content')

      const result = service.resolveMainProjectPath('/projects/myrepo-agent-1')
      expect(result).toBe('/projects/myrepo-agent-1')
    })
  })

  describe('getArchiveDirectory', () => {
    it('should return correct archive path', () => {
      mockExistsSync.mockReturnValue(false) // .git does not exist, so resolveMainProjectPath returns as-is
      const result = service.getArchiveDirectory('/projects/myrepo')
      expect(result).toBe('/projects/myrepo/.minions/archive')
    })
  })

  describe('ensureArchiveDirectory', () => {
    it('should create directory when it does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      const result = service.ensureArchiveDirectory('/projects/myrepo')
      expect(result).toBe('/projects/myrepo/.minions/archive')
      expect(mockMkdirSync).toHaveBeenCalledWith('/projects/myrepo/.minions/archive', { recursive: true })
    })

    it('should not create directory when it already exists', () => {
      // First call: resolveMainProjectPath checks .git existence => false (return as-is)
      // Second call: getArchiveDirectory => ensureArchiveDirectory checks archive dir exists => true
      let callCount = 0
      mockExistsSync.mockImplementation(() => {
        callCount++
        // First call is for .git in resolveMainProjectPath, second is for archive dir
        return callCount >= 2
      })
      service.ensureArchiveDirectory('/projects/myrepo')
      expect(mockMkdirSync).not.toHaveBeenCalled()
    })
  })

  describe('archiveAgent', () => {
    it('should archive agent successfully', async () => {
      const agentInfo = makeAgentInfo()
      vi.mocked(mockAgentOps.listAgents).mockResolvedValue([
        { id: 'agent-1', worktreePath: '/projects/myrepo-agent-1' }
      ])
      vi.mocked(mockAgentOps.readAgentInfo).mockReturnValue(agentInfo)
      mockExistsSync.mockReturnValue(false)

      const result = await service.archiveAgent('/projects/myrepo', 'agent-1')

      expect(result.agentId).toBe('agent-1')
      expect(result.feature).toBe('Test feature')
      expect(result.archiveVersion).toBe(1)
      expect(mockWriteFileSync).toHaveBeenCalled()
    })

    it('should throw when agent not found', async () => {
      vi.mocked(mockAgentOps.listAgents).mockResolvedValue([])
      await expect(service.archiveAgent('/projects/myrepo', 'nonexistent'))
        .rejects.toThrow('Agent nonexistent not found for archiving')
    })

    it('should throw when agent info cannot be read', async () => {
      vi.mocked(mockAgentOps.listAgents).mockResolvedValue([
        { id: 'agent-1', worktreePath: '/projects/myrepo-agent-1' }
      ])
      vi.mocked(mockAgentOps.readAgentInfo).mockReturnValue(null)

      await expect(service.archiveAgent('/projects/myrepo', 'agent-1'))
        .rejects.toThrow('Could not read agent info for agent-1')
    })
  })

  describe('listArchivedAgents', () => {
    it('should return empty array when archive directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false)
      const result = await service.listArchivedAgents('/projects/myrepo')
      expect(result).toEqual([])
    })

    it('should return archived agents sorted by date descending', async () => {
      // First existsSync call: resolveMainProjectPath .git => false
      // Second existsSync call: archive dir exists => true
      let callCount = 0
      mockExistsSync.mockImplementation(() => {
        callCount++
        return callCount >= 2
      })

      mockReaddirSync.mockReturnValue(['old.json', 'new.json'] as any)
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes('old.json')) {
          return JSON.stringify(makeArchivedAgent({ archiveId: 'old', archivedAt: '2025-01-01T00:00:00Z' }))
        }
        return JSON.stringify(makeArchivedAgent({ archiveId: 'new', archivedAt: '2025-01-10T00:00:00Z' }))
      })

      const result = await service.listArchivedAgents('/projects/myrepo')
      expect(result).toHaveLength(2)
      expect(result[0].archiveId).toBe('new') // Most recent first
      expect(result[1].archiveId).toBe('old')
    })

    it('should skip files that fail to parse', async () => {
      let callCount = 0
      mockExistsSync.mockImplementation(() => {
        callCount++
        return callCount >= 2
      })

      mockReaddirSync.mockReturnValue(['valid.json', 'corrupt.json'] as any)
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes('corrupt.json')) {
          return 'not valid json'
        }
        return JSON.stringify(makeArchivedAgent({ archiveId: 'valid' }))
      })

      const result = await service.listArchivedAgents('/projects/myrepo')
      expect(result).toHaveLength(1)
      expect(result[0].archiveId).toBe('valid')
    })
  })

  describe('getArchivedAgent', () => {
    it('should return archived agent when file exists', async () => {
      const archived = makeArchivedAgent()
      mockExistsSync.mockReturnValue(false) // .git check returns false for resolveMainProjectPath
      // Override the last existsSync call for the archive file
      mockExistsSync.mockImplementation((p: any) => {
        return String(p).endsWith('.json')
      })
      mockReadFileSync.mockReturnValue(JSON.stringify(archived))

      const result = await service.getArchivedAgent('/projects/myrepo', 'agent-1-1234567890')
      expect(result).toEqual(archived)
    })

    it('should return null when archive file does not exist', async () => {
      mockExistsSync.mockReturnValue(false)
      const result = await service.getArchivedAgent('/projects/myrepo', 'nonexistent')
      expect(result).toBeNull()
    })

    it('should return null when file parse fails', async () => {
      mockExistsSync.mockImplementation((p: any) => String(p).endsWith('.json'))
      mockReadFileSync.mockReturnValue('corrupt json')

      const result = await service.getArchivedAgent('/projects/myrepo', 'test-archive')
      expect(result).toBeNull()
    })
  })

  describe('restoreArchivedAgent', () => {
    it('should restore archived agent as new assignment', async () => {
      const archived = makeArchivedAgent({
        branch: 'feature/old-branch',
        feature: 'Old feature',
        prompt: 'Do something'
      })

      // Mock getArchivedAgent
      mockExistsSync.mockImplementation((p: any) => String(p).endsWith('.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(archived))

      const newAgent = makeAgentInfo({ id: 'new-id', agentId: 'agent-2' })
      vi.mocked(mockAgentOps.createAssignment).mockResolvedValue(newAgent)

      const result = await service.restoreArchivedAgent('/projects/myrepo', 'agent-1-1234567890')

      expect(result).toEqual(newAgent)
      expect(mockAgentOps.createAssignment).toHaveBeenCalledWith(
        '/projects/myrepo',
        expect.objectContaining({
          feature: 'Old feature',
          prompt: 'Do something',
          tool: 'claude',
          mode: 'auto'
        })
      )
      // Verify restored branch has -restored suffix
      const callArgs = vi.mocked(mockAgentOps.createAssignment).mock.calls[0][1]
      expect(callArgs.branch).toContain('old-branch-restored-')
    })

    it('should throw when archive not found', async () => {
      mockExistsSync.mockReturnValue(false)
      await expect(service.restoreArchivedAgent('/projects/myrepo', 'nonexistent'))
        .rejects.toThrow('Archive not found: nonexistent')
    })

    it('should use default prompt when archive has no prompt', async () => {
      const archived = makeArchivedAgent({ prompt: undefined, feature: 'My feature' })

      mockExistsSync.mockImplementation((p: any) => String(p).endsWith('.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(archived))

      const newAgent = makeAgentInfo()
      vi.mocked(mockAgentOps.createAssignment).mockResolvedValue(newAgent)

      await service.restoreArchivedAgent('/projects/myrepo', 'agent-1-1234567890')

      const callArgs = vi.mocked(mockAgentOps.createAssignment).mock.calls[0][1]
      expect(callArgs.prompt).toContain('Restored from archive')
    })
  })
})
