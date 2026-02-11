import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentService } from '../AgentService'
import { AgentInfo } from '../types/ProjectConfig'
import { homedir } from 'os'
import { join } from 'path'
import * as fs from 'fs'

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
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}))

describe('AgentService Worktree Parsing', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  it('parses worktrees with legacy agent-N pattern', () => {
    const output = `worktree /path/to/myrepo-agent-1
HEAD 123456
branch refs/heads/feature/agent-1/test

worktree /path/to/myrepo
HEAD 789012
branch refs/heads/main`

    const worktrees = agentService.parseWorktrees(output, 'myrepo')
    expect(worktrees).toHaveLength(1)
    expect(worktrees[0].path).toBe('/path/to/myrepo-agent-1')
  })

  it('parses worktrees with new repo-N pattern', () => {
    const output = `worktree /path/to/myrepo-1
HEAD 123456
branch refs/heads/feature/repo-1/test

worktree /path/to/myrepo
HEAD 789012
branch refs/heads/main`

    // We expect it to find myrepo-1
    const worktrees = agentService.parseWorktrees(output, 'myrepo')
    expect(worktrees).toHaveLength(1)
    expect(worktrees[0].path).toBe('/path/to/myrepo-1')
  })

  it('ignores worktrees that do not match project prefix', () => {
    const output = `worktree /path/to/other-repo-1
HEAD 123456
branch refs/heads/feature/test

worktree /path/to/myrepo
HEAD 789012
branch refs/heads/main`

    const worktrees = agentService.parseWorktrees(output, 'myrepo')
    expect(worktrees).toHaveLength(0)
  })

  // Note: listAgents filtering by .agent-info existence is not unit tested here
  // because it requires mocking private execAsync. This behavior is covered by
  // integration tests and the parseWorktrees tests above verify the parsing logic.

  it('should return absolute path for super minion rules from bundled resources', () => {
    const agentService = new AgentService()
    const rulesPath = agentService.getSuperMinionRulesPath()

    // In dev mode (app.isPackaged = false), path is /app/resources/minions/rules/super-minion-rules.md
    expect(rulesPath).toContain('minions/rules/super-minion-rules.md')
    expect(rulesPath).toContain('/app/resources/minions')
  })
})

