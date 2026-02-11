import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SetupWizardService, WizardOutputBuffer } from '../SetupWizardService'
import type { AgentService } from '../AgentService'
import type { TerminalService } from '../TerminalService'
import type { MinionsConfigService } from '../MinionsConfigService'
import type { MinionsConfig } from '../types/MinionsConfig'
import * as fs from 'fs'

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  rmdirSync: vi.fn(),
}))

// Create mock services
const createMockAgentService = (): AgentService => ({
  createAssignment: vi.fn(),
  readAgentInfo: vi.fn(),
  writeAgentInfo: vi.fn(),
  listAgents: vi.fn(),
  teardownAgent: vi.fn(),
  getProjectName: vi.fn().mockReturnValue('test-project'),
  isNewFormatProject: vi.fn().mockReturnValue(true),
  isGitRepo: vi.fn().mockReturnValue(true),
  ensureBaseBranchAgent: vi.fn().mockResolvedValue(undefined),
} as unknown as AgentService)

const createMockTerminalService = (): TerminalService => ({
  startAgent: vi.fn(),
  stopAgent: vi.fn(),
  hasActiveTerminal: vi.fn().mockReturnValue(false),
  sendInput: vi.fn(),
  getTerminalPid: vi.fn(),
} as unknown as TerminalService)

const createMockMinionsConfigService = (): MinionsConfigService => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  hasConfig: vi.fn(),
  hasLegacyConfig: vi.fn(),
  initializeMinionsFolder: vi.fn(),
  updateGitignore: vi.fn(),
  getDefaultConfig: vi.fn().mockReturnValue({
    version: '2.0',
    project: { name: 'test-project', defaultBaseBranch: 'main' },
    setup: { filesToCopy: [], postSetupCommands: [] },
  }),
} as unknown as MinionsConfigService)

