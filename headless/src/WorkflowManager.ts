import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger'
import type { WorkflowConfig } from './types'

const log = createLogger('WorkflowManager')

const DEFAULT_WORKFLOW: WorkflowConfig = {
  id: 'default',
  name: 'Standard Workflow',
  description: 'Standard workflow with 5 phases: acceptance criteria, design, review, implement, validate',
  steps: [
    { id: 'step-0', name: 'Acceptance Criteria', agents: [{ id: 'a0', typeId: 'acceptance-criteria' }] },
    { id: 'step-1', name: 'Engineering Design', agents: [{ id: 'a1', typeId: 'Plan' }] },
    {
      id: 'step-2', name: 'Design Review',
      agents: [
        { id: 'a2', typeId: 'general-purpose', customPrompt: 'Act as a senior engineer. Review the engineering design.' },
        { id: 'a3', typeId: 'general-purpose', customPrompt: 'Act as a criteria validator. Verify the design addresses every acceptance criterion.' }
      ]
    },
    { id: 'step-3', name: 'Implementation', agents: [{ id: 'a4', typeId: 'general-purpose' }] },
    {
      id: 'step-4', name: 'Validation',
      agents: [
        { id: 'a5', typeId: 'code-simplifier' },
        { id: 'a6', typeId: 'general-purpose', customPrompt: 'Run all tests and verify they pass.' },
        { id: 'a7', typeId: 'general-purpose', customPrompt: 'Verify each acceptance criterion is satisfied.' },
        { id: 'a8', typeId: 'general-purpose', customPrompt: 'Update documentation as needed.' }
      ]
    }
  ],
  isDefault: true
}

const DEBUG_WORKFLOW: WorkflowConfig = {
  id: 'debug-workflow',
  name: 'Debug Workflow',
  description: 'Systematic debugging: reproduce, investigate, fix, verify',
  steps: [
    { id: 'dbg-1', name: 'Reproduce & Understand', agents: [
      { id: 'd1', typeId: 'Explore', customPrompt: 'Find the code related to the bug' },
      { id: 'd2', typeId: 'debugger', customPrompt: 'Reproduce the bug and document steps' }
    ]},
    { id: 'dbg-2', name: 'Root Cause Analysis', agents: [{ id: 'd3', typeId: 'debugger' }] },
    { id: 'dbg-3', name: 'Fix Implementation', agents: [{ id: 'd4', typeId: 'general-purpose', customPrompt: 'Implement the fix with minimal changes. Write a regression test first.' }] },
    { id: 'dbg-4', name: 'Verification', agents: [
      { id: 'd5', typeId: 'general-purpose', customPrompt: 'Run all tests and verify the fix works' },
      { id: 'd6', typeId: 'general-purpose', customPrompt: 'Review the fix for correctness' }
    ]}
  ],
  isDefault: false
}

const SUBAGENT_TYPES = [
  { id: 'acceptance-criteria', name: 'Acceptance Criteria', description: 'Propose and get human approval for acceptance criteria before implementation' },
  { id: 'Explore', name: 'Explorer', description: 'Fast codebase reconnaissance' },
  { id: 'Plan', name: 'Planner', description: 'Architecture and design planning' },
  { id: 'general-purpose', name: 'General Purpose', description: 'Versatile agent for implementation, review, testing' },
  { id: 'debugger', name: 'Debugger', description: 'Debug unexpected behavior' },
  { id: 'code-simplifier', name: 'Simplifier', description: 'Code simplification and refactoring' },
  { id: 'bold-frontend-designer', name: 'Frontend Designer', description: 'UI/UX specialist' }
]

let idCounter = 0

export class WorkflowManager {
  private workflows = new Map<string, WorkflowConfig>()
  private storePath: string

  constructor(storePath?: string) {
    this.storePath = storePath || join(homedir(), '.agent-framework', 'workflows.json')
    this.workflows.set(DEFAULT_WORKFLOW.id, DEFAULT_WORKFLOW)
    this.workflows.set(DEBUG_WORKFLOW.id, DEBUG_WORKFLOW)
    try {
      if (existsSync(this.storePath)) {
        const data = JSON.parse(readFileSync(this.storePath, 'utf-8'))
        for (const w of data.workflows || []) this.workflows.set(w.id, w)
        log.info('Loaded workflows from store', { count: data.workflows?.length })
      }
    } catch (e) { log.warn('Failed to load workflow store', e) }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true })
      writeFileSync(this.storePath, JSON.stringify({ version: 1, workflows: Array.from(this.workflows.values()) }, null, 2))
    } catch (e) { log.error('Failed to save workflow store', e) }
  }

  getAllWorkflows(): WorkflowConfig[] { return Array.from(this.workflows.values()) }
  getWorkflow(id: string): WorkflowConfig | undefined { return this.workflows.get(id) }
  getSubagentTypes() { return [...SUBAGENT_TYPES] }

  detectWorkflowFromPlan(plan: string): { workflowId: string; confidence: 'high' | 'low' } {
    const debugPatterns = [/\bdebug\b/i, /\bbug\b/i, /\bfix\s+(the\s+)?bug/i, /\binvestigate\b/i,
      /\broot\s*cause/i, /\bcrash/i, /\bbroken\b/i, /\bfailing\b/i, /\berror\b/i, /\bissue\b/i]
    const matches = debugPatterns.filter(re => re.test(plan)).length
    if (matches >= 2) return { workflowId: 'debug-workflow', confidence: 'high' }
    if (matches === 1) return { workflowId: 'default', confidence: 'low' }
    return { workflowId: 'default', confidence: 'high' }
  }

  createWorkflow(name: string, description?: string): WorkflowConfig {
    const workflow: WorkflowConfig = { id: `workflow-${Date.now()}-${++idCounter}`, name, description, steps: [], isDefault: false }
    this.workflows.set(workflow.id, workflow)
    this.save()
    return workflow
  }

  deleteWorkflow(id: string): void {
    const w = this.workflows.get(id)
    if (!w) throw new Error(`Workflow not found: ${id}`)
    if (w.isDefault) throw new Error('Cannot delete the default workflow')
    this.workflows.delete(id)
    this.save()
  }
}
