import { describe, it, expect } from 'vitest'
import type {
  MinionsConfig,
  MinionsConfigProject,
  MinionsConfigSetup,
  MinionsConfigDetected,
  MinionsConfigWizard,
  WizardSession,
  WizardSessionStatus
} from '../types/MinionsConfig'
import {
  createDefaultMinionsConfig,
  isValidMinionsConfig,
  WIZARD_SESSION_STATUSES,
  DEFAULT_WIZARD_TIMEOUT_MS
} from '../types/MinionsConfig'

/**
 * Tests for MinionsConfig type definitions (v2.0 schema)
 * These types define the structure of the minions.json configuration file.
 */
describe('MinionsConfig Types', () => {
  describe('MinionsConfig interface', () => {
    it('should accept a valid minimal MinionsConfig', () => {
      const config: MinionsConfig = {
        version: '2.0',
        project: {
          name: 'my-project',
          defaultBaseBranch: 'main'
        },
        setup: {
          filesToCopy: [],
          postSetupCommands: []
        }
      }

      expect(config.version).toBe('2.0')
      expect(config.project.name).toBe('my-project')
      expect(config.project.defaultBaseBranch).toBe('main')
      expect(config.setup.filesToCopy).toEqual([])
      expect(config.setup.postSetupCommands).toEqual([])
    })

    it('should accept a complete MinionsConfig with all optional fields', () => {
      const config: MinionsConfig = {
        version: '2.0',
        project: {
          name: 'agent-framework',
          defaultBaseBranch: 'main',
          description: 'A framework for running AI coding agents'
        },
        setup: {
          filesToCopy: ['.env.example', '.nvmrc'],
          postSetupCommands: ['npm install', 'npm run build'],
          preflightCommands: ['git status'],
          requiredFiles: ['package.json', 'tsconfig.json'],
          buildCommand: 'npm run build',
          testCommand: 'npm test',
          lintCommand: 'npm run lint'
        },
        detected: {
          language: 'typescript',
          framework: 'electron',
          packageManager: 'npm',
          detectedAt: '2024-01-15T10:30:00Z'
        },
        wizard: {
          completedAt: '2024-01-15T10:35:00Z',
          agentSessionId: 'session-abc123'
        }
      }

      expect(config.version).toBe('2.0')
      expect(config.project.description).toBe('A framework for running AI coding agents')
      expect(config.setup.filesToCopy).toContain('.env.example')
      expect(config.setup.buildCommand).toBe('npm run build')
      expect(config.detected?.language).toBe('typescript')
      expect(config.detected?.framework).toBe('electron')
      expect(config.wizard?.completedAt).toBeDefined()
    })

    it('should only accept version 2.0', () => {
      const config: MinionsConfig = {
        version: '2.0',
        project: {
          name: 'test',
          defaultBaseBranch: 'main'
        },
        setup: {
          filesToCopy: [],
          postSetupCommands: []
        }
      }

      // TypeScript enforces version: '2.0' at compile time
      expect(config.version).toBe('2.0')
    })
  })

  describe('MinionsConfigProject interface', () => {
    it('should require name and defaultBaseBranch', () => {
      const project: MinionsConfigProject = {
        name: 'test-project',
        defaultBaseBranch: 'develop'
      }

      expect(project.name).toBe('test-project')
      expect(project.defaultBaseBranch).toBe('develop')
    })

    it('should allow optional description', () => {
      const project: MinionsConfigProject = {
        name: 'test-project',
        defaultBaseBranch: 'main',
        description: 'A test project for unit testing'
      }

      expect(project.description).toBe('A test project for unit testing')
    })
  })

  describe('MinionsConfigSetup interface', () => {
    it('should require filesToCopy and postSetupCommands', () => {
      const setup: MinionsConfigSetup = {
        filesToCopy: ['.env.local'],
        postSetupCommands: ['pnpm install']
      }

      expect(setup.filesToCopy).toEqual(['.env.local'])
      expect(setup.postSetupCommands).toEqual(['pnpm install'])
    })

    it('should accept all optional command fields', () => {
      const setup: MinionsConfigSetup = {
        filesToCopy: [],
        postSetupCommands: [],
        preflightCommands: ['git fetch'],
        requiredFiles: ['Cargo.toml'],
        buildCommand: 'cargo build',
        testCommand: 'cargo test',
        lintCommand: 'cargo clippy'
      }

      expect(setup.preflightCommands).toEqual(['git fetch'])
      expect(setup.requiredFiles).toEqual(['Cargo.toml'])
      expect(setup.buildCommand).toBe('cargo build')
      expect(setup.testCommand).toBe('cargo test')
      expect(setup.lintCommand).toBe('cargo clippy')
    })
  })

  describe('MinionsConfigDetected interface', () => {
    it('should require language and detectedAt', () => {
      const detected: MinionsConfigDetected = {
        language: 'python',
        detectedAt: '2024-01-15T12:00:00Z'
      }

      expect(detected.language).toBe('python')
      expect(detected.detectedAt).toBe('2024-01-15T12:00:00Z')
    })

    it('should accept optional framework and packageManager', () => {
      const detected: MinionsConfigDetected = {
        language: 'python',
        framework: 'django',
        packageManager: 'pip',
        detectedAt: '2024-01-15T12:00:00Z'
      }

      expect(detected.framework).toBe('django')
      expect(detected.packageManager).toBe('pip')
    })
  })

  describe('MinionsConfigWizard interface', () => {
    it('should require completedAt', () => {
      const wizard: MinionsConfigWizard = {
        completedAt: '2024-01-15T14:00:00Z'
      }

      expect(wizard.completedAt).toBe('2024-01-15T14:00:00Z')
    })

    it('should accept optional agentSessionId', () => {
      const wizard: MinionsConfigWizard = {
        completedAt: '2024-01-15T14:00:00Z',
        agentSessionId: 'wizard-session-xyz789'
      }

      expect(wizard.agentSessionId).toBe('wizard-session-xyz789')
    })
  })

  describe('createDefaultMinionsConfig helper', () => {
    it('should create a valid default config with required fields', () => {
      const config = createDefaultMinionsConfig('my-app', 'main')

      expect(config.version).toBe('2.0')
      expect(config.project.name).toBe('my-app')
      expect(config.project.defaultBaseBranch).toBe('main')
      expect(config.setup.filesToCopy).toEqual([])
      expect(config.setup.postSetupCommands).toEqual([])
    })

    it('should create a valid MinionsConfig that passes type checking', () => {
      const config = createDefaultMinionsConfig('test-project', 'develop')

      // Verify the config satisfies the MinionsConfig interface
      const validConfig: MinionsConfig = config
      expect(validConfig).toBeDefined()
      expect(isValidMinionsConfig(config)).toBe(true)
    })
  })

  describe('isValidMinionsConfig validator', () => {
    it('should return true for valid config', () => {
      const config: MinionsConfig = {
        version: '2.0',
        project: {
          name: 'test',
          defaultBaseBranch: 'main'
        },
        setup: {
          filesToCopy: [],
          postSetupCommands: []
        }
      }

      expect(isValidMinionsConfig(config)).toBe(true)
    })

    it('should return false for invalid version', () => {
      const config = {
        version: '1.0',
        project: {
          name: 'test',
          defaultBaseBranch: 'main'
        },
        setup: {
          filesToCopy: [],
          postSetupCommands: []
        }
      }

      expect(isValidMinionsConfig(config)).toBe(false)
    })

    it('should return false for missing required fields', () => {
      const configMissingProject = {
        version: '2.0',
        setup: {
          filesToCopy: [],
          postSetupCommands: []
        }
      }

      const configMissingSetup = {
        version: '2.0',
        project: {
          name: 'test',
          defaultBaseBranch: 'main'
        }
      }

      expect(isValidMinionsConfig(configMissingProject)).toBe(false)
      expect(isValidMinionsConfig(configMissingSetup)).toBe(false)
    })

    it('should return false for null or undefined', () => {
      expect(isValidMinionsConfig(null)).toBe(false)
      expect(isValidMinionsConfig(undefined)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(isValidMinionsConfig('string')).toBe(false)
      expect(isValidMinionsConfig(123)).toBe(false)
      expect(isValidMinionsConfig([])).toBe(false)
    })
  })
})

/**
 * Tests for WizardSession type definitions
 * These types track the state of the setup wizard during project initialization.
 */
describe('WizardSession Types', () => {
  describe('WizardSession interface', () => {
    it('should accept a valid minimal WizardSession', () => {
      const session: WizardSession = {
        id: 'wizard-123',
        projectPath: '/Users/dev/my-project',
        agentId: 'agent-456',
        status: 'analyzing',
        startedAt: '2024-01-15T10:00:00Z',
        timeoutMs: 300000
      }

      expect(session.id).toBe('wizard-123')
      expect(session.projectPath).toBe('/Users/dev/my-project')
      expect(session.agentId).toBe('agent-456')
      expect(session.status).toBe('analyzing')
      expect(session.startedAt).toBe('2024-01-15T10:00:00Z')
      expect(session.timeoutMs).toBe(300000)
    })

    it('should accept a complete WizardSession with all optional fields', () => {
      const session: WizardSession = {
        id: 'wizard-789',
        projectPath: '/Users/dev/completed-project',
        agentId: 'agent-999',
        status: 'complete',
        config: {
          version: '2.0',
          project: {
            name: 'completed-project',
            defaultBaseBranch: 'main'
          },
          setup: {
            filesToCopy: ['.env'],
            postSetupCommands: ['npm install']
          }
        },
        claudeMdGenerated: true,
        startedAt: '2024-01-15T10:00:00Z',
        timeoutMs: 300000,
        error: undefined
      }

      expect(session.status).toBe('complete')
      expect(session.config?.project?.name).toBe('completed-project')
      expect(session.claudeMdGenerated).toBe(true)
    })

    it('should accept partial config during wizard progress', () => {
      const session: WizardSession = {
        id: 'wizard-partial',
        projectPath: '/Users/dev/in-progress',
        agentId: 'agent-partial',
        status: 'questioning',
        config: {
          version: '2.0',
          project: {
            name: 'in-progress',
            defaultBaseBranch: 'main'
          }
          // setup not yet determined
        } as Partial<MinionsConfig>,
        startedAt: '2024-01-15T10:00:00Z',
        timeoutMs: 300000
      }

      expect(session.status).toBe('questioning')
      expect(session.config?.project?.name).toBe('in-progress')
    })
  })

  describe('WizardSessionStatus type', () => {
    it('should accept all valid status values', () => {
      const statuses: WizardSessionStatus[] = [
        'analyzing',
        'questioning',
        'generating',
        'complete',
        'cancelled',
        'timeout',
        'error'
      ]

      expect(statuses).toHaveLength(7)
      statuses.forEach(status => {
        const session: WizardSession = {
          id: 'test',
          projectPath: '/test',
          agentId: 'agent',
          status,
          startedAt: '2024-01-15T10:00:00Z',
          timeoutMs: 300000
        }
        expect(session.status).toBe(status)
      })
    })
  })

  describe('WizardSession error states', () => {
    it('should include error message when status is error', () => {
      const session: WizardSession = {
        id: 'wizard-error',
        projectPath: '/Users/dev/failed-project',
        agentId: 'agent-error',
        status: 'error',
        startedAt: '2024-01-15T10:00:00Z',
        timeoutMs: 300000,
        error: 'Failed to parse project structure: invalid package.json'
      }

      expect(session.status).toBe('error')
      expect(session.error).toBe('Failed to parse project structure: invalid package.json')
    })

    it('should handle timeout status', () => {
      const session: WizardSession = {
        id: 'wizard-timeout',
        projectPath: '/Users/dev/slow-project',
        agentId: 'agent-timeout',
        status: 'timeout',
        startedAt: '2024-01-15T10:00:00Z',
        timeoutMs: 300000,
        error: 'Wizard timeout: No configuration received within 5 minutes'
      }

      expect(session.status).toBe('timeout')
      expect(session.error).toContain('timeout')
    })

    it('should handle cancelled status', () => {
      const session: WizardSession = {
        id: 'wizard-cancelled',
        projectPath: '/Users/dev/cancelled-project',
        agentId: 'agent-cancelled',
        status: 'cancelled',
        startedAt: '2024-01-15T10:00:00Z',
        timeoutMs: 300000
      }

      expect(session.status).toBe('cancelled')
      expect(session.error).toBeUndefined()
    })
  })

  describe('WIZARD_SESSION_STATUSES constant', () => {
    it('should contain all valid status values', () => {
      expect(WIZARD_SESSION_STATUSES).toContain('analyzing')
      expect(WIZARD_SESSION_STATUSES).toContain('questioning')
      expect(WIZARD_SESSION_STATUSES).toContain('generating')
      expect(WIZARD_SESSION_STATUSES).toContain('complete')
      expect(WIZARD_SESSION_STATUSES).toContain('cancelled')
      expect(WIZARD_SESSION_STATUSES).toContain('timeout')
      expect(WIZARD_SESSION_STATUSES).toContain('error')
      expect(WIZARD_SESSION_STATUSES).toHaveLength(7)
    })
  })

  describe('DEFAULT_WIZARD_TIMEOUT_MS constant', () => {
    it('should be 5 minutes (300000ms)', () => {
      expect(DEFAULT_WIZARD_TIMEOUT_MS).toBe(300000)
    })
  })
})
