import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentService } from '../AgentService'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { BrowserWindow } from 'electron'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

describe('AgentService Plan Approval', () => {
  let agentService: AgentService
  let mockMainWindow: any
  let testProjectPath: string
  let testSuperWorktreePath: string

  beforeEach(() => {
    // Setup Mock Window
    mockMainWindow = {
      webContents: {
        send: vi.fn()
      }
    } as unknown as BrowserWindow

    agentService = new AgentService(mockMainWindow)

    // Create a test project directory
    testProjectPath = join(tmpdir(), `test-project-${Date.now()}`)
    mkdirSync(testProjectPath, { recursive: true })

    // Create project config
    const configPath = join(testProjectPath, '.cursor_agent')
    mkdirSync(configPath, { recursive: true })
    writeFileSync(join(configPath, 'config.json'), JSON.stringify({
      project: { name: 'test-project' },
      assignments: []
    }))

    // Create a super minion worktree
    testSuperWorktreePath = join(tmpdir(), `test-project-super-1`)
    mkdirSync(testSuperWorktreePath, { recursive: true })

    // Write super minion .agent-info
    writeFileSync(join(testSuperWorktreePath, '.agent-info'), JSON.stringify({
      id: 'super-1',
      agentId: 'super-1',
      branch: 'feature/super-1',
      project: 'test-project',
      feature: 'Master feature',
      status: 'active',
      tool: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      mode: 'planning',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      isSuperMinion: true,
      minionBudget: 5,
      children: [],
      pendingPlans: []
    }, null, 2))

    // Write .pending-plans.json
    writeFileSync(join(testSuperWorktreePath, '.pending-plans.json'), JSON.stringify({
      plans: [
        {
          id: 'plan-1',
          shortName: 'auth-fix',
          branch: 'auth-fix',
          description: 'Fix authentication',
          prompt: 'Fix the login bug',
          status: 'pending',
          estimatedComplexity: 'small'
        }
      ]
    }, null, 2))
  })

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true })
    }
    if (existsSync(testSuperWorktreePath)) {
      rmSync(testSuperWorktreePath, { recursive: true, force: true })
    }
  })

  it('approves a plan and creates child agent', async () => {
    // Mock listAgents to return our super agent
    vi.spyOn(agentService, 'listAgents').mockResolvedValue([
      {
        id: 'super-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        worktreePath: testSuperWorktreePath,
        isSuperMinion: true
      }
    ] as any)

    // Mock createAssignment to return a child agent
    vi.spyOn(agentService, 'createAssignment').mockResolvedValue({
      id: 'child-1',
      agentId: 'child-1',
      branch: 'feature/child-1',
      project: 'test-project',
      feature: 'Fix authentication',
      status: 'active',
      tool: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      mode: 'dev',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    } as any)

    // Mock updateAgentInfo to avoid file system operations
    vi.spyOn(agentService as any, 'updateAgentInfo').mockImplementation(() => {})

    await agentService.approvePlan(testProjectPath, 'super-1', 'plan-1')

    // Verify plan was marked as approved
    const plansContent = readFileSync(join(testSuperWorktreePath, '.pending-plans.json'), 'utf-8')
    const plansData = JSON.parse(plansContent)
    expect(plansData.plans[0].status).toBe('approved')

    // Verify .children-status.json was created
    expect(existsSync(join(testSuperWorktreePath, '.children-status.json'))).toBe(true)
    const statusContent = readFileSync(join(testSuperWorktreePath, '.children-status.json'), 'utf-8')
    const statusData = JSON.parse(statusContent)
    expect(statusData.children).toHaveLength(1)
    expect(statusData.children[0].agentId).toBe('child-1')

    // Verify createAssignment was called with correct args
    expect(agentService.createAssignment).toHaveBeenCalledWith(
      testProjectPath,
      expect.objectContaining({
        branch: 'auth-fix',
        feature: 'Fix authentication',
        prompt: 'Fix the login bug',
        tool: 'claude',
        mode: 'dev'
      })
    )

    // Verify updateAgentInfo was called to set parentAgentId
    expect((agentService as any).updateAgentInfo).toHaveBeenCalledWith(
      expect.any(String),
      { parentAgentId: 'super-1' }
    )
  })

  it('throws error if agent not found', async () => {
    vi.spyOn(agentService, 'listAgents').mockResolvedValue([])

    await expect(
      agentService.approvePlan(testProjectPath, 'super-1', 'plan-1')
    ).rejects.toThrow('Super agent not found')
  })

  it('throws error if plan not found', async () => {
    vi.spyOn(agentService, 'listAgents').mockResolvedValue([
      {
        id: 'super-1',
        terminalPid: 123,
        hasUnread: false,
        lastActivity: new Date().toISOString(),
        worktreePath: testSuperWorktreePath,
        isSuperMinion: true
      }
    ] as any)

    await expect(
      agentService.approvePlan(testProjectPath, 'super-1', 'nonexistent-plan')
    ).rejects.toThrow('Plan not found')
  })
})

