import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowService } from '../WorkflowService'
import { WorkflowConfig, WorkflowStep, ParallelGroup, SubagentType } from '../types/WorkflowTypes'
import * as fs from 'fs'
import { join } from 'path'

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/mock/app/path')
  }
}))

// Mock data
const mockSubagentTypes: SubagentType[] = [
  {
    id: 'explore',
    name: 'Explore',
    description: 'Explores codebase',
    defaultPromptTemplate: 'Explore the codebase',
    capabilities: ['read-only']
  },
  {
    id: 'general-purpose',
    name: 'Implementer',
    description: 'Implements features',
    defaultPromptTemplate: 'Implement the feature',
    capabilities: ['file-edit', 'test-execution']
  }
]

const mockDefaultWorkflow: WorkflowConfig = {
  id: 'default-super-minion',
  name: 'Default Workflow',
  description: 'The default workflow for super minions',
  items: [
    {
      id: 'step-1',
      type: 'step',
      name: 'Explore',
      subagentTypeId: 'explore',
      enabled: true
    } as WorkflowStep
  ],
  version: 1,
  createdAt: '2026-01-13T00:00:00.000Z',
  updatedAt: '2026-01-13T00:00:00.000Z'
}

describe('WorkflowService', () => {
  let workflowService: WorkflowService

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mocks for system config files
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) {
        return true
      }
      return false
    })

    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.includes('subagent-types.json')) {
        return JSON.stringify({
          version: 1,
          subagentTypes: mockSubagentTypes
        })
      }
      if (path.includes('default-workflow.json')) {
        return JSON.stringify(mockDefaultWorkflow)
      }
      return ''
    })

    workflowService = new WorkflowService()
  })

  describe('loadSystemConfig', () => {
    it('loads default subagent types from bundled config', () => {
      const config = workflowService.getSystemConfig()

      expect(config.subagentTypes).toHaveLength(2)
      expect(config.subagentTypes[0].id).toBe('explore')
      expect(config.subagentTypes[1].id).toBe('general-purpose')
    })

    it('handles missing config file gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(() => {
        new WorkflowService()
      }).toThrow('System config not found')
    })

    it('caches loaded config for subsequent calls', () => {
      // First call
      const config1 = workflowService.getSystemConfig()
      // Second call
      const config2 = workflowService.getSystemConfig()

      // Should return the same cached instance
      expect(config1).toBe(config2)
      // readFileSync should only be called during construction (once per file)
      expect(fs.readFileSync).toHaveBeenCalledTimes(2) // subagent-types.json + default-workflow.json
    })

    it('loads default workflow and marks it as template', () => {
      const config = workflowService.getSystemConfig()

      expect(config.workflows).toHaveLength(1)
      expect(config.workflows[0].id).toBe('default-super-minion')
      expect(config.workflows[0].isTemplate).toBe(true)
      expect(config.defaultWorkflowId).toBe('default-super-minion')
    })

    it('throws error when default workflow file is missing', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('subagent-types.json')) return true
        return false
      })

      expect(() => {
        new WorkflowService()
      }).toThrow('Default workflow not found')
    })
  })

  describe('getSubagentTypes', () => {
    it('returns all available subagent types', () => {
      const types = workflowService.getSubagentTypes()

      expect(types).toHaveLength(2)
      expect(types.map(t => t.id)).toEqual(['explore', 'general-purpose'])
    })
  })

  describe('getSubagentType', () => {
    it('returns specific subagent type by ID', () => {
      const type = workflowService.getSubagentType('explore')

      expect(type).toBeDefined()
      expect(type?.name).toBe('Explore')
    })

    it('returns undefined for unknown ID', () => {
      const type = workflowService.getSubagentType('nonexistent')

      expect(type).toBeUndefined()
    })
  })

  describe('getProjectWorkflow', () => {
    it('returns project-specific workflow when exists', () => {
      const projectPath = '/path/to/project'
      const customConfig = {
        activeWorkflowId: 'custom-workflow',
        customWorkflows: [
          {
            id: 'custom-workflow',
            name: 'Custom',
            items: [],
            version: 1,
            createdAt: '2026-01-13T00:00:00.000Z',
            updatedAt: '2026-01-13T00:00:00.000Z'
          }
        ]
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify(customConfig)
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      const config = workflowService.getProjectWorkflow(projectPath)

      expect(config.activeWorkflowId).toBe('custom-workflow')
      expect(config.customWorkflows).toHaveLength(1)
    })

    it('falls back to default workflow when none configured', () => {
      const projectPath = '/path/to/new-project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return false
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      const config = workflowService.getProjectWorkflow(projectPath)

      expect(config.activeWorkflowId).toBe('default-super-minion')
      expect(config.customWorkflows).toEqual([])
    })

    it('handles corrupted project config gracefully', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return '{ invalid json }'
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      // Should fall back to default config instead of throwing
      const config = workflowService.getProjectWorkflow(projectPath)

      expect(config.activeWorkflowId).toBe('default-super-minion')
      expect(config.customWorkflows).toEqual([])
    })
  })

  describe('saveProjectWorkflow', () => {
    it('creates workflow-config.json if not exists', () => {
      const projectPath = '/path/to/project'
      const config = {
        activeWorkflowId: 'default-super-minion',
        customWorkflows: []
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join(projectPath, 'minions')) return false
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      workflowService.saveProjectWorkflow(projectPath, config)

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        join(projectPath, 'minions'),
        { recursive: true }
      )
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        join(projectPath, 'minions', 'workflow-config.json'),
        expect.any(String)
      )
    })

    it('preserves other project settings when saving', () => {
      const projectPath = '/path/to/project'
      const config = {
        activeWorkflowId: 'test-workflow',
        customWorkflows: [
          {
            id: 'test-workflow',
            name: 'Test',
            items: [],
            version: 1,
            createdAt: '2026-01-13T00:00:00.000Z',
            updatedAt: '2026-01-13T00:00:00.000Z'
          }
        ],
        overrides: {
          explore: { description: 'Custom description' }
        }
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path === join(projectPath, 'minions')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      workflowService.saveProjectWorkflow(projectPath, config)

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      const parsedConfig = JSON.parse(writtenContent)

      expect(parsedConfig.activeWorkflowId).toBe('test-workflow')
      expect(parsedConfig.customWorkflows).toHaveLength(1)
      expect(parsedConfig.overrides).toBeDefined()
      expect(parsedConfig.overrides.explore.description).toBe('Custom description')
    })
  })

  describe('getActiveWorkflow', () => {
    it('returns active workflow from project custom workflows', () => {
      const projectPath = '/path/to/project'
      const customWorkflow: WorkflowConfig = {
        id: 'custom-workflow',
        name: 'Custom',
        items: [],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'custom-workflow',
            customWorkflows: [customWorkflow]
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      const workflow = workflowService.getActiveWorkflow(projectPath)

      expect(workflow.id).toBe('custom-workflow')
    })

    it('falls back to system workflow when custom not found', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'default-super-minion',
            customWorkflows: []
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      const workflow = workflowService.getActiveWorkflow(projectPath)

      expect(workflow.id).toBe('default-super-minion')
    })

    it('falls back to default workflow when activeWorkflowId references non-existent workflow', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'nonexistent-workflow', // References a workflow that doesn't exist
            customWorkflows: []
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      const workflow = workflowService.getActiveWorkflow(projectPath)

      // Should fall back to the default workflow
      expect(workflow.id).toBe('default-super-minion')
    })
  })

  describe('setActiveWorkflow', () => {
    it('validates workflow exists before setting', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path === join(projectPath, 'minions')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'default-super-minion',
            customWorkflows: []
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      expect(() => {
        workflowService.setActiveWorkflow(projectPath, 'nonexistent')
      }).toThrow('Workflow not found: nonexistent')
    })

    it('sets active workflow and persists', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path === join(projectPath, 'minions')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'old-workflow',
            customWorkflows: []
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      workflowService.setActiveWorkflow(projectPath, 'default-super-minion')

      expect(fs.writeFileSync).toHaveBeenCalled()
      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      const parsedConfig = JSON.parse(writtenContent)
      expect(parsedConfig.activeWorkflowId).toBe('default-super-minion')
    })
  })

  describe('createWorkflow', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return false
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })
    })

    it('generates unique ID for new workflow', () => {
      const projectPath = '/path/to/project'

      const workflow1 = workflowService.createWorkflow(projectPath, {
        name: 'Workflow 1',
        items: []
      })

      const workflow2 = workflowService.createWorkflow(projectPath, {
        name: 'Workflow 2',
        items: []
      })

      expect(workflow1.id).toMatch(/^custom-\d+-[a-z0-9]+$/)
      expect(workflow2.id).toMatch(/^custom-\d+-[a-z0-9]+$/)
      expect(workflow1.id).not.toBe(workflow2.id)
    })

    it('sets timestamps on creation', () => {
      const projectPath = '/path/to/project'
      const before = new Date().toISOString()

      const workflow = workflowService.createWorkflow(projectPath, {
        name: 'Test Workflow',
        items: []
      })

      const after = new Date().toISOString()

      expect(workflow.createdAt).toBeDefined()
      expect(workflow.updatedAt).toBeDefined()
      expect(workflow.createdAt >= before).toBe(true)
      expect(workflow.createdAt <= after).toBe(true)
      expect(workflow.createdAt).toBe(workflow.updatedAt)
    })

    it('adds to project custom workflows', () => {
      const projectPath = '/path/to/project'

      workflowService.createWorkflow(projectPath, {
        name: 'Test Workflow',
        items: []
      })

      expect(fs.writeFileSync).toHaveBeenCalled()
      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      const parsedConfig = JSON.parse(writtenContent)

      expect(parsedConfig.customWorkflows).toHaveLength(1)
      expect(parsedConfig.customWorkflows[0].name).toBe('Test Workflow')
    })

    it('sets version to 1 for new workflows', () => {
      const projectPath = '/path/to/project'

      const workflow = workflowService.createWorkflow(projectPath, {
        name: 'Test Workflow',
        items: []
      })

      expect(workflow.version).toBe(1)
    })

    it('sets isDefault and isTemplate to false for custom workflows', () => {
      const projectPath = '/path/to/project'

      const workflow = workflowService.createWorkflow(projectPath, {
        name: 'Test Workflow',
        items: []
      })

      expect(workflow.isDefault).toBe(false)
      expect(workflow.isTemplate).toBe(false)
    })
  })

  describe('updateWorkflow', () => {
    const projectPath = '/path/to/project'
    const existingWorkflow: WorkflowConfig = {
      id: 'custom-123',
      name: 'Original',
      items: [],
      version: 1,
      createdAt: '2026-01-13T00:00:00.000Z',
      updatedAt: '2026-01-13T00:00:00.000Z'
    }

    beforeEach(() => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path === join(projectPath, 'minions')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'custom-123',
            customWorkflows: [existingWorkflow]
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })
    })

    it('updates existing workflow', () => {
      const updated = workflowService.updateWorkflow(
        projectPath,
        'custom-123',
        { name: 'Updated Name' }
      )

      expect(updated.name).toBe('Updated Name')
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    it('throws error for non-existent workflow', () => {
      expect(() => {
        workflowService.updateWorkflow(projectPath, 'nonexistent', { name: 'Test' })
      }).toThrow('Workflow not found: nonexistent')
    })

    it('updates updatedAt timestamp', () => {
      const before = new Date().toISOString()

      const updated = workflowService.updateWorkflow(
        projectPath,
        'custom-123',
        { name: 'Updated' }
      )

      expect(updated.updatedAt >= before).toBe(true)
      expect(updated.updatedAt).not.toBe(existingWorkflow.updatedAt)
    })

    it('increments version number', () => {
      const updated = workflowService.updateWorkflow(
        projectPath,
        'custom-123',
        { name: 'Updated' }
      )

      expect(updated.version).toBe(2)
    })

    it('prevents updating system workflows', () => {
      expect(() => {
        workflowService.updateWorkflow(
          projectPath,
          'default-super-minion',
          { name: 'Hacked' }
        )
      }).toThrow('Cannot update system/template workflows')
    })

    it('supports optimistic locking with expectedVersion', () => {
      // Correct version should succeed
      expect(() => {
        workflowService.updateWorkflow(
          projectPath,
          'custom-123',
          { name: 'Updated' },
          1 // correct expected version
        )
      }).not.toThrow()
    })

    it('throws error on version mismatch (optimistic locking)', () => {
      expect(() => {
        workflowService.updateWorkflow(
          projectPath,
          'custom-123',
          { name: 'Updated' },
          99 // wrong expected version
        )
      }).toThrow('Workflow was modified by another process')
    })

    it('preserves id and createdAt on update', () => {
      const updated = workflowService.updateWorkflow(
        projectPath,
        'custom-123',
        { name: 'Updated' }
      )

      expect(updated.id).toBe('custom-123')
      expect(updated.createdAt).toBe('2026-01-13T00:00:00.000Z')
    })
  })

  describe('deleteWorkflow', () => {
    const projectPath = '/path/to/project'

    beforeEach(() => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path === join(projectPath, 'minions')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })
    })

    it('removes workflow from custom workflows', () => {
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'default-super-minion',
            customWorkflows: [
              {
                id: 'custom-to-delete',
                name: 'Delete Me',
                items: [],
                version: 1,
                createdAt: '2026-01-13T00:00:00.000Z',
                updatedAt: '2026-01-13T00:00:00.000Z'
              }
            ]
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      workflowService.deleteWorkflow(projectPath, 'custom-to-delete')

      expect(fs.writeFileSync).toHaveBeenCalled()
      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      const parsedConfig = JSON.parse(writtenContent)

      expect(parsedConfig.customWorkflows).toHaveLength(0)
    })

    it('prevents deletion of system workflow', () => {
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'default-super-minion',
            customWorkflows: []
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      expect(() => {
        workflowService.deleteWorkflow(projectPath, 'default-super-minion')
      }).toThrow('Cannot delete system/default workflows')
    })

    it('prevents deletion of default workflow', () => {
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'custom-default',
            customWorkflows: [
              {
                id: 'custom-default',
                name: 'Custom Default',
                items: [],
                version: 1,
                isDefault: true,
                createdAt: '2026-01-13T00:00:00.000Z',
                updatedAt: '2026-01-13T00:00:00.000Z'
              }
            ]
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      expect(() => {
        workflowService.deleteWorkflow(projectPath, 'custom-default')
      }).toThrow('Cannot delete the default workflow')
    })

    it('updates activeWorkflowId if deleted workflow was active', () => {
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'workflow-to-delete',
            customWorkflows: [
              {
                id: 'workflow-to-delete',
                name: 'Delete Me',
                items: [],
                version: 1,
                createdAt: '2026-01-13T00:00:00.000Z',
                updatedAt: '2026-01-13T00:00:00.000Z'
              }
            ]
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      workflowService.deleteWorkflow(projectPath, 'workflow-to-delete')

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      const parsedConfig = JSON.parse(writtenContent)

      expect(parsedConfig.activeWorkflowId).toBe('default-super-minion')
    })

    it('throws error for non-existent workflow', () => {
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'default-super-minion',
            customWorkflows: []
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      expect(() => {
        workflowService.deleteWorkflow(projectPath, 'nonexistent')
      }).toThrow('Workflow not found: nonexistent')
    })
  })

  describe('generateRulesMarkdown', () => {
    it('generates valid markdown from workflow config', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test Workflow',
        description: 'A test workflow',
        items: [
          {
            id: 'step-1',
            type: 'step',
            name: 'Explore Phase',
            subagentTypeId: 'explore',
            enabled: true
          } as WorkflowStep
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('# Super Minion Workflow: Test Workflow')
      expect(markdown).toContain('> A test workflow')
      expect(markdown).toContain('## Workflow Overview')
      expect(markdown).toContain('Phase 1: Explore Phase')
    })

    it('respects step order', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [
          {
            id: 'step-1',
            type: 'step',
            name: 'First',
            subagentTypeId: 'explore',
            enabled: true
          } as WorkflowStep,
          {
            id: 'step-2',
            type: 'step',
            name: 'Second',
            subagentTypeId: 'general-purpose',
            enabled: true
          } as WorkflowStep
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      const firstIndex = markdown.indexOf('Phase 1: First')
      const secondIndex = markdown.indexOf('Phase 2: Second')

      expect(firstIndex).toBeLessThan(secondIndex)
    })

    it('handles parallel steps correctly', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [
          {
            id: 'parallel-1',
            type: 'parallel',
            steps: [
              {
                id: 'step-1a',
                type: 'step',
                name: 'Parallel A',
                subagentTypeId: 'explore',
                enabled: true
              } as WorkflowStep,
              {
                id: 'step-1b',
                type: 'step',
                name: 'Parallel B',
                subagentTypeId: 'general-purpose',
                enabled: true
              } as WorkflowStep
            ]
          } as ParallelGroup
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('Parallel Execution Group')
      expect(markdown).toContain('Parallel (2 concurrent tasks)')
      expect(markdown).toContain('simultaneously')
      expect(markdown).toContain('1a. Parallel A')
      expect(markdown).toContain('1b. Parallel B')
      expect(markdown).toContain('Synchronization')
    })

    it('skips disabled steps', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [
          {
            id: 'step-1',
            type: 'step',
            name: 'Enabled',
            subagentTypeId: 'explore',
            enabled: true
          } as WorkflowStep,
          {
            id: 'step-2',
            type: 'step',
            name: 'Disabled',
            subagentTypeId: 'general-purpose',
            enabled: false
          } as WorkflowStep
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('Enabled')
      expect(markdown).not.toContain('Disabled')
    })

    it('includes subagent type reference section', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('## Subagent Type Reference')
      expect(markdown).toContain('### Explore (explore)')
      expect(markdown).toContain('### Implementer (general-purpose)')
      expect(markdown).toContain('**Capabilities**: read-only')
    })

    it('includes prompt instructions from subagent type', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [
          {
            id: 'step-1',
            type: 'step',
            name: 'Test Step',
            subagentTypeId: 'explore',
            enabled: true
          } as WorkflowStep
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('**Instructions**')
      expect(markdown).toContain('Explore the codebase')
    })

    it('uses promptOverride when provided', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [
          {
            id: 'step-1',
            type: 'step',
            name: 'Test Step',
            subagentTypeId: 'explore',
            promptOverride: 'Custom prompt override',
            enabled: true
          } as WorkflowStep
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('Custom prompt override')
      expect(markdown).not.toContain('Explore the codebase')
    })

    it('includes step configuration when present', () => {
      const workflow: WorkflowConfig = {
        id: 'test-workflow',
        name: 'Test',
        items: [
          {
            id: 'step-1',
            type: 'step',
            name: 'Test Step',
            subagentTypeId: 'explore',
            enabled: true,
            config: {
              timeout: 30000,
              retryOnFailure: true,
              continueOnFailure: true
            }
          } as WorkflowStep
        ],
        version: 1,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z'
      }

      const markdown = workflowService.generateRulesMarkdown(workflow)

      expect(markdown).toContain('**Configuration**')
      expect(markdown).toContain('Timeout: 30000ms')
      expect(markdown).toContain('Retry on failure: Yes')
      expect(markdown).toContain('Continue on failure: Yes')
    })
  })

  describe('Locking', () => {
    describe('lockWorkflow', () => {
      it('locks workflow for agent', () => {
        const projectPath = '/path/to/project'
        const agentId = 'agent-123'

        const result = workflowService.lockWorkflow(projectPath, agentId)

        expect(result).toBe(true)
        const lockStatus = workflowService.isWorkflowLocked(projectPath)
        expect(lockStatus.locked).toBe(true)
        expect(lockStatus.lockedBy).toBe(agentId)
      })

      it('returns false if already locked by different agent', () => {
        const projectPath = '/path/to/project'

        workflowService.lockWorkflow(projectPath, 'agent-1')
        const result = workflowService.lockWorkflow(projectPath, 'agent-2')

        expect(result).toBe(false)
      })

      it('returns true if already locked by same agent (re-lock)', () => {
        const projectPath = '/path/to/project'
        const agentId = 'agent-123'

        workflowService.lockWorkflow(projectPath, agentId)
        const result = workflowService.lockWorkflow(projectPath, agentId)

        expect(result).toBe(true)
      })

      it('updates lockedAt timestamp on re-lock', () => {
        const projectPath = '/path/to/project'
        const agentId = 'agent-123'

        // Use fake timers for this test
        vi.useFakeTimers()
        const initialTime = new Date('2026-01-13T10:00:00.000Z')
        vi.setSystemTime(initialTime)

        workflowService.lockWorkflow(projectPath, agentId)
        const firstLock = workflowService.isWorkflowLocked(projectPath).lockedAt

        // Advance time and re-lock
        vi.advanceTimersByTime(60000) // 1 minute later
        workflowService.lockWorkflow(projectPath, agentId)
        const secondLock = workflowService.isWorkflowLocked(projectPath).lockedAt

        // Both should be defined (re-lock should update timestamp)
        expect(firstLock).toBeDefined()
        expect(secondLock).toBeDefined()
        expect(secondLock).not.toBe(firstLock)

        // Restore real timers
        vi.useRealTimers()
      })
    })

    describe('unlockWorkflow', () => {
      it('unlocks workflow locked by same agent', () => {
        const projectPath = '/path/to/project'
        const agentId = 'agent-123'

        workflowService.lockWorkflow(projectPath, agentId)
        const result = workflowService.unlockWorkflow(projectPath, agentId)

        expect(result).toBe(true)
        expect(workflowService.isWorkflowLocked(projectPath).locked).toBe(false)
      })

      it('returns false for different agent', () => {
        const projectPath = '/path/to/project'

        workflowService.lockWorkflow(projectPath, 'agent-1')
        const result = workflowService.unlockWorkflow(projectPath, 'agent-2')

        expect(result).toBe(false)
        expect(workflowService.isWorkflowLocked(projectPath).locked).toBe(true)
      })

      it('returns false when no lock exists', () => {
        const projectPath = '/path/to/project'

        const result = workflowService.unlockWorkflow(projectPath, 'agent-123')

        expect(result).toBe(false)
      })
    })

    describe('isWorkflowLocked', () => {
      it('returns locked status and details', () => {
        const projectPath = '/path/to/project'
        const agentId = 'agent-123'

        workflowService.lockWorkflow(projectPath, agentId)
        const status = workflowService.isWorkflowLocked(projectPath)

        expect(status.locked).toBe(true)
        expect(status.lockedBy).toBe(agentId)
        expect(status.lockedAt).toBeDefined()
      })

      it('returns unlocked when no lock', () => {
        const projectPath = '/path/to/project'

        const status = workflowService.isWorkflowLocked(projectPath)

        expect(status.locked).toBe(false)
        expect(status.lockedBy).toBeUndefined()
        expect(status.lockedAt).toBeUndefined()
      })
    })

    describe('forceUnlockWorkflow', () => {
      it('force unlocks workflow regardless of owner', () => {
        const projectPath = '/path/to/project'

        workflowService.lockWorkflow(projectPath, 'agent-123')
        workflowService.forceUnlockWorkflow(projectPath)

        expect(workflowService.isWorkflowLocked(projectPath).locked).toBe(false)
      })

      it('succeeds even when no lock exists', () => {
        const projectPath = '/path/to/project'

        expect(() => {
          workflowService.forceUnlockWorkflow(projectPath)
        }).not.toThrow()
      })
    })
  })

  describe('Template Management', () => {
    describe('getTemplates', () => {
      it('returns default workflow as template', () => {
        const templates = workflowService.getTemplates()

        expect(templates).toHaveLength(1)
        expect(templates[0].id).toBe('default-super-minion')
        expect(templates[0].isTemplate).toBe(true)
      })
    })

    describe('saveAsTemplate', () => {
      it('saves workflow as reusable template', () => {
        const workflow: WorkflowConfig = {
          id: 'custom-123',
          name: 'Original',
          items: [],
          version: 1,
          createdAt: '2026-01-13T00:00:00.000Z',
          updatedAt: '2026-01-13T00:00:00.000Z'
        }

        const template = workflowService.saveAsTemplate(workflow, 'My Template')

        expect(template.id).toMatch(/^template-/)
        expect(template.name).toBe('My Template')
        expect(template.isTemplate).toBe(true)
        expect(template.isDefault).toBe(false)
      })

      it('adds template to available templates', () => {
        const workflow: WorkflowConfig = {
          id: 'custom-123',
          name: 'Original',
          items: [],
          version: 1,
          createdAt: '2026-01-13T00:00:00.000Z',
          updatedAt: '2026-01-13T00:00:00.000Z'
        }

        workflowService.saveAsTemplate(workflow, 'My Template')
        const templates = workflowService.getTemplates()

        expect(templates).toHaveLength(2)
        expect(templates[1].name).toBe('My Template')
      })
    })

    describe('createFromTemplate', () => {
      it('creates workflow from template', () => {
        const projectPath = '/path/to/project'

        vi.mocked(fs.existsSync).mockImplementation((path: any) => {
          if (path.includes('workflow-config.json')) return false
          if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
          return false
        })

        const workflow = workflowService.createFromTemplate(
          projectPath,
          'default-super-minion',
          'My Custom Workflow'
        )

        expect(workflow.name).toBe('My Custom Workflow')
        expect(workflow.id).toMatch(/^custom-/)
        expect(workflow.isTemplate).toBe(false)
      })

      it('uses default name when none provided', () => {
        const projectPath = '/path/to/project'

        vi.mocked(fs.existsSync).mockImplementation((path: any) => {
          if (path.includes('workflow-config.json')) return false
          if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
          return false
        })

        const workflow = workflowService.createFromTemplate(
          projectPath,
          'default-super-minion'
        )

        expect(workflow.name).toBe('Default Workflow (Copy)')
      })

      it('throws error for non-existent template', () => {
        const projectPath = '/path/to/project'

        expect(() => {
          workflowService.createFromTemplate(projectPath, 'nonexistent')
        }).toThrow('Template not found: nonexistent')
      })

      it('deep clones template items', () => {
        const projectPath = '/path/to/project'

        vi.mocked(fs.existsSync).mockImplementation((path: any) => {
          if (path.includes('workflow-config.json')) return false
          if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
          return false
        })

        const workflow = workflowService.createFromTemplate(
          projectPath,
          'default-super-minion'
        )

        // Modify the new workflow items
        if (workflow.items.length > 0) {
          (workflow.items[0] as WorkflowStep).name = 'Modified'
        }

        // Original template should be unchanged
        const templates = workflowService.getTemplates()
        const originalTemplate = templates.find(t => t.id === 'default-super-minion')
        expect(originalTemplate?.items[0] && 'name' in originalTemplate.items[0]
          ? (originalTemplate.items[0] as WorkflowStep).name
          : undefined
        ).toBe('Explore')
      })
    })
  })

  describe('getAllWorkflows', () => {
    it('returns combined system and custom workflows', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) return true
        if (path.includes('subagent-types.json') || path.includes('default-workflow.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.includes('workflow-config.json')) {
          return JSON.stringify({
            activeWorkflowId: 'custom-1',
            customWorkflows: [
              {
                id: 'custom-1',
                name: 'Custom Workflow',
                items: [],
                version: 1,
                createdAt: '2026-01-13T00:00:00.000Z',
                updatedAt: '2026-01-13T00:00:00.000Z'
              }
            ]
          })
        }
        if (path.includes('subagent-types.json')) {
          return JSON.stringify({ version: 1, subagentTypes: mockSubagentTypes })
        }
        if (path.includes('default-workflow.json')) {
          return JSON.stringify(mockDefaultWorkflow)
        }
        return ''
      })

      const workflows = workflowService.getAllWorkflows(projectPath)

      expect(workflows).toHaveLength(2)
      expect(workflows.map(w => w.id)).toContain('default-super-minion')
      expect(workflows.map(w => w.id)).toContain('custom-1')
    })
  })
})
