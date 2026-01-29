import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProjectConfigHelper } from '../ProjectConfigHelper'

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
  existsSync: vi.fn()
}))

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { app } from 'electron'

const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockExistsSync = vi.mocked(existsSync)

describe('ProjectConfigHelper', () => {
  let helper: ProjectConfigHelper

  beforeEach(() => {
    vi.clearAllMocks()
    helper = new ProjectConfigHelper()
  })

  describe('getMinionsPath', () => {
    it('should return dev path when app is not packaged', () => {
      const result = helper.getMinionsPath()
      expect(result).toBe('/app/resources/minions')
    })

    it('should return packaged path when app is packaged', () => {
      // Override isPackaged and resourcesPath
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
      const origResourcesPath = process.resourcesPath
      Object.defineProperty(process, 'resourcesPath', { value: '/packaged/resources', configurable: true, writable: true })
      const result = helper.getMinionsPath()
      expect(result).toBe('/packaged/resources/minions')
      // Reset
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
      Object.defineProperty(process, 'resourcesPath', { value: origResourcesPath, configurable: true, writable: true })
    })
  })

  describe('getProjectConfigPath', () => {
    it('should return minions.json path when it exists (new format)', () => {
      mockExistsSync.mockReturnValue(true)
      const result = helper.getProjectConfigPath('/projects/myrepo')
      expect(result).toBe('/projects/myrepo/minions.json')
    })

    it('should return legacy config.json path when minions.json does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      const result = helper.getProjectConfigPath('/projects/myrepo')
      expect(result).toBe('/projects/myrepo/minions/config.json')
    })
  })

  describe('isNewFormatProject', () => {
    it('should return true when minions.json exists', () => {
      mockExistsSync.mockReturnValue(true)
      expect(helper.isNewFormatProject('/projects/myrepo')).toBe(true)
    })

    it('should return false when minions.json does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      expect(helper.isNewFormatProject('/projects/myrepo')).toBe(false)
    })
  })

  describe('getProjectName', () => {
    it('should return name from project config when available', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: 'my-project', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))
      expect(helper.getProjectName('/projects/myrepo')).toBe('my-project')
    })

    it('should fallback to directory name when config has no project name', () => {
      // getProjectName calls getProjectConfig, which returns default config with name 'unknown'
      // Since 'unknown' is truthy, getProjectName returns it.
      // To test the fallback, we need config with falsy project name
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: '', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))
      expect(helper.getProjectName('/projects/myrepo')).toBe('myrepo')
    })

    it('should fallback to "project" when path ends with separator', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: '', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))
      // path.split('/').pop() on '/' returns '' which is falsy
      expect(helper.getProjectName('/')).toBe('project')
    })
  })

  describe('getProjectConfig', () => {
    it('should return parsed config when file exists', () => {
      const config = {
        project: { name: 'test', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(config))

      const result = helper.getProjectConfig('/projects/myrepo')
      expect(result).toEqual(config)
    })

    it('should return default config when file does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      const result = helper.getProjectConfig('/projects/myrepo')
      expect(result.project.name).toBe('unknown')
      expect(result.project.defaultBaseBranch).toBe('main')
      expect(result.assignments).toEqual([])
    })

    it('should return default config when JSON parsing fails', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('not valid json {{{')

      const result = helper.getProjectConfig('/projects/myrepo')
      expect(result.project.name).toBe('unknown')
    })
  })

  describe('saveProjectConfig', () => {
    it('should write formatted JSON to config path', () => {
      mockExistsSync.mockReturnValue(true) // minions.json exists

      const config = {
        project: { name: 'test', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }

      helper.saveProjectConfig('/projects/myrepo', config)
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/projects/myrepo/minions.json',
        JSON.stringify(config, null, 2)
      )
    })
  })

  describe('getWorktreePath', () => {
    it('should return path with project prefix when agentId does not have it', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))

      const result = helper.getWorktreePath('/projects/myrepo', 'agent-1')
      expect(result).toBe('/projects/myrepo-agent-1')
    })

    it('should not double-prefix when agentId already starts with project name', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))

      const result = helper.getWorktreePath('/projects/myrepo', 'myrepo-agent-1')
      expect(result).toBe('/projects/myrepo-agent-1')
    })
  })

  describe('getAgentPath', () => {
    it('should return project path when agent is base branch agent', () => {
      const result = helper.getAgentPath('/projects/myrepo', {
        agentId: 'agent-1',
        isBaseBranchAgent: true
      })
      expect(result).toBe('/projects/myrepo')
    })

    it('should return worktree path with project prefix for regular agent', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))

      const result = helper.getAgentPath('/projects/myrepo', { agentId: 'agent-1' })
      expect(result).toBe('/projects/myrepo-agent-1')
    })

    it('should not double-prefix agentId that already has project name', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: { name: 'myrepo', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      }))

      const result = helper.getAgentPath('/projects/myrepo', { agentId: 'myrepo-agent-1' })
      expect(result).toBe('/projects/myrepo-agent-1')
    })
  })

})