describe('SetupWizardService', () => {
  let service: SetupWizardService
  let mockAgentService: AgentService
  let mockTerminalService: TerminalService
  let mockMinionsConfigService: MinionsConfigService

  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentService = createMockAgentService()
    mockTerminalService = createMockTerminalService()
    mockMinionsConfigService = createMockMinionsConfigService()
    service = new SetupWizardService(
      mockAgentService,
      mockTerminalService,
      mockMinionsConfigService
    )
  })

  afterEach(() => {
    // Clean up any active sessions
    service.cleanup()
  })

  describe('needsWizard', () => {
    it('should return true for fresh git project with no config', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions.json')) return false
          if (path.includes('minions/config.json')) return false
          if (path.endsWith('.git')) return true // git repo
        }
        return false
      })

      const result = service.needsWizard('/path/to/project')

      expect(result).toBe(true)
    })

    it('should return false for non-git project (auto-setup instead)', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions.json')) return false
          if (path.includes('minions/config.json')) return false
          if (path.endsWith('.git')) return false // not a git repo
        }
        return false
      })

      const result = service.needsWizard('/path/to/project')

      expect(result).toBe(false)
    })

    it('should return false when minions.json exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions.json')) return true
        }
        return false
      })

      const result = service.needsWizard('/path/to/project')

      expect(result).toBe(false)
    })

    it('should return false when legacy config exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions.json')) return false
          if (path.includes('minions/config.json')) return true
        }
        return false
      })

      const result = service.needsWizard('/path/to/project')

      expect(result).toBe(false)
    })
  })

  describe('quickSetup', () => {
    it('should create minimal config for non-git projects without calling ensureBaseBranchAgent', async () => {
      vi.mocked(mockAgentService.isGitRepo as any).mockReturnValue(false)

      await service.quickSetup('/path/to/project')

      expect(mockAgentService.ensureBaseBranchAgent).not.toHaveBeenCalled()
      expect(mockMinionsConfigService.getDefaultConfig).toHaveBeenCalledWith('/path/to/project')
      expect(mockMinionsConfigService.initializeMinionsFolder).toHaveBeenCalledWith('/path/to/project')
      expect(mockMinionsConfigService.writeConfig).toHaveBeenCalledWith('/path/to/project', expect.objectContaining({
        version: '2.0'
      }))
      expect(mockMinionsConfigService.updateGitignore).toHaveBeenCalledWith('/path/to/project')
    })

    it('should call ensureBaseBranchAgent for git projects', async () => {
      vi.mocked(mockAgentService.isGitRepo as any).mockReturnValue(true)

      await service.quickSetup('/path/to/project')

      expect(mockAgentService.ensureBaseBranchAgent).toHaveBeenCalledWith('/path/to/project')
      expect(mockMinionsConfigService.writeConfig).toHaveBeenCalled()
    })
  })

  describe('hasLegacyStructure', () => {
    it('should return true when minions/config.json exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('minions/config.json')
      })

      const result = service.hasLegacyStructure('/path/to/project')

      expect(result).toBe(true)
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/project/minions/config.json')
    })

    it('should return false when minions/config.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = service.hasLegacyStructure('/path/to/project')

      expect(result).toBe(false)
    })
  })

  describe('parseWizardOutput', () => {
    it('should extract valid JSON between markers', () => {
      const output = `
        Analyzing project structure...
        ===MINIONS_CONFIG_START===
        {
          "version": "2.0",
          "project": {
            "name": "my-app",
            "defaultBaseBranch": "main"
          },
          "setup": {
            "filesToCopy": [".env.example"],
            "postSetupCommands": ["npm install"],
            "testCommand": "npm test"
          }
        }
        ===MINIONS_CONFIG_END===
        Configuration complete!
      `

      const result = service.parseWizardOutput(output)

      expect(result).not.toBeNull()
      expect(result?.version).toBe('2.0')
      expect(result?.project?.name).toBe('my-app')
      expect(result?.setup?.filesToCopy).toEqual(['.env.example'])
    })

    it('should return null when start marker is missing', () => {
      const output = `
        {
          "version": "2.0",
          "project": { "name": "my-app" }
        }
        ===MINIONS_CONFIG_END===
      `

      const result = service.parseWizardOutput(output)

      expect(result).toBeNull()
    })

    it('should return null when end marker is missing', () => {
      const output = `
        ===MINIONS_CONFIG_START===
        {
          "version": "2.0",
          "project": { "name": "my-app" }
        }
      `

      const result = service.parseWizardOutput(output)

      expect(result).toBeNull()
    })

    it('should return null for invalid JSON between markers', () => {
      const output = `
        ===MINIONS_CONFIG_START===
        { invalid json content }
        ===MINIONS_CONFIG_END===
      `

      const result = service.parseWizardOutput(output)

      expect(result).toBeNull()
    })

    it('should return null when end marker comes before start marker', () => {
      const output = `
        ===MINIONS_CONFIG_END===
        { "version": "2.0" }
        ===MINIONS_CONFIG_START===
      `

      const result = service.parseWizardOutput(output)

      expect(result).toBeNull()
    })
  })

  describe('startWizard', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
    })

    it('should create a wizard session', async () => {
      const session = await service.startWizard('/path/to/project')

      expect(session).toBeDefined()
      expect(session.projectPath).toBe('/path/to/project')
      expect(session.status).toBe('analyzing')
      expect(session.agentId).toBeDefined()
      expect(session.startedAt).toBeDefined()
    })

    it('should start a Claude agent for the wizard', async () => {
      await service.startWizard('/path/to/project')

      expect(mockTerminalService.startAgent).toHaveBeenCalledWith(
        '/path/to/project',
        expect.any(String),
        'claude',
        'dev',
        expect.any(String), // prompt
        'opus', // model
        false, // yolo
        true // chrome
      )
    })

    it('should include project info in the wizard prompt', async () => {
      await service.startWizard('/path/to/project')

      const promptArg = vi.mocked(mockTerminalService.startAgent).mock.calls[0][4]
      expect(promptArg).toContain('minions.json')
      expect(promptArg).toContain('===MINIONS_CONFIG_START===')
      expect(promptArg).toContain('===MINIONS_CONFIG_END===')
    })

    it('should throw if wizard is already running for project', async () => {
      await service.startWizard('/path/to/project')

      await expect(service.startWizard('/path/to/project')).rejects.toThrow(
        'Wizard already running'
      )
    })

    it('should set default timeout', async () => {
      const session = await service.startWizard('/path/to/project')

      expect(session.timeoutMs).toBe(300000) // 5 minutes
    })
  })

  describe('cancelWizard', () => {
    it('should update status to cancelled', async () => {
      const session = await service.startWizard('/path/to/project')

      await service.cancelWizard(session.id)

      // Session should be removed from active sessions
      const activeSession = service.getSession(session.id)
      expect(activeSession).toBeUndefined()
    })

    it('should kill the terminal', async () => {
      const session = await service.startWizard('/path/to/project')

      await service.cancelWizard(session.id)

      expect(mockTerminalService.stopAgent).toHaveBeenCalledWith(session.agentId)
    })

    it('should clean up empty .minions folder', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('.minions')
      })
      vi.mocked(fs.readdirSync).mockReturnValue([])

      const session = await service.startWizard('/path/to/project')
      await service.cancelWizard(session.id)

      expect(fs.rmdirSync).toHaveBeenCalledWith('/path/to/project/.minions')
    })

    it('should not remove .minions folder if it has contents', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('.minions')
      })
      // readdirSync returns string[] when called without options
      vi.mocked(fs.readdirSync).mockReturnValue(['agents'] as any)

      const session = await service.startWizard('/path/to/project')
      await service.cancelWizard(session.id)

      expect(fs.rmdirSync).not.toHaveBeenCalled()
    })

    it('should handle non-existent session gracefully', async () => {
      await expect(service.cancelWizard('non-existent-id')).resolves.not.toThrow()
    })
  })

  describe('finalizeSetup', () => {
    const validConfig: MinionsConfig = {
      version: '2.0',
      project: {
        name: 'test-project',
        defaultBaseBranch: 'main',
      },
      setup: {
        filesToCopy: ['.env.example'],
        postSetupCommands: ['npm install'],
      },
    }

    it('should write the config to minions.json', async () => {
      await service.finalizeSetup('/path/to/project', validConfig)

      expect(mockMinionsConfigService.writeConfig).toHaveBeenCalledWith(
        '/path/to/project',
        expect.objectContaining({
          version: '2.0',
          project: expect.objectContaining({ name: 'test-project' }),
        })
      )
    })

    it('should initialize .minions folder', async () => {
      await service.finalizeSetup('/path/to/project', validConfig)

      expect(mockMinionsConfigService.initializeMinionsFolder).toHaveBeenCalledWith(
        '/path/to/project'
      )
    })

    it('should update .gitignore', async () => {
      await service.finalizeSetup('/path/to/project', validConfig)

      expect(mockMinionsConfigService.updateGitignore).toHaveBeenCalledWith(
        '/path/to/project'
      )
    })

    it('should add wizard completion metadata', async () => {
      await service.finalizeSetup('/path/to/project', validConfig)

      const writtenConfig = vi.mocked(mockMinionsConfigService.writeConfig).mock.calls[0][1]
      expect(writtenConfig.wizard).toBeDefined()
      expect(writtenConfig.wizard?.completedAt).toBeDefined()
    })

    it('should throw on invalid config', async () => {
      const invalidConfig = {
        version: '1.0', // invalid version
        project: { name: 'test' },
      } as unknown as MinionsConfig

      await expect(service.finalizeSetup('/path/to/project', invalidConfig)).rejects.toThrow(
        'Invalid configuration'
      )
    })

    it('should throw if project name is missing', async () => {
      const invalidConfig = {
        version: '2.0',
        project: { defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [] },
      } as unknown as MinionsConfig

      await expect(service.finalizeSetup('/path/to/project', invalidConfig)).rejects.toThrow(
        'Invalid configuration'
      )
    })
  })

  describe('generateWizardPrompt', () => {
    it('should include project path', () => {
      const prompt = service.generateWizardPrompt('/path/to/my-project')

      expect(prompt).toContain('/path/to/my-project')
    })

    it('should include config markers', () => {
      const prompt = service.generateWizardPrompt('/path/to/project')

      expect(prompt).toContain('===MINIONS_CONFIG_START===')
      expect(prompt).toContain('===MINIONS_CONFIG_END===')
    })

    it('should include instructions to explore project', () => {
      const prompt = service.generateWizardPrompt('/path/to/project')

      expect(prompt.toLowerCase()).toContain('explore')
      expect(prompt.toLowerCase()).toContain('package.json')
    })

    it('should include expected output format', () => {
      const prompt = service.generateWizardPrompt('/path/to/project')

      expect(prompt).toContain('"version": "2.0"')
      expect(prompt).toContain('"filesToCopy"')
      expect(prompt).toContain('"postSetupCommands"')
    })

    it('should mention CLAUDE.md option', () => {
      const prompt = service.generateWizardPrompt('/path/to/project')

      expect(prompt).toContain('CLAUDE.md')
    })
  })

  describe('getSession', () => {
    it('should return active session by ID', async () => {
      const session = await service.startWizard('/path/to/project')

      const retrieved = service.getSession(session.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(session.id)
    })

    it('should return undefined for non-existent session', () => {
      const retrieved = service.getSession('non-existent')

      expect(retrieved).toBeUndefined()
    })
  })

  describe('getSessionByProject', () => {
    it('should return active session by project path', async () => {
      const session = await service.startWizard('/path/to/project')

      const retrieved = service.getSessionByProject('/path/to/project')

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(session.id)
    })

    it('should return undefined for non-existent project', () => {
      const retrieved = service.getSessionByProject('/non/existent/path')

      expect(retrieved).toBeUndefined()
    })
  })
})