describe('AgentService Teleport Session Validation', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  describe('validateTeleportSession', () => {
    it('should return valid for teleported session with existing JSONL file', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const jsonlPath = join(homedir(), '.claude', 'projects', agentInfo.cloudSessionId as string, 'session.jsonl')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === jsonlPath)
      vi.mocked(fs.readFileSync).mockReturnValue('{"type":"file-history-snapshot","sessionId":"session_xyz789"}\n')
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as any)

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(true)
      expect(result.canResume).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should return invalid when JSONL file does not exist', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(false)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('JSONL file not found')
    })

    it('should return invalid when JSONL file is empty', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const jsonlPath = join(homedir(), '.claude', 'projects', agentInfo.cloudSessionId as string, 'session.jsonl')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === jsonlPath)
      vi.mocked(fs.readFileSync).mockReturnValue('')

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(false)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('JSONL file is empty')
    })

    it('should return invalid when JSONL file has corrupted JSON', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const jsonlPath = join(homedir(), '.claude', 'projects', agentInfo.cloudSessionId as string, 'session.jsonl')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === jsonlPath)
      vi.mocked(fs.readFileSync).mockReturnValue('{invalid json content\n')

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(false)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('JSONL file is corrupted')
    })

    it('should return invalid for session without cloudSessionId', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(false)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('Not a teleported session')
    })

    it('should return invalid when JSONL file is stale (older than 7 days)', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const jsonlPath = join(homedir(), '.claude', 'projects', agentInfo.cloudSessionId as string, 'session.jsonl')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === jsonlPath)
      vi.mocked(fs.readFileSync).mockReturnValue('{"type":"file-history-snapshot","sessionId":"session_xyz789"}\n')

      // Mock file modified time as 8 days ago
      const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000)
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: eightDaysAgo } as any)

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(false)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('JSONL file is stale')
    })

    it('should return cannot resume when session state is completed', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        claudeState: 'unknown',
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'completed',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const jsonlPath = join(homedir(), '.claude', 'projects', agentInfo.cloudSessionId as string, 'session.jsonl')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === jsonlPath)
      vi.mocked(fs.readFileSync).mockReturnValue('{"type":"file-history-snapshot","sessionId":"session_xyz789"}\n')
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as any)

      const result = await agentService.validateTeleportSession(agentInfo)

      expect(result.isValid).toBe(true)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('Session is completed')
    })

    it('should use ClaudeSessionInfoService.findSessionFile when available', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        claudeSessionId: 'uuid-123-456',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const worktreePath = '/Users/test/code/myrepo-abc123'
      const expectedJsonlPath = '/Users/test/.claude/projects/-Users-test-code-myrepo-abc123/a1b2c3d4.jsonl'

      // Create mock ClaudeSessionInfoService
      const mockClaudeSessionInfoService = {
        findSessionFile: vi.fn().mockReturnValue(expectedJsonlPath)
      } as any

      agentService.setClaudeSessionInfoService(mockClaudeSessionInfoService)

      vi.mocked(fs.existsSync).mockImplementation((path) => path === expectedJsonlPath)
      vi.mocked(fs.readFileSync).mockReturnValue('{"type":"file-history-snapshot","sessionId":"session_xyz789"}\n')
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as any)

      const result = await agentService.validateTeleportSession(agentInfo, worktreePath)

      // Should call findSessionFile with the correct arguments
      expect(mockClaudeSessionInfoService.findSessionFile).toHaveBeenCalledWith(
        'uuid-123-456',  // Uses claudeSessionId first
        worktreePath
      )

      expect(result.isValid).toBe(true)
      expect(result.canResume).toBe(true)
    })

    it('should fall back to legacy path when ClaudeSessionInfoService returns null', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const worktreePath = '/Users/test/code/myrepo-abc123'
      const legacyPath = join(homedir(), '.claude', 'projects', 'session_xyz789', 'session.jsonl')

      // Create mock ClaudeSessionInfoService that returns null
      const mockClaudeSessionInfoService = {
        findSessionFile: vi.fn().mockReturnValue(null)
      } as any

      agentService.setClaudeSessionInfoService(mockClaudeSessionInfoService)

      // Legacy path exists
      vi.mocked(fs.existsSync).mockImplementation((path) => path === legacyPath)
      vi.mocked(fs.readFileSync).mockReturnValue('{"type":"file-history-snapshot","sessionId":"session_xyz789"}\n')
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as any)

      const result = await agentService.validateTeleportSession(agentInfo, worktreePath)

      expect(result.isValid).toBe(true)
      expect(result.canResume).toBe(true)
    })

    it('should return invalid when both new and legacy paths fail', async () => {
      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        cloudSessionId: 'session_xyz789',
        isTeleportedSession: true,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      const worktreePath = '/Users/test/code/myrepo-abc123'

      // Create mock ClaudeSessionInfoService that returns null
      const mockClaudeSessionInfoService = {
        findSessionFile: vi.fn().mockReturnValue(null)
      } as any

      agentService.setClaudeSessionInfoService(mockClaudeSessionInfoService)

      // No paths exist
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await agentService.validateTeleportSession(agentInfo, worktreePath)

      expect(result.isValid).toBe(false)
      expect(result.canResume).toBe(false)
      expect(result.reason).toContain('JSONL file not found')
    })
  })

  // Note: updateAgentBranchName tests are skipped for now as they require complex mocking
  // of child_process.exec for git worktree list. The method is simple enough that
  // integration tests will cover it adequately.
})

