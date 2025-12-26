import { AgentService } from '../AgentService'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

describe('AgentService - UI State Persistence', () => {
  let agentService: AgentService
  let testProjectPath: string
  let testWorktreePath: string
  const projectName = 'test-project'
  const agentId = `${projectName}-abc123`

  beforeEach(() => {
    agentService = new AgentService()

    // Create temporary test directory
    const tmpBase = join(tmpdir(), `agent-test-${Date.now()}`)
    testProjectPath = join(tmpBase, projectName)
    testWorktreePath = join(tmpBase, agentId)

    // Create directories
    mkdirSync(testProjectPath, { recursive: true })
    mkdirSync(testWorktreePath, { recursive: true })
    mkdirSync(join(testProjectPath, 'minions'), { recursive: true })

    // Initialize git repo
    execSync('git init', { cwd: testProjectPath })
    execSync('git config user.email "test@test.com"', { cwd: testProjectPath })
    execSync('git config user.name "Test"', { cwd: testProjectPath })

    // Create a commit to have a valid HEAD
    writeFileSync(join(testProjectPath, 'README.md'), '# Test Project')
    execSync('git add .', { cwd: testProjectPath })
    execSync('git commit -m "Initial commit"', { cwd: testProjectPath })

    // Create config.json
    const config = {
      project: { name: projectName, defaultBaseBranch: 'main' },
      setup: {
        filesToCopy: [],
        postSetupCommands: [],
        requiredFiles: [],
        preflightCommands: []
      },
      assignments: [],
      testEnvironments: []
    }
    writeFileSync(
      join(testProjectPath, 'minions', 'config.json'),
      JSON.stringify(config, null, 2)
    )

    // Create worktree
    execSync(`git worktree add ${testWorktreePath} -b ${agentId}`, { cwd: testProjectPath })

    // Create initial .agent-info file
    const agentInfo = {
      id: `${agentId}-1`,
      agentId: agentId,
      branch: `feature/${agentId}/test`,
      project: projectName,
      feature: 'Test feature',
      status: 'active',
      tool: 'claude',
      mode: 'dev',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    }
    writeFileSync(
      join(testWorktreePath, '.agent-info'),
      JSON.stringify(agentInfo, null, 2)
    )
  })

  afterEach(() => {
    // Cleanup: remove git worktrees
    try {
      execSync(`git worktree remove ${testWorktreePath} --force`, { cwd: testProjectPath })
    } catch (e) {
      // Ignore cleanup errors
    }
  })

  describe('saveUIState', () => {
    it('should save UI state to .agent-info file', async () => {
      const uiState = {
        lastActiveTab: 'terminal-2',
        plainTerminals: ['terminal-1', 'terminal-2'],
        terminalCounter: 2,
        lastFocusTime: new Date().toISOString()
      }

      await agentService.saveUIState(testProjectPath, agentId, uiState)

      // Read .agent-info file
      const agentInfoPath = join(testWorktreePath, '.agent-info')
      const savedInfo = JSON.parse(readFileSync(agentInfoPath, 'utf-8'))

      expect(savedInfo.uiState).toEqual(uiState)
    })

    it('should update lastActivity when saving UI state', async () => {
      const beforeTime = new Date().toISOString()

      await new Promise(resolve => setTimeout(resolve, 10))

      const uiState = {
        lastActiveTab: 'agent',
        plainTerminals: ['terminal-1'],
        terminalCounter: 1,
        lastFocusTime: new Date().toISOString()
      }

      await agentService.saveUIState(testProjectPath, agentId, uiState)

      const agentInfoPath = join(testWorktreePath, '.agent-info')
      const savedInfo = JSON.parse(readFileSync(agentInfoPath, 'utf-8'))

      expect(savedInfo.lastActivity).not.toBe(beforeTime)
      expect(new Date(savedInfo.lastActivity).getTime()).toBeGreaterThan(
        new Date(beforeTime).getTime()
      )
    })

    it('should preserve other fields when updating UI state', async () => {
      const uiState = {
        lastActiveTab: 'terminal-3',
        plainTerminals: ['terminal-1', 'terminal-2', 'terminal-3'],
        terminalCounter: 3,
        lastFocusTime: new Date().toISOString()
      }

      await agentService.saveUIState(testProjectPath, agentId, uiState)

      const agentInfoPath = join(testWorktreePath, '.agent-info')
      const savedInfo = JSON.parse(readFileSync(agentInfoPath, 'utf-8'))

      // Check that other fields are preserved
      expect(savedInfo.id).toBe(`${agentId}-1`)
      expect(savedInfo.agentId).toBe(agentId)
      expect(savedInfo.feature).toBe('Test feature')
      expect(savedInfo.tool).toBe('claude')
      expect(savedInfo.uiState).toEqual(uiState)
    })

    it('should throw error if agent not found', async () => {
      const uiState = {
        lastActiveTab: 'agent',
        plainTerminals: ['terminal-1'],
        terminalCounter: 1,
        lastFocusTime: new Date().toISOString()
      }

      await expect(
        agentService.saveUIState(testProjectPath, 'nonexistent-agent', uiState)
      ).rejects.toThrow('Agent nonexistent-agent not found')
    })

    it('should update in-memory session with UI state', async () => {
      // First list agents to populate the session
      await agentService.listAgents(testProjectPath)

      const uiState = {
        lastActiveTab: 'terminal-5',
        plainTerminals: ['terminal-1', 'terminal-2', 'terminal-3', 'terminal-4', 'terminal-5'],
        terminalCounter: 5,
        lastFocusTime: new Date().toISOString()
      }

      await agentService.saveUIState(testProjectPath, agentId, uiState)

      // List agents again to get updated session
      const agents = await agentService.listAgents(testProjectPath)
      const agent = agents.find(a => a.id === agentId)

      expect(agent).toBeDefined()
      expect(agent!.uiState).toEqual(uiState)
    })

    it('should handle multiple concurrent saves without corruption', async () => {
      const uiState1 = {
        lastActiveTab: 'terminal-1',
        plainTerminals: ['terminal-1'],
        terminalCounter: 1,
        lastFocusTime: new Date().toISOString()
      }

      const uiState2 = {
        lastActiveTab: 'terminal-2',
        plainTerminals: ['terminal-1', 'terminal-2'],
        terminalCounter: 2,
        lastFocusTime: new Date().toISOString()
      }

      // Save concurrently
      await Promise.all([
        agentService.saveUIState(testProjectPath, agentId, uiState1),
        agentService.saveUIState(testProjectPath, agentId, uiState2)
      ])

      // Read final state - should be one of the two (not corrupted)
      const agentInfoPath = join(testWorktreePath, '.agent-info')
      const savedInfo = JSON.parse(readFileSync(agentInfoPath, 'utf-8'))

      expect(savedInfo.uiState).toBeDefined()
      // Should be valid JSON and match one of the states
      expect(
        savedInfo.uiState.lastActiveTab === 'terminal-1' ||
        savedInfo.uiState.lastActiveTab === 'terminal-2'
      ).toBe(true)
    })
  })

  describe('listAgents - UI state restoration', () => {
    it('should return uiState when present in .agent-info', async () => {
      // Add UI state to the .agent-info file
      const agentInfoPath = join(testWorktreePath, '.agent-info')
      const agentInfo = JSON.parse(readFileSync(agentInfoPath, 'utf-8'))
      agentInfo.uiState = {
        lastActiveTab: 'terminal-2',
        plainTerminals: ['terminal-1', 'terminal-2'],
        terminalCounter: 2,
        lastFocusTime: new Date().toISOString()
      }
      writeFileSync(agentInfoPath, JSON.stringify(agentInfo, null, 2))

      const agents = await agentService.listAgents(testProjectPath)
      const agent = agents.find(a => a.id === agentId)

      expect(agent).toBeDefined()
      expect(agent!.uiState).toEqual(agentInfo.uiState)
    })

    it('should return undefined uiState when not present (backward compatibility)', async () => {
      // .agent-info without uiState (old format)
      const agents = await agentService.listAgents(testProjectPath)
      const agent = agents.find(a => a.id === agentId)

      expect(agent).toBeDefined()
      expect(agent!.uiState).toBeUndefined()
    })

    it('should handle malformed uiState gracefully', async () => {
      // Create malformed .agent-info
      const agentInfoPath = join(testWorktreePath, '.agent-info')
      const agentInfo = JSON.parse(readFileSync(agentInfoPath, 'utf-8'))
      agentInfo.uiState = 'invalid-not-an-object'
      writeFileSync(agentInfoPath, JSON.stringify(agentInfo, null, 2))

      const agents = await agentService.listAgents(testProjectPath)
      const agent = agents.find(a => a.id === agentId)

      expect(agent).toBeDefined()
      // Should preserve whatever was in the file (type: string in this case)
      expect(agent!.uiState).toBe('invalid-not-an-object')
    })
  })
})
