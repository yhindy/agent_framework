import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MinionsConfigService } from '../MinionsConfigService'
import type { MinionsConfig } from '../types/MinionsConfig'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as childProcess from 'child_process'

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  cpSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  rm: vi.fn(),
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

describe('MinionsConfigService', () => {
  let service: MinionsConfigService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MinionsConfigService()
  })

  describe('readConfig', () => {
    it('should read and parse valid minions.json', () => {
      const mockConfig: MinionsConfig = {
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

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig))

      const result = service.readConfig('/path/to/project')

      expect(result).toEqual(mockConfig)
      expect(fs.readFileSync).toHaveBeenCalledWith(
        '/path/to/project/minions.json',
        'utf-8'
      )
    })

    it('should return null when minions.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = service.readConfig('/path/to/project')

      expect(result).toBeNull()
      expect(fs.readFileSync).not.toHaveBeenCalled()
    })

    it('should return null when JSON is invalid', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }')

      const result = service.readConfig('/path/to/project')

      expect(result).toBeNull()
    })

    it('should return null when read fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied')
      })

      const result = service.readConfig('/path/to/project')

      expect(result).toBeNull()
    })
  })

  describe('writeConfig', () => {
    it('should write config as formatted JSON', () => {
      const config: MinionsConfig = {
        version: '2.0',
        project: {
          name: 'test-project',
          defaultBaseBranch: 'main',
        },
        setup: {
          filesToCopy: [],
          postSetupCommands: [],
        },
      }

      service.writeConfig('/path/to/project', config)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/project/minions.json',
        JSON.stringify(config, null, 2)
      )
    })

    it('should throw error when write fails', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Disk full')
      })

      const config: MinionsConfig = {
        version: '2.0',
        project: { name: 'test', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [] },
      }

      expect(() => service.writeConfig('/path/to/project', config)).toThrow('Disk full')
    })
  })

  describe('hasConfig', () => {
    it('should return true when minions.json exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const result = service.hasConfig('/path/to/project')

      expect(result).toBe(true)
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/project/minions.json')
    })

    it('should return false when minions.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = service.hasConfig('/path/to/project')

      expect(result).toBe(false)
    })
  })

  describe('hasLegacyConfig', () => {
    it('should return true when minions/config.json exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const result = service.hasLegacyConfig('/path/to/project')

      expect(result).toBe(true)
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/project/minions/config.json')
    })

    it('should return false when minions/config.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = service.hasLegacyConfig('/path/to/project')

      expect(result).toBe(false)
    })
  })

  describe('migrateFromLegacy', () => {
    const legacyConfig = {
      project: {
        name: 'legacy-project',
        defaultBaseBranch: 'master',
      },
      setup: {
        filesToCopy: [{ source: '.env.example', destination: '.env' }],
        postSetupCommands: ['npm install'],
        requiredFiles: ['package.json'],
        preflightCommands: ['npm test'],
      },
      assignments: [],
      testEnvironments: [],
    }

    beforeEach(() => {
      // Reset writeFileSync to default (non-throwing) implementation for each test
      vi.mocked(fs.writeFileSync).mockImplementation(() => {})
    })

    it('should migrate legacy config to new format', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions/config.json')) return true
          if (path.includes('.minions-base-info')) return false
          if (path.includes('.gitignore')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('config.json')) {
          return JSON.stringify(legacyConfig)
        }
        if (typeof path === 'string' && path.includes('.gitignore')) {
          return '# existing gitignore\nnode_modules/'
        }
        return ''
      })

      const result = await service.migrateFromLegacy('/path/to/project')

      expect(result.version).toBe('2.0')
      expect(result.project.name).toBe('legacy-project')
      expect(result.project.defaultBaseBranch).toBe('master')
      expect(result.setup.filesToCopy).toEqual(['.env.example'])
      expect(result.setup.postSetupCommands).toEqual(['npm install'])
      expect(result.setup.preflightCommands).toEqual(['npm test'])
      expect(result.setup.requiredFiles).toEqual(['package.json'])
    })

    it('should create backup before migration', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions/config.json')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig))

      await service.migrateFromLegacy('/path/to/project')

      // Should create backup directory
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/path/to/project/.minions-migration-backup',
        { recursive: true }
      )

      // Should copy legacy config to backup
      expect(fs.cpSync).toHaveBeenCalledWith(
        '/path/to/project/minions/config.json',
        '/path/to/project/.minions-migration-backup/config.json'
      )
    })

    it('should write migration state file', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions/config.json')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig))

      await service.migrateFromLegacy('/path/to/project')

      // Should write state file with 'started' step
      const stateFileCalls = vi.mocked(fs.writeFileSync).mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('migration-state')
      )
      expect(stateFileCalls.length).toBeGreaterThanOrEqual(1)
      const startedState = JSON.parse(stateFileCalls[0][1] as string)
      expect(startedState.step).toBe('started')
    })

    it('should rollback on failure', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions/config.json')) return true
          if (path.includes('minions.json')) return true
          if (path.includes('.minions')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig))

      // Make writeFileSync fail on minions.json write
      let callCount = 0
      vi.mocked(fs.writeFileSync).mockImplementation((path) => {
        callCount++
        if (typeof path === 'string' && path.includes('minions.json')) {
          throw new Error('Write failed')
        }
      })

      await expect(service.migrateFromLegacy('/path/to/project')).rejects.toThrow('Write failed')

      // Should attempt to remove partially created files
      expect(fs.unlinkSync).toHaveBeenCalledWith('/path/to/project/minions.json')
    })

    it('should cleanup backup and state file on success', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions/config.json')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig))

      await service.migrateFromLegacy('/path/to/project')

      // Should cleanup backup directory
      expect(fsPromises.rm).toHaveBeenCalledWith(
        '/path/to/project/.minions-migration-backup',
        { recursive: true, force: true }
      )

      // Should cleanup state file
      expect(fsPromises.rm).toHaveBeenCalledWith(
        '/path/to/project/.minions-migration-state.json',
        { force: true }
      )
    })

    it('should handle legacy filesToCopy with object format', async () => {
      const legacyWithObjects = {
        ...legacyConfig,
        setup: {
          ...legacyConfig.setup,
          filesToCopy: [
            { source: '.env.example', destination: '.env' },
            { source: 'config.sample.json', destination: 'config.json' },
          ],
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('minions/config.json')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyWithObjects))

      const result = await service.migrateFromLegacy('/path/to/project')

      expect(result.setup.filesToCopy).toEqual(['.env.example', 'config.sample.json'])
    })

    it('should handle legacy filesToCopy with string format', async () => {
      const legacyWithStrings = {
        ...legacyConfig,
        setup: {
          ...legacyConfig.setup,
          filesToCopy: ['.env', '.npmrc'],
        },
      }

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('minions/config.json')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyWithStrings))

      const result = await service.migrateFromLegacy('/path/to/project')

      expect(result.setup.filesToCopy).toEqual(['.env', '.npmrc'])
    })

    it('should migrate base agent info file', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('minions/config.json')) return true
          if (path.includes('.minions-base-info')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('.minions-base-info')) {
          return JSON.stringify({ agentId: 'base-agent', status: 'idle' })
        }
        return JSON.stringify(legacyConfig)
      })

      await service.migrateFromLegacy('/path/to/project')

      // Should copy base agent info to new location
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/project/.minions/base-agent.json',
        JSON.stringify({ agentId: 'base-agent', status: 'idle' })
      )

      // Should remove old file
      expect(fs.unlinkSync).toHaveBeenCalledWith('/path/to/project/.minions-base-info')
    })
  })

  describe('getDefaultConfig', () => {
    beforeEach(() => {
      // Default: no special files exist
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from('main\n'))
    })

    it('should return config with project name from directory', () => {
      const result = service.getDefaultConfig('/path/to/my-project')

      expect(result.project.name).toBe('my-project')
    })

    it('should detect Node.js project from package.json', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('package.json')
      })
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          name: 'my-node-app',
          scripts: {
            test: 'vitest',
            build: 'tsc',
            lint: 'eslint .',
          },
          devDependencies: {
            typescript: '^5.0.0',
          },
        })
      )

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.language).toBe('typescript')
      expect(result.detected?.packageManager).toBe('npm')
      expect(result.setup.testCommand).toBe('npm test')
      expect(result.setup.buildCommand).toBe('npm run build')
      expect(result.setup.lintCommand).toBe('npm run lint')
    })

    it('should detect Python project from requirements.txt', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('requirements.txt')
      })

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.language).toBe('python')
      expect(result.detected?.packageManager).toBe('pip')
    })

    it('should detect Python project from pyproject.toml', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('pyproject.toml')
      })

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.language).toBe('python')
      expect(result.detected?.packageManager).toBe('pip')
    })

    it('should detect Go project from go.mod', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('go.mod')
      })

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.language).toBe('go')
      expect(result.detected?.packageManager).toBe('go mod')
      expect(result.setup.testCommand).toBe('go test ./...')
      expect(result.setup.buildCommand).toBe('go build ./...')
    })

    it('should detect Rust project from Cargo.toml', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('Cargo.toml')
      })

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.language).toBe('rust')
      expect(result.detected?.packageManager).toBe('cargo')
      expect(result.setup.testCommand).toBe('cargo test')
      expect(result.setup.buildCommand).toBe('cargo build')
    })

    it('should detect default git branch as main', () => {
      vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from('main\n'))

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.project.defaultBaseBranch).toBe('main')
    })

    it('should detect default git branch as master', () => {
      vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from('master\n'))

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.project.defaultBaseBranch).toBe('master')
    })

    it('should fallback to main when git command fails', () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('Not a git repository')
      })

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.project.defaultBaseBranch).toBe('main')
    })

    it('should detect React framework', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('package.json')
      })
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          name: 'react-app',
          dependencies: {
            react: '^18.0.0',
          },
        })
      )

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.framework).toBe('react')
    })

    it('should detect yarn package manager from yarn.lock', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('package.json')) return true
          if (path.includes('yarn.lock')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'app' }))

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.packageManager).toBe('yarn')
    })

    it('should detect pnpm package manager from pnpm-lock.yaml', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('package.json')) return true
          if (path.includes('pnpm-lock.yaml')) return true
        }
        return false
      })
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'app' }))

      const result = service.getDefaultConfig('/path/to/project')

      expect(result.detected?.packageManager).toBe('pnpm')
    })
  })

  describe('initializeMinionsFolder', () => {
    it('should create .minions directory structure', () => {
      service.initializeMinionsFolder('/path/to/project')

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/path/to/project/.minions',
        { recursive: true }
      )
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/path/to/project/.minions/agents',
        { recursive: true }
      )
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/path/to/project/.minions/cache',
        { recursive: true }
      )
    })

    it('should handle existing directory gracefully', () => {
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        // mkdirSync with recursive: true doesn't throw for existing dirs
        return undefined
      })

      expect(() => service.initializeMinionsFolder('/path/to/project')).not.toThrow()
    })
  })

  describe('updateGitignore', () => {
    it('should add .minions/ to existing .gitignore', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('node_modules/\n.env\n')

      service.updateGitignore('/path/to/project')

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/project/.gitignore',
        expect.stringContaining('.minions/')
      )
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/project/.gitignore',
        expect.stringContaining('node_modules/')
      )
    })

    it('should create .gitignore if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      service.updateGitignore('/path/to/project')

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/project/.gitignore',
        expect.stringContaining('.minions/')
      )
    })

    it('should not duplicate .minions/ entry', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('node_modules/\n.minions/\n')

      service.updateGitignore('/path/to/project')

      // Should not write since .minions/ already exists
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should add section header comment', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('node_modules/\n')

      service.updateGitignore('/path/to/project')

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/project/.gitignore',
        expect.stringContaining('# Minions (AI Agent Framework)')
      )
    })
  })
})
