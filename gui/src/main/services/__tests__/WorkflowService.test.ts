import { describe, it, expect, beforeEach } from 'vitest'
import { WorkflowService } from '../WorkflowService'
import { DEFAULT_SUBAGENT_TYPES, DEFAULT_WORKFLOW } from '../types/WorkflowTypes'

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
    it('should return all workflows including default', () => {
      const workflows = service.getAllWorkflows()
      expect(workflows).toHaveLength(1)
      expect(workflows[0].id).toBe('default')
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
      expect(workflows).toHaveLength(2)
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

    it('should throw error when trying to modify default workflow', () => {
      expect(() => service.updateWorkflow('default', { name: 'Modified' }))
        .toThrow('Cannot modify the default workflow')
    })
  })

  describe('deleteWorkflow', () => {
    it('should delete a custom workflow', () => {
      const created = service.createWorkflow('To Delete')
      expect(service.getAllWorkflows()).toHaveLength(2)

      service.deleteWorkflow(created.id)
      expect(service.getAllWorkflows()).toHaveLength(1)
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
    it('should add a step to a workflow', () => {
      const workflow = service.createWorkflow('Test')
      const step = service.addStep(workflow.id, 'Planning', ['explore', 'plan'])

      expect(step.name).toBe('Planning')
      expect(step.agents).toEqual(['explore', 'plan'])

      const updated = service.getWorkflow(workflow.id)
      expect(updated?.steps).toHaveLength(1)
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
        agents: ['explore', 'implement']
      })

      expect(updated.name).toBe('Updated')
      expect(updated.agents).toEqual(['explore', 'implement'])
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
  })
})
