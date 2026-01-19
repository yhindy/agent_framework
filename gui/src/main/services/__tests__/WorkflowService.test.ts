import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowService } from '../WorkflowService'
import { DEFAULT_SUBAGENT_TYPES, DEFAULT_WORKFLOW } from '../types/WorkflowTypes'
import type { ClaudeConfigService } from '../ClaudeConfigService'
import type { ImportedSubagentType } from '../types/ClaudeConfigTypes'

describe('WorkflowService', () => {
  let service: WorkflowService

  beforeEach(() => {
    service = new WorkflowService()
  })

  describe('getSubagentTypes', () => {
    it('should return default subagent types', () => {
      const types = service.getSubagentTypes()
      expect(types).toEqual(DEFAULT_SUBAGENT_TYPES)
      expect(types).toHaveLength(8)
      expect(types.map(t => t.id)).toEqual([
        'explore', 'plan', 'review', 'implement', 'test', 'debug', 'document', 'simplify'
      ])
    })
  })

  describe('getSubagentType', () => {
    it('should return a specific subagent type by id', () => {
      const explorer = service.getSubagentType('explore')
      expect(explorer).toBeDefined()
      expect(explorer?.name).toBe('Explorer')
    })

    it('should return undefined for unknown type', () => {
      const unknown = service.getSubagentType('unknown')
      expect(unknown).toBeUndefined()
    })
  })

  describe('getActiveWorkflow', () => {
    it('should return the default workflow', () => {
      const workflow = service.getActiveWorkflow('/some/project')
      expect(workflow).toEqual(DEFAULT_WORKFLOW)
      expect(workflow.steps).toHaveLength(5)
    })
  })

  describe('getAllWorkflows', () => {
    it('should return all workflows including default and debug', () => {
      const workflows = service.getAllWorkflows()
      expect(workflows).toHaveLength(2)
      expect(workflows.map(w => w.id)).toContain('default')
      expect(workflows.map(w => w.id)).toContain('debug-workflow')
    })
  })

  describe('createWorkflow', () => {
    it('should create a new workflow', () => {
      const workflow = service.createWorkflow('Test Workflow', 'A test workflow')
      expect(workflow.name).toBe('Test Workflow')
      expect(workflow.description).toBe('A test workflow')
      expect(workflow.steps).toEqual([])
      expect(workflow.isDefault).toBe(false)
    })

    it('should add new workflow to the list', () => {
      service.createWorkflow('New Workflow')
      const workflows = service.getAllWorkflows()
      expect(workflows).toHaveLength(3) // default + debug + new
    })
  })

  describe('updateWorkflow', () => {
    it('should update a custom workflow', () => {
      const created = service.createWorkflow('Original Name')
      const updated = service.updateWorkflow(created.id, { name: 'Updated Name' })
      expect(updated.name).toBe('Updated Name')
    })

    it('should throw error for non-existent workflow', () => {
      expect(() => service.updateWorkflow('nonexistent', { name: 'Test' }))
        .toThrow('Workflow not found')
    })

    it('should allow modifying default workflow', () => {
      const updated = service.updateWorkflow('default', { name: 'Modified Default' })
      expect(updated.name).toBe('Modified Default')
      expect(updated.id).toBe('default')
      expect(updated.isDefault).toBe(true)
    })

    it('should update workflow with new steps (regression test for saveWorkflowAsTemplate)', () => {
      // Create a workflow and add steps
      const workflow = service.createWorkflow('Test Workflow', 'Original description')
      service.addStep(workflow.id, 'Original Step', ['explore'])

      // Verify initial state
      const initial = service.getWorkflow(workflow.id)
      expect(initial?.steps).toHaveLength(1)
      expect(initial?.steps[0].name).toBe('Original Step')

      // Update with new steps (simulating what saveWorkflowAsTemplate should do)
      const newSteps = [
        { id: 'new-step-1', name: 'New Step 1', agents: [{ id: 'a1', typeId: 'plan' }] },
        { id: 'new-step-2', name: 'New Step 2', agents: [{ id: 'a2', typeId: 'implement' }, { id: 'a3', typeId: 'debug' }] }
      ]

      const updated = service.updateWorkflow(workflow.id, {
        name: 'Updated Workflow',
        description: 'Updated description',
        steps: newSteps
      })

      // Verify the update preserved the ID and updated all fields
      expect(updated.id).toBe(workflow.id)
      expect(updated.name).toBe('Updated Workflow')
      expect(updated.description).toBe('Updated description')
      expect(updated.steps).toHaveLength(2)
      expect(updated.steps[0].name).toBe('New Step 1')
      expect(updated.steps[1].name).toBe('New Step 2')
      expect(updated.steps[1].agents).toHaveLength(2)

      // Verify the workflow count didn't increase (update, not create)
      expect(service.getAllWorkflows()).toHaveLength(3) // default + debug + updated
    })

    it('should preserve existing workflow ID when updating', () => {
      const workflow = service.createWorkflow('Test', 'Description')
      const originalId = workflow.id
      service.addStep(workflow.id, 'Step', ['explore'])

      const updated = service.updateWorkflow(workflow.id, {
        name: 'New Name',
        steps: [{ id: 's1', name: 'New Step', agents: [{ id: 'a1', typeId: 'plan' }] }]
      })

      // ID must be preserved (not regenerated)
      expect(updated.id).toBe(originalId)

      // The workflow should be retrievable by the same ID
      const retrieved = service.getWorkflow(originalId)
      expect(retrieved?.name).toBe('New Name')
      expect(retrieved?.steps[0].name).toBe('New Step')
    })
  })

  describe('deleteWorkflow', () => {
    it('should delete a custom workflow', () => {
      const created = service.createWorkflow('To Delete')
      expect(service.getAllWorkflows()).toHaveLength(3) // default + debug + new

      service.deleteWorkflow(created.id)
      expect(service.getAllWorkflows()).toHaveLength(2) // default + debug
    })

    it('should throw error for non-existent workflow', () => {
      expect(() => service.deleteWorkflow('nonexistent'))
        .toThrow('Workflow not found')
    })

    it('should throw error when trying to delete default workflow', () => {
      expect(() => service.deleteWorkflow('default'))
        .toThrow('Cannot delete the default workflow')
    })
  })

  describe('addStep', () => {
    it('should add a step to a workflow with string agent IDs', () => {
      const workflow = service.createWorkflow('Test')
      const step = service.addStep(workflow.id, 'Planning', ['explore', 'plan'])

      expect(step.name).toBe('Planning')
      expect(step.agents).toHaveLength(2)
      expect(step.agents[0].typeId).toBe('explore')
      expect(step.agents[1].typeId).toBe('plan')

      const updated = service.getWorkflow(workflow.id)
      expect(updated?.steps).toHaveLength(1)
    })

    it('should add a step with StepAgent objects', () => {
      const workflow = service.createWorkflow('Test')
      const step = service.addStep(workflow.id, 'Review', [
        { id: 'a1', typeId: 'review', customPrompt: 'Check code quality' },
        { id: 'a2', typeId: 'review', customPrompt: 'Check requirements' }
      ])

      expect(step.name).toBe('Review')
      expect(step.agents).toHaveLength(2)
      expect(step.agents[0].customPrompt).toBe('Check code quality')
      expect(step.agents[1].customPrompt).toBe('Check requirements')
    })

    it('should throw error for non-existent workflow', () => {
      expect(() => service.addStep('nonexistent', 'Step', ['explore']))
        .toThrow('Workflow not found')
    })
  })

  describe('updateStep', () => {
    it('should update a step in a workflow', () => {
      const workflow = service.createWorkflow('Test')
      const step = service.addStep(workflow.id, 'Original', ['explore'])

      const updated = service.updateStep(workflow.id, step.id, {
        name: 'Updated',
        agents: [
          { id: 'a1', typeId: 'explore' },
          { id: 'a2', typeId: 'implement' }
        ]
      })

      expect(updated.name).toBe('Updated')
      expect(updated.agents).toHaveLength(2)
      expect(updated.agents[0].typeId).toBe('explore')
      expect(updated.agents[1].typeId).toBe('implement')
    })

    it('should throw error for non-existent step', () => {
      const workflow = service.createWorkflow('Test')
      expect(() => service.updateStep(workflow.id, 'nonexistent', { name: 'Test' }))
        .toThrow('Step not found')
    })
  })

  describe('removeStep', () => {
    it('should remove a step from a workflow', () => {
      const workflow = service.createWorkflow('Test')
      const step1 = service.addStep(workflow.id, 'Step 1', ['explore'])
      service.addStep(workflow.id, 'Step 2', ['implement'])

      expect(service.getWorkflow(workflow.id)?.steps).toHaveLength(2)

      service.removeStep(workflow.id, step1.id)
      expect(service.getWorkflow(workflow.id)?.steps).toHaveLength(1)
    })

    it('should throw error for non-existent step', () => {
      const workflow = service.createWorkflow('Test')
      expect(() => service.removeStep(workflow.id, 'nonexistent'))
        .toThrow('Step not found')
    })
  })

  describe('reorderSteps', () => {
    it('should reorder steps in a workflow', () => {
      const workflow = service.createWorkflow('Test')
      const step1 = service.addStep(workflow.id, 'Step 1', ['explore'])
      const step2 = service.addStep(workflow.id, 'Step 2', ['implement'])
      const step3 = service.addStep(workflow.id, 'Step 3', ['debug'])

      service.reorderSteps(workflow.id, [step3.id, step1.id, step2.id])

      const updated = service.getWorkflow(workflow.id)
      expect(updated?.steps[0].name).toBe('Step 3')
      expect(updated?.steps[1].name).toBe('Step 1')
      expect(updated?.steps[2].name).toBe('Step 2')
    })

    it('should throw error for invalid step order', () => {
      const workflow = service.createWorkflow('Test')
      service.addStep(workflow.id, 'Step 1', ['explore'])

      expect(() => service.reorderSteps(workflow.id, ['invalid-id']))
        .toThrow('Invalid step order')
    })
  })

  describe('generateRulesMarkdown', () => {
    it('should generate markdown for a workflow', () => {
      const workflow = service.createWorkflow('Test Workflow', 'A test description')
      service.addStep(workflow.id, 'Explore', ['explore'])
      service.addStep(workflow.id, 'Build', ['implement', 'debug'])

      const updated = service.getWorkflow(workflow.id)!
      const markdown = service.generateRulesMarkdown(updated)

      expect(markdown).toContain('# Workflow: Test Workflow')
      expect(markdown).toContain('> A test description')
      expect(markdown).toContain('### Step 1: Explore')
      expect(markdown).toContain('### Step 2: Build')
      expect(markdown).toContain('**Execution**: Parallel (2 agents)')
    })

    it('should include agent descriptions', () => {
      const workflow = service.createWorkflow('Test')
      service.addStep(workflow.id, 'Step', ['explore'])

      const updated = service.getWorkflow(workflow.id)!
      const markdown = service.generateRulesMarkdown(updated)

      expect(markdown).toContain('Explorer')
      expect(markdown).toContain('## Available Agents')
    })

    it('should use custom prompts when available', () => {
      const workflow = service.createWorkflow('Test')
      service.addStep(workflow.id, 'Review', [
        { id: 'a1', typeId: 'review', customPrompt: 'Focus on security issues' }
      ])

      const updated = service.getWorkflow(workflow.id)!
      const markdown = service.generateRulesMarkdown(updated)

      expect(markdown).toContain('Focus on security issues')
    })
  })

  describe('DEFAULT_WORKFLOW custom prompts', () => {
    it('should have role-specific custom prompts for reviewers', () => {
      const workflow = service.getActiveWorkflow('/any/project')
      const reviewStep = workflow.steps.find(s => s.name === 'Design Review')

      expect(reviewStep).toBeDefined()
      expect(reviewStep?.agents).toHaveLength(2)
      expect(reviewStep?.agents[0].customPrompt).toContain('senior engineer')
      expect(reviewStep?.agents[1].customPrompt).toContain('criteria validator')
    })

    it('should have acceptance criteria checker in validation phase', () => {
      const workflow = service.getActiveWorkflow('/any/project')
      const validateStep = workflow.steps.find(s => s.name === 'Validation')

      expect(validateStep).toBeDefined()
      expect(validateStep?.agents).toHaveLength(4)

      const criteriaChecker = validateStep?.agents.find(a =>
        a.customPrompt?.includes('acceptance criteria checker')
      )
      expect(criteriaChecker).toBeDefined()
      expect(criteriaChecker?.typeId).toBe('review')
    })

    it('should have test runner with custom prompt in validation', () => {
      const workflow = service.getActiveWorkflow('/any/project')
      const validateStep = workflow.steps.find(s => s.name === 'Validation')

      const testAgent = validateStep?.agents.find(a => a.typeId === 'test')
      expect(testAgent).toBeDefined()
      expect(testAgent?.customPrompt).toContain('Run all tests')
    })
  })

  describe('ClaudeConfigService integration', () => {
    const mockImportedAgents: ImportedSubagentType[] = [
      {
        id: 'imported:my-plugin:custom-agent',
        name: 'Custom Agent',
        description: 'A custom agent from a plugin',
        source: {
          type: 'plugin-agent',
          pluginId: 'my-plugin',
          pluginName: 'My Plugin',
          pluginVersion: '1.0.0',
          marketplace: 'community'
        },
        filePath: '/path/to/agent.md',
        promptContent: 'Custom prompt content'
      },
      {
        id: 'imported:my-plugin:skill:my-skill',
        name: 'My Skill',
        description: 'A skill from a plugin',
        source: {
          type: 'plugin-skill',
          pluginId: 'my-plugin',
          pluginName: 'My Plugin',
          pluginVersion: '1.0.0',
          marketplace: 'community'
        },
        filePath: '/path/to/skill/SKILL.md',
        promptContent: 'Skill prompt content'
      }
    ]

    function createMockClaudeConfigService(enabledImports: ImportedSubagentType[] = []): ClaudeConfigService {
      return {
        getEnabledImports: vi.fn().mockReturnValue(enabledImports)
      } as unknown as ClaudeConfigService
    }

    describe('setClaudeConfigService', () => {
      it('should set the ClaudeConfigService instance', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)

        service.setClaudeConfigService(mockService)

        // Verify it's used by checking getImportedSubagentTypes
        const imported = service.getImportedSubagentTypes()
        expect(imported).toHaveLength(2)
      })
    })

    describe('getImportedSubagentTypes', () => {
      it('should return empty array when no ClaudeConfigService is set', () => {
        const imported = service.getImportedSubagentTypes()

        expect(imported).toEqual([])
      })

      it('should return imported agents from ClaudeConfigService', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const imported = service.getImportedSubagentTypes()

        expect(imported).toHaveLength(2)
        expect(imported[0].id).toBe('imported:my-plugin:custom-agent')
        expect(imported[0].name).toBe('Custom Agent')
        expect(imported[0].description).toBe('A custom agent from a plugin')
      })

      it('should map ImportedSubagentType to SubagentType format', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const imported = service.getImportedSubagentTypes()

        // Should only have id, name, description (SubagentType interface)
        expect(imported[0]).toEqual({
          id: 'imported:my-plugin:custom-agent',
          name: 'Custom Agent',
          description: 'A custom agent from a plugin'
        })
      })

      it('should return empty array when ClaudeConfigService has no enabled imports', () => {
        const mockService = createMockClaudeConfigService([])
        service.setClaudeConfigService(mockService)

        const imported = service.getImportedSubagentTypes()

        expect(imported).toEqual([])
      })
    })

    describe('getSubagentTypes with imports', () => {
      it('should combine built-in and imported types', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const types = service.getSubagentTypes()

        // Should have 8 built-in + 2 imported
        expect(types).toHaveLength(10)
      })

      it('should list built-in types first', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const types = service.getSubagentTypes()

        // First 8 should be built-in
        expect(types.slice(0, 8).map(t => t.id)).toEqual([
          'explore', 'plan', 'review', 'implement', 'test', 'debug', 'document', 'simplify'
        ])
        // Last 2 should be imported
        expect(types.slice(8).map(t => t.id)).toEqual([
          'imported:my-plugin:custom-agent',
          'imported:my-plugin:skill:my-skill'
        ])
      })
    })

    describe('getSubagentType with imports', () => {
      it('should find built-in types by ID', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const explorer = service.getSubagentType('explore')

        expect(explorer).toBeDefined()
        expect(explorer?.name).toBe('Explorer')
      })

      it('should find imported types by ID', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const customAgent = service.getSubagentType('imported:my-plugin:custom-agent')

        expect(customAgent).toBeDefined()
        expect(customAgent?.name).toBe('Custom Agent')
      })

      it('should prefer built-in types over imported with same ID', () => {
        // Create an imported agent with same ID as built-in (should never happen in practice)
        const conflictingImport: ImportedSubagentType[] = [
          {
            id: 'explore', // Same as built-in
            name: 'Conflicting Explorer',
            description: 'Should not be returned',
            source: {
              type: 'plugin-agent',
              pluginId: 'conflict',
              pluginName: 'Conflict Plugin',
              pluginVersion: '1.0.0'
            }
          }
        ]
        const mockService = createMockClaudeConfigService(conflictingImport)
        service.setClaudeConfigService(mockService)

        const explorer = service.getSubagentType('explore')

        expect(explorer?.name).toBe('Explorer') // Built-in, not 'Conflicting Explorer'
      })

      it('should return undefined for unknown type', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const unknown = service.getSubagentType('nonexistent')

        expect(unknown).toBeUndefined()
      })
    })

    describe('generateRulesMarkdown with imports', () => {
      it('should include imported agents section when imports exist', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const workflow = service.createWorkflow('Test')
        service.addStep(workflow.id, 'Step', ['explore'])
        const updated = service.getWorkflow(workflow.id)!

        const markdown = service.generateRulesMarkdown(updated)

        expect(markdown).toContain('### Imported Agents')
        expect(markdown).toContain('Custom Agent')
        expect(markdown).toContain('imported:my-plugin:custom-agent')
        expect(markdown).toContain('My Skill')
      })

      it('should not include imported agents section when no imports', () => {
        // No ClaudeConfigService set - no imports

        const workflow = service.createWorkflow('Test')
        service.addStep(workflow.id, 'Step', ['explore'])
        const updated = service.getWorkflow(workflow.id)!

        const markdown = service.generateRulesMarkdown(updated)

        expect(markdown).not.toContain('### Imported Agents')
      })

      it('should use imported agent names in step descriptions', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const workflow = service.createWorkflow('Test')
        service.addStep(workflow.id, 'Custom Step', ['imported:my-plugin:custom-agent'])
        const updated = service.getWorkflow(workflow.id)!

        const markdown = service.generateRulesMarkdown(updated)

        expect(markdown).toContain('**Agent**: Custom Agent')
        expect(markdown).toContain('A custom agent from a plugin')
      })

      it('should handle parallel steps with imported agents', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const workflow = service.createWorkflow('Test')
        service.addStep(workflow.id, 'Parallel Step', [
          'explore',
          'imported:my-plugin:custom-agent'
        ])
        const updated = service.getWorkflow(workflow.id)!

        const markdown = service.generateRulesMarkdown(updated)

        expect(markdown).toContain('**Execution**: Parallel (2 agents)')
        expect(markdown).toContain('**Explorer**')
        expect(markdown).toContain('**Custom Agent**')
      })
    })

    describe('workflow steps with imported agents', () => {
      it('should allow adding steps with imported agent type IDs', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const workflow = service.createWorkflow('Test')
        const step = service.addStep(workflow.id, 'Imported Step', [
          'imported:my-plugin:custom-agent',
          'imported:my-plugin:skill:my-skill'
        ])

        expect(step.agents).toHaveLength(2)
        expect(step.agents[0].typeId).toBe('imported:my-plugin:custom-agent')
        expect(step.agents[1].typeId).toBe('imported:my-plugin:skill:my-skill')
      })

      it('should allow mixing built-in and imported agents in steps', () => {
        const mockService = createMockClaudeConfigService(mockImportedAgents)
        service.setClaudeConfigService(mockService)

        const workflow = service.createWorkflow('Test')
        const step = service.addStep(workflow.id, 'Mixed Step', [
          'explore',
          'imported:my-plugin:custom-agent',
          'implement'
        ])

        expect(step.agents).toHaveLength(3)
        expect(step.agents[0].typeId).toBe('explore')
        expect(step.agents[1].typeId).toBe('imported:my-plugin:custom-agent')
        expect(step.agents[2].typeId).toBe('implement')
      })
    })
  })
})