describe('AgentService Dual Config Location Support', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  describe('getProjectConfigPath', () => {
    it('should return minions.json path when it exists (new format)', () => {
      const projectPath = '/path/to/project'
      const newConfigPath = join(projectPath, 'minions.json')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === newConfigPath)

      // Access private method via reflection for testing
      const configPath = (agentService as any).getProjectConfigPath(projectPath)

      expect(configPath).toBe(newConfigPath)
    })

    it('should return legacy minions/config.json path when minions.json does not exist', () => {
      const projectPath = '/path/to/project'
      const legacyConfigPath = join(projectPath, 'minions', 'config.json')

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const configPath = (agentService as any).getProjectConfigPath(projectPath)

      expect(configPath).toBe(legacyConfigPath)
    })

    it('should prefer minions.json over legacy config when both exist', () => {
      const projectPath = '/path/to/project'
      const newConfigPath = join(projectPath, 'minions.json')

      // Both files exist
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const configPath = (agentService as any).getProjectConfigPath(projectPath)

      expect(configPath).toBe(newConfigPath)
    })
  })

  describe('readAgentInfo with new location', () => {
    it('should read from .minions/agents/{id}.json when it exists (new format)', () => {
      const projectPath = '/path/to/project'
      const worktreePath = '/path/to/myrepo-abc123'
      const agentId = 'myrepo-abc123'
      const newAgentInfoPath = join(projectPath, '.minions', 'agents', `${agentId}.json`)

      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: agentId,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === newAgentInfoPath
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(agentInfo))

      // Pass worktreePath, agentId, and projectPath for new format lookup
      const result = agentService.readAgentInfo(worktreePath, agentId, projectPath)

      expect(result).toEqual(agentInfo)
      expect(fs.readFileSync).toHaveBeenCalledWith(newAgentInfoPath, 'utf-8')
    })

    it('should fall back to .agent-info in worktree when new location does not exist', () => {
      const worktreePath = '/path/to/myrepo-abc123'
      const agentId = 'myrepo-abc123'
      const legacyAgentInfoPath = join(worktreePath, '.agent-info')

      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: agentId,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === legacyAgentInfoPath
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(agentInfo))

      // Call with just worktreePath (legacy behavior)
      const result = agentService.readAgentInfo(worktreePath)

      expect(result).toEqual(agentInfo)
    })
  })

  describe('writeAgentInfo with new location', () => {
    it('should write to .minions/agents/{id}.json for new format projects', () => {
      const projectPath = '/path/to/project'
      const agentId = 'myrepo-abc123'
      const newConfigPath = join(projectPath, 'minions.json')
      const newAgentInfoPath = join(projectPath, '.minions', 'agents', `${agentId}.json`)

      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: agentId,
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      // minions.json exists (new format project)
      vi.mocked(fs.existsSync).mockImplementation((path) => path === newConfigPath)

      agentService.writeAgentInfo(projectPath, agentInfo, projectPath)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        newAgentInfoPath,
        JSON.stringify(agentInfo, null, 2)
      )
    })

    it('should write to .agent-info in worktree for legacy projects', () => {
      const worktreePath = '/path/to/myrepo-abc123'
      const legacyAgentInfoPath = join(worktreePath, '.agent-info')

      const agentInfo: AgentInfo = {
        id: 'test-1',
        agentId: 'myrepo-abc123',
        branch: 'feature/test',
        project: 'myrepo',
        feature: 'Test feature',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      // No minions.json (legacy project)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      agentService.writeAgentInfo(worktreePath, agentInfo)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        legacyAgentInfoPath,
        JSON.stringify(agentInfo, null, 2)
      )
    })
  })

  describe('base agent info with new location', () => {
    it('should read from .minions/base-agent.json when it exists (new format)', () => {
      const projectPath = '/path/to/project'
      const newBaseInfoPath = join(projectPath, '.minions', 'base-agent.json')

      const baseAgentInfo: AgentInfo = {
        id: 'myrepo-base-123',
        agentId: 'myrepo-base',
        branch: 'main',
        project: 'myrepo',
        feature: 'Base Branch (main)',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        isBaseBranchAgent: true,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      vi.mocked(fs.existsSync).mockImplementation((path) => path === newBaseInfoPath)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(baseAgentInfo))

      const result = agentService.readBaseAgentInfo(projectPath)

      expect(result).toEqual(baseAgentInfo)
      expect(fs.readFileSync).toHaveBeenCalledWith(newBaseInfoPath, 'utf-8')
    })

    it('should fall back to .minions-base-info when new location does not exist', () => {
      const projectPath = '/path/to/project'
      const legacyBaseInfoPath = join(projectPath, '.minions-base-info')

      const baseAgentInfo: AgentInfo = {
        id: 'myrepo-base-123',
        agentId: 'myrepo-base',
        branch: 'main',
        project: 'myrepo',
        feature: 'Base Branch (main)',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        isBaseBranchAgent: true,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      vi.mocked(fs.existsSync).mockImplementation((path) => path === legacyBaseInfoPath)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(baseAgentInfo))

      const result = agentService.readBaseAgentInfo(projectPath)

      expect(result).toEqual(baseAgentInfo)
      expect(fs.readFileSync).toHaveBeenCalledWith(legacyBaseInfoPath, 'utf-8')
    })

    it('should write to .minions/base-agent.json for new format projects', () => {
      const projectPath = '/path/to/project'
      const newConfigPath = join(projectPath, 'minions.json')
      const newBaseInfoPath = join(projectPath, '.minions', 'base-agent.json')

      const baseAgentInfo: AgentInfo = {
        id: 'myrepo-base-123',
        agentId: 'myrepo-base',
        branch: 'main',
        project: 'myrepo',
        feature: 'Base Branch (main)',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        isBaseBranchAgent: true,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      // minions.json exists (new format project)
      vi.mocked(fs.existsSync).mockImplementation((path) => path === newConfigPath)

      agentService.writeBaseAgentInfo(projectPath, baseAgentInfo)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        newBaseInfoPath,
        JSON.stringify(baseAgentInfo, null, 2)
      )
    })

    it('should write to .minions-base-info for legacy projects', () => {
      const projectPath = '/path/to/project'
      const legacyBaseInfoPath = join(projectPath, '.minions-base-info')

      const baseAgentInfo: AgentInfo = {
        id: 'myrepo-base-123',
        agentId: 'myrepo-base',
        branch: 'main',
        project: 'myrepo',
        feature: 'Base Branch (main)',
        status: 'active',
        tool: 'claude',
        mode: 'dev',
        isBaseBranchAgent: true,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }

      // No minions.json (legacy project)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      agentService.writeBaseAgentInfo(projectPath, baseAgentInfo)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        legacyBaseInfoPath,
        JSON.stringify(baseAgentInfo, null, 2)
      )
    })
  })

  describe('isNewFormatProject helper', () => {
    it('should return true when minions.json exists', () => {
      const projectPath = '/path/to/project'
      const newConfigPath = join(projectPath, 'minions.json')

      vi.mocked(fs.existsSync).mockImplementation((path) => path === newConfigPath)

      const result = agentService.isNewFormatProject(projectPath)

      expect(result).toBe(true)
    })

    it('should return false when minions.json does not exist', () => {
      const projectPath = '/path/to/project'

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = agentService.isNewFormatProject(projectPath)

      expect(result).toBe(false)
    })
  })
})

