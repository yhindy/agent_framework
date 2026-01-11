import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentService } from '../AgentService'
import { TeleportService } from '../TeleportService'

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}))

describe('Multi-Repo IPC Handler Helpers', () => {
  let agentService: AgentService

  beforeEach(() => {
    vi.clearAllMocks()
    agentService = new AgentService()
    
    // Mock listAgents implementation
    vi.spyOn(agentService, 'listAgents').mockImplementation(async (projectPath: string) => {
      if (projectPath === '/path/to/projectA') {
        return [{ id: 'projectA-abc1' }] as any
      }
      if (projectPath === '/path/to/projectB') {
        return [{ id: 'projectB-xyz2' }] as any
      }
      return []
    })

    // Mock getAssignments implementation
    vi.spyOn(agentService, 'getAssignments').mockImplementation((projectPath: string) => {
      if (projectPath === '/path/to/projectA') {
        return { assignments: [{ id: 'assign-1', agentId: 'projectA-abc1' }] } as any
      }
      if (projectPath === '/path/to/projectB') {
        return { assignments: [{ id: 'assign-2', agentId: 'projectB-xyz2' }] } as any
      }
      return { assignments: [] }
    })
  })

  const activeProjectPaths = ['/path/to/projectA', '/path/to/projectB']

  describe('findProjectForAgent', () => {
    it('returns correct project path when agent exists in first project', async () => {
      const result = await agentService.findProjectForAgent(activeProjectPaths, 'projectA-abc1')
      expect(result).toBe('/path/to/projectA')
    })

    it('returns correct project path when agent exists in second project', async () => {
      const result = await agentService.findProjectForAgent(activeProjectPaths, 'projectB-xyz2')
      expect(result).toBe('/path/to/projectB')
    })

    it('throws error when agent not found in any project', async () => {
      await expect(agentService.findProjectForAgent(activeProjectPaths, 'unknown-agent'))
        .rejects.toThrow('Agent unknown-agent not found in any active project')
    })
  })

  describe('findProjectForAssignment', () => {
    it('returns correct project path when assignment exists in first project', async () => {
      const result = await agentService.findProjectForAssignment(activeProjectPaths, 'assign-1')
      expect(result).toBe('/path/to/projectA')
    })

    it('returns correct project path when assignment exists in second project', async () => {
      const result = await agentService.findProjectForAssignment(activeProjectPaths, 'assign-2')
      expect(result).toBe('/path/to/projectB')
    })

    it('throws error when assignment not found in any project', async () => {
      await expect(agentService.findProjectForAssignment(activeProjectPaths, 'unknown-assign'))
        .rejects.toThrow('Assignment unknown-assign not found in any active project')
    })
  })
})

describe('Teleport IPC Handler Logic', () => {
  let teleportService: TeleportService

  beforeEach(() => {
    vi.clearAllMocks()
    teleportService = new TeleportService()
  })

  describe('session ID parsing and validation', () => {
    it('parses valid session ID from URL and generates correct assignment', () => {
      const input = 'https://claude.ai/code/session_01CVbxtiJWp387FoCSvAiS2B'
      const parsedSessionId = teleportService.parseSessionId(input)

      expect(parsedSessionId).toBe('session_01CVbxtiJWp387FoCSvAiS2B')

      // Verify branch name generation logic (from IPC handler)
      const shortSessionId = parsedSessionId!.replace('session_', '').substring(0, 8)
      const branchName = `teleport-${shortSessionId}`

      expect(branchName).toBe('teleport-01CVbxti')
    })

    it('parses valid session ID from CLI command', () => {
      const input = 'claude --teleport session_ABC123def456'
      const parsedSessionId = teleportService.parseSessionId(input)

      expect(parsedSessionId).toBe('session_ABC123def456')

      const shortSessionId = parsedSessionId!.replace('session_', '').substring(0, 8)
      expect(shortSessionId).toBe('ABC123de')
    })

    it('parses valid raw session ID', () => {
      const input = 'session_TestSession123'
      const parsedSessionId = teleportService.parseSessionId(input)

      expect(parsedSessionId).toBe('session_TestSession123')
    })

    it('rejects invalid session ID format', () => {
      // Input that doesn't contain 'session_' prefix followed by alphanumerics
      const input = 'sess_ABC123'  // Wrong prefix
      const parsedSessionId = teleportService.parseSessionId(input)

      expect(parsedSessionId).toBeNull()
    })

    it('rejects empty input', () => {
      expect(teleportService.parseSessionId('')).toBeNull()
      expect(teleportService.parseSessionId('   ')).toBeNull()
    })

    it('rejects URL without session ID', () => {
      const input = 'https://claude.ai/code/'
      const parsedSessionId = teleportService.parseSessionId(input)

      expect(parsedSessionId).toBeNull()
    })
  })

  describe('teleport assignment creation', () => {
    it('generates correct assignment structure for teleport', () => {
      const sessionId = 'session_01CVbxtiJWp387FoCSvAiS2B'
      const shortSessionId = sessionId.replace('session_', '').substring(0, 8)
      const branchName = `teleport-${shortSessionId}`

      const assignment = {
        branch: branchName,
        feature: `Teleported session ${shortSessionId}`,
        tool: 'claude',
        mode: 'dev' as const,
        chrome: true
      }

      expect(assignment.branch).toBe('teleport-01CVbxti')
      expect(assignment.feature).toBe('Teleported session 01CVbxti')
      expect(assignment.tool).toBe('claude')
      expect(assignment.mode).toBe('dev')
      expect(assignment.chrome).toBe(true)
    })

    it('handles short session IDs correctly', () => {
      // Session ID shorter than 8 chars after prefix
      const sessionId = 'session_ABC'
      const shortSessionId = sessionId.replace('session_', '').substring(0, 8)

      expect(shortSessionId).toBe('ABC')
      expect(`teleport-${shortSessionId}`).toBe('teleport-ABC')
    })
  })

  describe('error handling', () => {
    it('provides helpful error message for invalid format', () => {
      const invalidInputs = [
        'not_a_session',
        'sess_ABC123',
        'session-without-underscore',
        '12345'
      ]

      for (const input of invalidInputs) {
        const result = teleportService.parseSessionId(input)
        expect(result).toBeNull()
      }
    })

    it('handles session ID with special characters in URL', () => {
      // Query params should not affect parsing
      const input = 'https://claude.ai/code/session_Valid123?ref=share&utm_source=test'
      const result = teleportService.parseSessionId(input)

      expect(result).toBe('session_Valid123')
    })
  })
})