describe('WizardOutputBuffer', () => {
  describe('append and checkForConfig', () => {
    it('should detect config when markers are complete', () => {
      const onConfigReady = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady)

      buffer.append('Some output...\n')
      buffer.append('===MINIONS_CONFIG_START===\n')
      buffer.append('{"version":"2.0","project":{"name":"test","defaultBaseBranch":"main"},"setup":{"filesToCopy":[],"postSetupCommands":[]}}\n')
      buffer.append('===MINIONS_CONFIG_END===\n')

      expect(onConfigReady).toHaveBeenCalledTimes(1)
      expect(onConfigReady).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '2.0',
          project: expect.objectContaining({ name: 'test' }),
        })
      )
    })

    it('should accumulate partial output until markers complete', () => {
      const onConfigReady = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady)

      buffer.append('===MINIONS_CONFIG_START===\n')
      expect(onConfigReady).not.toHaveBeenCalled()

      buffer.append('{"version":"2.0",')
      expect(onConfigReady).not.toHaveBeenCalled()

      buffer.append('"project":{"name":"test","defaultBaseBranch":"main"},')
      expect(onConfigReady).not.toHaveBeenCalled()

      buffer.append('"setup":{"filesToCopy":[],"postSetupCommands":[]}}\n')
      expect(onConfigReady).not.toHaveBeenCalled()

      buffer.append('===MINIONS_CONFIG_END===')
      expect(onConfigReady).toHaveBeenCalledTimes(1)
    })

    it('should only call callback once even with multiple appends', () => {
      const onConfigReady = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady)

      const fullOutput = `
        ===MINIONS_CONFIG_START===
        {"version":"2.0","project":{"name":"test","defaultBaseBranch":"main"},"setup":{"filesToCopy":[],"postSetupCommands":[]}}
        ===MINIONS_CONFIG_END===
      `

      buffer.append(fullOutput)
      buffer.append('More output...')
      buffer.append('Even more...')

      expect(onConfigReady).toHaveBeenCalledTimes(1)
    })

    it('should not call callback for invalid JSON', () => {
      const onConfigReady = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady)

      buffer.append('===MINIONS_CONFIG_START===\n')
      buffer.append('{ invalid json }\n')
      buffer.append('===MINIONS_CONFIG_END===')

      expect(onConfigReady).not.toHaveBeenCalled()
    })
  })

  describe('timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should call onTimeout when timeout expires without config', () => {
      const onConfigReady = vi.fn()
      const onTimeout = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady, onTimeout, 5000)

      buffer.startTimeout()
      buffer.append('Some output but no config...')

      vi.advanceTimersByTime(5000)

      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(onConfigReady).not.toHaveBeenCalled()
    })

    it('should clear timeout when config is received', () => {
      const onConfigReady = vi.fn()
      const onTimeout = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady, onTimeout, 5000)

      buffer.startTimeout()
      buffer.append('===MINIONS_CONFIG_START===\n')
      buffer.append('{"version":"2.0","project":{"name":"test","defaultBaseBranch":"main"},"setup":{"filesToCopy":[],"postSetupCommands":[]}}\n')
      buffer.append('===MINIONS_CONFIG_END===')

      vi.advanceTimersByTime(10000)

      expect(onTimeout).not.toHaveBeenCalled()
      expect(onConfigReady).toHaveBeenCalledTimes(1)
    })

    it('should allow manual timeout clearing', () => {
      const onConfigReady = vi.fn()
      const onTimeout = vi.fn()
      const buffer = new WizardOutputBuffer(onConfigReady, onTimeout, 5000)

      buffer.startTimeout()
      buffer.clearTimeout()

      vi.advanceTimersByTime(10000)

      expect(onTimeout).not.toHaveBeenCalled()
    })
  })

  describe('getBuffer', () => {
    it('should return accumulated buffer contents', () => {
      const buffer = new WizardOutputBuffer(vi.fn())

      buffer.append('First ')
      buffer.append('Second ')
      buffer.append('Third')

      expect(buffer.getBuffer()).toBe('First Second Third')
    })
  })
})
