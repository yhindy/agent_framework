import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentService } from '../AgentService'
import * as fs from 'fs'
import * as path from 'path'

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}))

describe('Multi-Repo IPC Handler Helpers', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
    
    // Mock listAgents implementation
    vi.spyOn(agentService, 'listAgents').mockImplementation(async (projectPath: string) => {
      if (projectPath === '/path/to/projectA') {
        return [{ id: 'projectA-abc1' }] as any
      }
      if (projectPath === '/path/to/projectB') {
        return [{ id: 'projectB-xyz2' }] as any
      }
      return []
    })

    // Mock getAssignments implementation
    vi.spyOn(agentService, 'getAssignments').mockImplementation((projectPath: string) => {
      if (projectPath === '/path/to/projectA') {
        return { assignments: [{ id: 'assign-1', agentId: 'projectA-abc1' }] } as any
      }
      if (projectPath === '/path/to/projectB') {
        return { assignments: [{ id: 'assign-2', agentId: 'projectB-xyz2' }] } as any
      }
      return { assignments: [] }
    })
  })

  const activeProjectPaths = ['/path/to/projectA', '/path/to/projectB']

  describe('findProjectForAgent', () => {
    it('returns correct project path when agent exists in first project', async () => {
      const result = await agentService.findProjectForAgent(activeProjectPaths, 'projectA-abc1')
      expect(result).toBe('/path/to/projectA')
    })

    it('returns correct project path when agent exists in second project', async () => {
      const result = await agentService.findProjectForAgent(activeProjectPaths, 'projectB-xyz2')
      expect(result).toBe('/path/to/projectB')
    })

    it('throws error when agent not found in any project', async () => {
      await expect(agentService.findProjectForAgent(activeProjectPaths, 'unknown-agent'))
        .rejects.toThrow('Agent unknown-agent not found in any active project')
    })
  })

  describe('findProjectForAssignment', () => {
    it('returns correct project path when assignment exists in first project', async () => {
      const result = await agentService.findProjectForAssignment(activeProjectPaths, 'assign-1')
      expect(result).toBe('/path/to/projectA')
    })

    it('returns correct project path when assignment exists in second project', async () => {
      const result = await agentService.findProjectForAssignment(activeProjectPaths, 'assign-2')
      expect(result).toBe('/path/to/projectB')
    })

    it('throws error when assignment not found in any project', async () => {
      await expect(agentService.findProjectForAssignment(activeProjectPaths, 'unknown-assign'))
        .rejects.toThrow('Assignment unknown-assign not found in any active project')
    })
  })
})

