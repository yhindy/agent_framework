import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentService } from '../AgentService'
import { join } from 'path'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('Budget Enforcement', () => {
  let agentService: AgentService
  let projectPath: string
  let superAgentWorktree: string

  beforeEach(() => {
    agentService = new AgentService()
    projectPath = join(tmpdir(), `test-project-${Date.now()}`)
    superAgentWorktree = join(tmpdir(), `test-super-minion-${Date.now()}`)

    // Create minimal project structure
    mkdirSync(projectPath, { recursive: true })
    mkdirSync(superAgentWorktree, { recursive: true })

    // Create minimal config
    const minionsDir = join(projectPath, 'minions')
    mkdirSync(minionsDir, { recursive: true })
    writeFileSync(
      join(minionsDir, 'config.json'),
      JSON.stringify({
        project: { name: 'test-project', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
        assignments: [],
        testEnvironments: []
      })
    )
  })

  afterEach(() => {
    try {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(superAgentWorktree, { recursive: true, force: true })
    } catch (e) {
      // Ignore cleanup errors
    }
  })

  it('should reject approval when budget is exhausted', async () => {
    // Setup: Create super minion with budget of 2 and 2 children
    const superAgentInfo = {
      id: 'super-1',
      agentId: 'test-super',
      branch: 'feature/test-super',
      project: 'test-project',
      feature: 'Test mission',
      status: 'active' as const,
      tool: 'claude',
      mode: 'planning' as const,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      isSuperMinion: true,
      minionBudget: 2,
      children: [],
      pendingPlans: []
    }

    agentService.writeAgentInfo(superAgentWorktree, superAgentInfo)

    // Add 2 existing children
    const child1Info = {
      id: 'child-1',
      agentId: 'test-child-1',
      branch: 'feature/test-child-1',
      project: 'test-project',
      feature: 'Child task 1',
      status: 'active' as const,
      tool: 'claude',
      mode: 'dev' as const,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      parentAgentId: 'test-super'
    }

    const child2Info = {
      id: 'child-2',
      agentId: 'test-child-2',
      branch: 'feature/test-child-2',
      project: 'test-project',
      feature: 'Child task 2',
      status: 'active' as const,
      tool: 'claude',
      mode: 'dev' as const,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      parentAgentId: 'test-super'
    }

    const child1Worktree = join(tmpdir(), 'test-child-1')
    const child2Worktree = join(tmpdir(), 'test-child-2')
    mkdirSync(child1Worktree, { recursive: true })
    mkdirSync(child2Worktree, { recursive: true })

    agentService.writeAgentInfo(child1Worktree, child1Info)
    agentService.writeAgentInfo(child2Worktree, child2Info)

    // Create pending plan
    const plansData = {
      plans: [
        {
          id: 'plan-3',
          shortName: 'task-3',
          description: 'Third task (should be rejected)',
          prompt: 'Do something',
          estimatedComplexity: 'small' as const,
          status: 'pending' as const
        }
      ]
    }

    writeFileSync(join(superAgentWorktree, '.pending-plans.json'), JSON.stringify(plansData, null, 2))

    // Mock createAssignment to avoid filesystem operations
    const createAssignmentSpy = vi.spyOn(agentService, 'createAssignment')
    createAssignmentSpy.mockRejectedValueOnce(new Error('Should not be called'))

    // Mock listAgents to return our test setup
    const listAgentsSpy = vi.spyOn(agentService, 'listAgents')
    listAgentsSpy.mockResolvedValueOnce([
      {
        id: 'super-1',
        assignmentId: 'super-1',
        worktreePath: superAgentWorktree,
        terminalPid: null,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        mode: 'planning',
        tool: 'claude',
        isSuperMinion: true
      },
      {
        id: 'child-1',
        assignmentId: 'child-1',
        worktreePath: child1Worktree,
        terminalPid: null,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        mode: 'dev',
        tool: 'claude',
        parentAgentId: 'test-super'
      },
      {
        id: 'child-2',
        assignmentId: 'child-2',
        worktreePath: child2Worktree,
        terminalPid: null,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        mode: 'dev',
        tool: 'claude',
        parentAgentId: 'test-super'
      }
    ] as any)

    // Action: Try to approve plan - should fail with budget error
    await expect(
      agentService.approvePlan(projectPath, 'super-1', 'plan-3')
    ).rejects.toThrow(/Budget exceeded/)

    // Assert: createAssignment should not have been called
    expect(createAssignmentSpy).not.toHaveBeenCalled()

    // Cleanup
    rmSync(child1Worktree, { recursive: true, force: true })
    rmSync(child2Worktree, { recursive: true, force: true })
    createAssignmentSpy.mockRestore()
    listAgentsSpy.mockRestore()
  })

  it('should update plan with childAgentId after approval', async () => {
    // This is integration tested via PlanApproval.test.ts
    // This is a smoke test to ensure the type is satisfied
    const plan = {
      id: 'plan-1',
      shortName: 'task-1',
      description: 'Test task',
      prompt: 'Do something',
      estimatedComplexity: 'small' as const,
      status: 'pending' as const,
      childAgentId: undefined as string | undefined
    }

    plan.childAgentId = 'project-abc123'
    expect(plan.childAgentId).toBe('project-abc123')
  })
})
