import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

/**
 * Integration test for install.sh script
 * Tests the codex CLI installation check feature
 */
describe('Install.sh Codex CLI Check', () => {
  let tmpDir: string
  let testProjectPath: string
  let installScriptPath: string

  beforeEach(() => {
    // Create a temporary test project directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-'))
    testProjectPath = path.join(tmpDir, 'test-project')

    // Initialize a git repository (install.sh expects a git repo)
    fs.mkdirSync(testProjectPath, { recursive: true })
    execSync('git init -b main', { cwd: testProjectPath, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: testProjectPath })
    execSync('git config user.name "Test User"', { cwd: testProjectPath })

    // Create initial commit so repo is valid
    fs.writeFileSync(path.join(testProjectPath, 'README.md'), '# Test Project')
    execSync('git add README.md', { cwd: testProjectPath })
    execSync('git commit -m "Initial commit"', { cwd: testProjectPath })

    // Get path to actual install.sh in the repo
    installScriptPath = path.resolve(__dirname, '../../../install.sh')
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('checks for codex CLI and displays warning if not found', () => {
    // Run install.sh with PATH that excludes codex
    // This simulates a system where codex is not installed
    const result = execSync(
      `PATH="/usr/bin:/bin" bash "${installScriptPath}" "${testProjectPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    )

    // Verify warning message is displayed
    expect(result).toContain('Warning')
    expect(result).toContain('Codex CLI not found')
    expect(result).toContain('install')

    // Verify installation still completed successfully (non-blocking)
    expect(result).toContain('Agent Framework installed')
    expect(fs.existsSync(path.join(testProjectPath, 'minions'))).toBe(true)
    expect(fs.existsSync(path.join(testProjectPath, 'minions/config.json'))).toBe(true)
  })

  it('does not display codex warning when codex is installed', () => {
    // Create a mock codex binary in a temporary bin directory
    const mockBinDir = path.join(tmpDir, 'mock-bin')
    fs.mkdirSync(mockBinDir, { recursive: true })
    const mockCodexPath = path.join(mockBinDir, 'codex')

    // Create executable mock script
    fs.writeFileSync(mockCodexPath, '#!/bin/bash\necho "codex mock"')
    fs.chmodSync(mockCodexPath, 0o755)

    // Run install.sh with PATH that includes our mock codex
    const result = execSync(
      `PATH="${mockBinDir}:/usr/bin:/bin" bash "${installScriptPath}" "${testProjectPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    )

    // Verify NO warning message is displayed
    expect(result).not.toContain('Codex CLI not found')

    // Verify installation still completed successfully
    expect(result).toContain('Agent Framework installed')
    expect(fs.existsSync(path.join(testProjectPath, 'minions'))).toBe(true)
  })

  it('installation continues successfully even when codex is not found', () => {
    // Run install.sh without codex
    execSync(
      `PATH="/usr/bin:/bin" bash "${installScriptPath}" "${testProjectPath}"`,
      { stdio: 'pipe' }
    )

    // Verify all expected files and directories were created
    expect(fs.existsSync(path.join(testProjectPath, 'minions'))).toBe(true)
    expect(fs.existsSync(path.join(testProjectPath, 'minions/assignments'))).toBe(true)
    expect(fs.existsSync(path.join(testProjectPath, 'minions/config.json'))).toBe(true)
    expect(fs.existsSync(path.join(testProjectPath, '.cursor/rules'))).toBe(true)
    expect(fs.existsSync(path.join(testProjectPath, '.cursor/rules/agent-rules.mdc'))).toBe(true)

    // Verify config.json is valid JSON
    const config = JSON.parse(
      fs.readFileSync(path.join(testProjectPath, 'minions/config.json'), 'utf-8')
    )
    expect(config.project).toBeDefined()
    expect(config.project.name).toBe('test-project')

    // Verify .gitignore was updated
    const gitignore = fs.readFileSync(path.join(testProjectPath, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.agent-info')
  })

  it('warning message includes installation instructions', () => {
    // Run install.sh without codex
    const result = execSync(
      `PATH="/usr/bin:/bin" bash "${installScriptPath}" "${testProjectPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    )

    // Verify warning includes helpful installation info
    expect(result).toContain('Warning')
    expect(result).toContain('Codex CLI')

    // Should mention how to install (npm or similar)
    const warningLowerCase = result.toLowerCase()
    expect(
      warningLowerCase.includes('npm') ||
      warningLowerCase.includes('install') ||
      warningLowerCase.includes('https://')
    ).toBe(true)
  })
})
