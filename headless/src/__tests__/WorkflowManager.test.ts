import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkflowManager } from '../WorkflowManager'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('WorkflowManager', () => {
  let tmpDir: string
  let storePath: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `test-wm-${Date.now()}-${Math.random().toString(36).substring(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    storePath = join(tmpDir, 'workflows.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should include default and debug workflows', () => {
    const wm = new WorkflowManager(storePath)
    const workflows = wm.getAllWorkflows()

    expect(workflows.length).toBeGreaterThanOrEqual(2)
    expect(wm.getWorkflow('default')).toBeDefined()
    expect(wm.getWorkflow('debug-workflow')).toBeDefined()
  })

  it('should get default workflow', () => {
    const wm = new WorkflowManager(storePath)
    const workflow = wm.getWorkflow('default')

    expect(workflow).toBeDefined()
    expect(workflow!.name).toBe('Standard Workflow')
    expect(workflow!.steps.length).toBe(5)
    expect(workflow!.isDefault).toBe(true)
  })

  it('should get subagent types', () => {
    const wm = new WorkflowManager(storePath)
    const types = wm.getSubagentTypes()

    expect(types.length).toBeGreaterThan(0)
    expect(types.find(t => t.id === 'Explore')).toBeDefined()
    expect(types.find(t => t.id === 'Plan')).toBeDefined()
    expect(types.find(t => t.id === 'general-purpose')).toBeDefined()
  })

  describe('detectWorkflowFromPlan', () => {
    it('should detect debug workflow with 2+ keywords', () => {
      const wm = new WorkflowManager(storePath)

      const result = wm.detectWorkflowFromPlan('Debug the broken authentication')
      expect(result.workflowId).toBe('debug-workflow')
      expect(result.confidence).toBe('high')
    })

    it('should detect default workflow with 0-1 keywords', () => {
      const wm = new WorkflowManager(storePath)

      const result = wm.detectWorkflowFromPlan('Add new user registration feature')
      expect(result.workflowId).toBe('default')
      expect(result.confidence).toBe('high')
    })

    it('should detect default with low confidence for single debug keyword', () => {
      const wm = new WorkflowManager(storePath)

      // Single debug keyword ("crash") = low confidence default
      const result = wm.detectWorkflowFromPlan('The app crash on startup')
      expect(result.workflowId).toBe('default')
      expect(result.confidence).toBe('low')
    })
  })

  it('should create and delete a custom workflow', () => {
    const wm = new WorkflowManager(storePath)

    const workflow = wm.createWorkflow('Custom', 'A custom workflow')
    expect(workflow.id).toBeTruthy()
    expect(workflow.name).toBe('Custom')

    expect(wm.getWorkflow(workflow.id)).toBeDefined()

    wm.deleteWorkflow(workflow.id)
    expect(wm.getWorkflow(workflow.id)).toBeUndefined()
  })

  it('should not delete the default workflow', () => {
    const wm = new WorkflowManager(storePath)
    expect(() => wm.deleteWorkflow('default')).toThrow('Cannot delete the default workflow')
  })

  it('should persist custom workflows', () => {
    const wm1 = new WorkflowManager(storePath)
    const workflow = wm1.createWorkflow('Persistent', 'Test persistence')

    const wm2 = new WorkflowManager(storePath)
    expect(wm2.getWorkflow(workflow.id)).toBeDefined()
    expect(wm2.getWorkflow(workflow.id)!.name).toBe('Persistent')
  })
})