describe('AgentService Reserved Branch Name Validation', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
  })

  describe('createAssignment', () => {
    const projectPath = '/path/to/project'
    const configContent = JSON.stringify({
      project: { name: 'myrepo', defaultBaseBranch: 'main' },
      setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
      assignments: [],
      testEnvironments: []
    })

    beforeEach(() => {
      // Mock config file and .git directory exist (git repo with minions.json)
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === join(projectPath, 'minions.json') || path === join(projectPath, '.git')
      })
      vi.mocked(fs.readFileSync).mockReturnValue(configContent)
    })

    it('should throw error for reserved branch name "base"', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'base',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "base" is reserved')
    })

    it('should throw error for reserved branch name "main"', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'main',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "main" is reserved')
    })

    it('should throw error for reserved branch name "master"', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'master',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "master" is reserved')
    })

    it('should throw error for reserved branch name "origin"', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'origin',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "origin" is reserved')
    })

    it('should throw error for reserved branch name "head"', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'head',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "head" is reserved')
    })

    it('should throw error for reserved name with feature/ prefix', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'feature/base',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "base" is reserved')
    })

    it('should throw error for reserved name case-insensitively (BASE)', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'BASE',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "BASE" is reserved')
    })

    it('should throw error for reserved name case-insensitively (Main)', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'Main',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Branch name "Main" is reserved')
    })

    it('should list all reserved names in error message', async () => {
      await expect(
        agentService.createAssignment(projectPath, {
          branch: 'base',
          feature: 'Test feature',
          tool: 'claude',
          mode: 'dev'
        })
      ).rejects.toThrow('Reserved names: base, main, master, origin, head')
    })
  })
})

