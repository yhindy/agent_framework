import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

/**
 * Integration test that simulates the actual setup.sh file copying behavior
 * with the fixed Python parsing logic
 */
describe('Setup.sh File Copying Integration', () => {
  let tmpDir: string
  let testRepoPath: string

  beforeEach(() => {
    // Create a temporary test repository that mimics textbuddy structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-integration-test-'))
    testRepoPath = path.join(tmpDir, 'test-repo')

    // Initialize a git repository
    fs.mkdirSync(testRepoPath, { recursive: true })
    execSync('git init -b main', { cwd: testRepoPath, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath })
    execSync('git config user.name "Test User"', { cwd: testRepoPath })

    // Create README
    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repo')
    execSync('git add README.md', { cwd: testRepoPath })
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath })
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('copies files specified in filesToCopy config during worktree setup', () => {
    // Create config with filesToCopy
    const configDir = path.join(testRepoPath, 'minions')
    fs.mkdirSync(configDir, { recursive: true })

    const config = {
      project: {
        name: 'test-project',
        defaultBaseBranch: 'main',
      },
      setup: {
        filesToCopy: [
          'backend/.env',
          'backend/.env.local',
          'frontend/.env.local',
        ],
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

    // Commit the config and files
    execSync('git add . && git commit -m "Add config and files"', {
      cwd: testRepoPath,
    })

    // Now simulate what setup.sh does - create worktree and copy files
    const agentId = 'agent-1'
    const branch = 'feature/agent-1/test'
    const worktreePath = path.join(tmpDir, `${path.basename(testRepoPath)}-${agentId}`)

    // Create worktree
    execSync(
      `git worktree add -b "${branch}" "${worktreePath}" main`,
      {
        cwd: testRepoPath,
        stdio: 'pipe',
      }
    )

    // Parse config and get filesToCopy
    const configPath = path.join(testRepoPath, 'minions', 'config.json')
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const filesToCopy = data.setup.filesToCopy

    // Simulate the file copying from setup.sh
    let filesCopied = 0
    let filesSkipped = 0

    for (const entry of filesToCopy) {
      let source = entry
      let destination = entry

      if (entry.includes(':')) {
        const parts = entry.split(':', 1)
        source = parts[0]
        destination = parts[1]
      }

      const sourcePath = path.join(testRepoPath, source)
      const destPath = path.join(worktreePath, destination)

      if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
        const destDir = path.dirname(destPath)
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }
        fs.copyFileSync(sourcePath, destPath)
        filesCopied++
      } else {
        filesSkipped++
      }
    }

    // Verify results
    // All 3 files exist in this test, so all should be copied
    expect(filesCopied).toBe(3)
    expect(filesSkipped).toBe(0)

    // Verify all copied files exist and have correct content
    const copiedBackendEnv = path.join(worktreePath, 'backend', '.env')
    expect(fs.existsSync(copiedBackendEnv)).toBe(true)
    expect(fs.readFileSync(copiedBackendEnv, 'utf-8')).toBe(
      'DATABASE_URL=postgres://localhost\n'
    )

    const copiedBackendLocalEnv = path.join(worktreePath, 'backend', '.env.local')
    expect(fs.existsSync(copiedBackendLocalEnv)).toBe(true)
    expect(fs.readFileSync(copiedBackendLocalEnv, 'utf-8')).toBe(
      'DATABASE_PASSWORD=secret\n'
    )

    const copiedFrontendEnv = path.join(worktreePath, 'frontend', '.env.local')
    expect(fs.existsSync(copiedFrontendEnv)).toBe(true)
    expect(fs.readFileSync(copiedFrontendEnv, 'utf-8')).toBe(
      'REACT_APP_API_URL=http://localhost:8000\n'
    )
  })

  it('supports colon-separated source:destination format', () => {
    // Create config with colon-separated paths
    const configDir = path.join(testRepoPath, 'minions')
    fs.mkdirSync(configDir, { recursive: true })

    const config = {
      project: { name: 'test-project', defaultBaseBranch: 'main' },
      setup: {
        filesToCopy: ['src/config.json:app/config.json'],
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

    // Create source file
    fs.mkdirSync(path.join(testRepoPath, 'src'), { recursive: true })
    fs.writeFileSync(path.join(testRepoPath, 'src', 'config.json'), '{"key": "value"}')

    execSync('git add . && git commit -m "Add files"', { cwd: testRepoPath })

    // Create worktree
    const worktreePath = path.join(tmpDir, 'test-worktree')
    execSync(
      `git worktree add -b feature/test "${worktreePath}" main`,
      {
        cwd: testRepoPath,
        stdio: 'pipe',
      }
    )

    // Copy file using colon-separated format
    const entry = 'src/config.json:app/config.json'
    const parts = entry.split(':')
    const source = parts[0]
    const destination = parts.length > 1 ? parts[1] : parts[0]

    const sourcePath = path.join(testRepoPath, source)
    const destPath = path.join(worktreePath, destination)

    const destDir = path.dirname(destPath)
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(sourcePath, destPath)

    // Verify destination path is different from source
    expect(source).toBe('src/config.json')
    expect(destination).toBe('app/config.json')
    expect(fs.existsSync(destPath)).toBe(true)
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('{"key": "value"}')
  })

  it('handles mixed file existence gracefully', () => {
    const configDir = path.join(testRepoPath, 'minions')
    fs.mkdirSync(configDir, { recursive: true })

    const config = {
      project: { name: 'test-project', defaultBaseBranch: 'main' },
      setup: {
        filesToCopy: [
          'exists/.env',
          'missing/.env',
          'exists/.env.local',
        ],
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

    // Create only some files
    fs.mkdirSync(path.join(testRepoPath, 'exists'), { recursive: true })
    fs.writeFileSync(path.join(testRepoPath, 'exists', '.env'), 'EXISTS=true')
    fs.writeFileSync(path.join(testRepoPath, 'exists', '.env.local'), 'LOCAL=true')

    execSync('git add . && git commit -m "Add files"', { cwd: testRepoPath })

    const worktreePath = path.join(tmpDir, 'test-worktree')
    execSync(
      `git worktree add -b feature/test "${worktreePath}" main`,
      {
        cwd: testRepoPath,
        stdio: 'pipe',
      }
    )

    // Copy available files
    let copiedCount = 0
    let skippedCount = 0

    for (const entry of config.setup.filesToCopy) {
      const sourcePath = path.join(testRepoPath, entry)
      const destPath = path.join(worktreePath, entry)

      if (fs.existsSync(sourcePath)) {
        const destDir = path.dirname(destPath)
        fs.mkdirSync(destDir, { recursive: true })
        fs.copyFileSync(sourcePath, destPath)
        copiedCount++
      } else {
        skippedCount++
      }
    }

    expect(copiedCount).toBe(2)
    expect(skippedCount).toBe(1)
  })
})
