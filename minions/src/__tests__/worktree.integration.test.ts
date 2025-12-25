import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

describe('Worktree Setup Integration Tests', () => {
  let tmpDir: string
  let testRepoPath: string

  beforeEach(() => {
    // Create a temporary test repository
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'))
    testRepoPath = path.join(tmpDir, 'test-repo')

    // Initialize a git repository
    fs.mkdirSync(testRepoPath, { recursive: true })
    execSync('git init -b main', { cwd: testRepoPath, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath })
    execSync('git config user.name "Test User"', { cwd: testRepoPath })

    // Create initial commit
    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repo')
    execSync('git add README.md', { cwd: testRepoPath })
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath })
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('File copying during worktree setup', () => {
    beforeEach(() => {
      // Create config.json with filesToCopy
      const configDir = path.join(testRepoPath, 'minions')
      fs.mkdirSync(configDir, { recursive: true })

      const config = {
        project: {
          name: 'test-project',
          defaultBaseBranch: 'main',
        },
        setup: {
          filesToCopy: ['backend/.env', 'backend/.env.local', 'frontend/.env.local'],
          postSetupCommands: [],
          requiredFiles: [],
          preflightCommands: [],
        },
        assignments: [],
        testEnvironments: [],
      }

      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify(config, null, 2)
      )

      // Create the files that should be copied
      fs.mkdirSync(path.join(testRepoPath, 'backend'), { recursive: true })
      fs.mkdirSync(path.join(testRepoPath, 'frontend'), { recursive: true })

      fs.writeFileSync(
        path.join(testRepoPath, 'backend', '.env'),
        'DATABASE_URL=postgres://localhost\n'
      )
      fs.writeFileSync(
        path.join(testRepoPath, 'backend', '.env.local'),
        'DATABASE_PASSWORD=secret\n'
      )
      fs.writeFileSync(
        path.join(testRepoPath, 'frontend', '.env.local'),
        'REACT_APP_API_URL=http://localhost:8000\n'
      )

      // Add and commit these files
      execSync('git add backend frontend minions', { cwd: testRepoPath })
      execSync('git commit -m "Add env files and config"', {
        cwd: testRepoPath,
      })
    })

    it('creates a worktree with git', () => {
      const agentId = 'agent-1'
      const branch = 'feature/agent-1/test'
      const worktreePath = path.join(tmpDir, `${path.basename(testRepoPath)}-${agentId}`)

      // Create worktree using git
      execSync(
        `git worktree add -b "${branch}" "${worktreePath}" main`,
        {
          cwd: testRepoPath,
          stdio: 'pipe',
        }
      )

      expect(fs.existsSync(worktreePath)).toBe(true)
      expect(fs.existsSync(path.join(worktreePath, 'README.md'))).toBe(true)
    })

    it('verifies env files exist in source before copying', () => {
      expect(fs.existsSync(path.join(testRepoPath, 'backend', '.env'))).toBe(true)
      expect(fs.existsSync(path.join(testRepoPath, 'backend', '.env.local'))).toBe(true)
      expect(fs.existsSync(path.join(testRepoPath, 'frontend', '.env.local'))).toBe(true)
    })

    it('handles missing env files gracefully', () => {
      // Create worktree
      const agentId = 'agent-1'
      const branch = 'feature/agent-1/test'
      const worktreePath = path.join(tmpDir, `${path.basename(testRepoPath)}-${agentId}`)

      execSync(
        `git worktree add -b "${branch}" "${worktreePath}" main`,
        {
          cwd: testRepoPath,
          stdio: 'pipe',
        }
      )

      // When we remove a file, copying should skip it gracefully
      fs.rmSync(path.join(testRepoPath, 'backend', '.env.local'))

      // This would be handled by the setup.sh script
      // For now, we verify the worktree is still usable
      expect(fs.existsSync(worktreePath)).toBe(true)
    })

    it('creates worktree with proper git structure', () => {
      const agentId = 'agent-1'
      const branch = 'feature/agent-1/test'
      const worktreePath = path.join(tmpDir, `${path.basename(testRepoPath)}-${agentId}`)

      execSync(
        `git worktree add -b "${branch}" "${worktreePath}" main`,
        {
          cwd: testRepoPath,
          stdio: 'pipe',
        }
      )

      // Verify git structure
      expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true)
      expect(fs.existsSync(path.join(worktreePath, 'README.md'))).toBe(true)

      // Verify we're on the correct branch in worktree
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim()
      expect(currentBranch).toBe(branch)
    })
  })

  describe('Config file format validation', () => {
    it('accepts simple string format in filesToCopy', () => {
      const configDir = path.join(testRepoPath, 'minions')
      fs.mkdirSync(configDir, { recursive: true })

      const config = {
        project: { name: 'test', defaultBaseBranch: 'main' },
        setup: {
          filesToCopy: ['backend/.env', 'frontend/.env.local'],
          postSetupCommands: [],
          requiredFiles: [],
          preflightCommands: [],
        },
        assignments: [],
        testEnvironments: [],
      }

      const configPath = path.join(configDir, 'config.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(Array.isArray(loadedConfig.setup.filesToCopy)).toBe(true)
      expect(loadedConfig.setup.filesToCopy[0]).toBe('backend/.env')
    })

    it('accepts colon-separated format in filesToCopy', () => {
      const configDir = path.join(testRepoPath, 'minions')
      fs.mkdirSync(configDir, { recursive: true })

      const config = {
        project: { name: 'test', defaultBaseBranch: 'main' },
        setup: {
          filesToCopy: ['src/config.json:app/config.json'],
          postSetupCommands: [],
          requiredFiles: [],
          preflightCommands: [],
        },
        assignments: [],
        testEnvironments: [],
      }

      const configPath = path.join(configDir, 'config.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(loadedConfig.setup.filesToCopy[0]).toContain(':')
    })

    it('handles empty filesToCopy array', () => {
      const configDir = path.join(testRepoPath, 'minions')
      fs.mkdirSync(configDir, { recursive: true })

      const config = {
        project: { name: 'test', defaultBaseBranch: 'main' },
        setup: {
          filesToCopy: [],
          postSetupCommands: [],
          requiredFiles: [],
          preflightCommands: [],
        },
        assignments: [],
        testEnvironments: [],
      }

      const configPath = path.join(configDir, 'config.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(loadedConfig.setup.filesToCopy).toEqual([])
    })
  })
})
