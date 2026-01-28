import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Helper to find the project root (where the root package.json is)
function findProjectRoot(): string {
  let currentDir = __dirname
  // Go up max 10 levels to find the root
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(currentDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      // Root package.json has workspaces defined
      if (pkg.workspaces) {
        return currentDir
      }
    }
    currentDir = path.dirname(currentDir)
  }
  throw new Error('Could not find project root')
}

describe('Test Selection Infrastructure', () => {
  const projectRoot = findProjectRoot()
  const guiRoot = path.join(projectRoot, 'gui')
  const minionsRoot = path.join(projectRoot, 'minions')

  describe('package.json scripts', () => {
    it('should have test:changed script in root package.json', () => {
      const pkgPath = path.join(projectRoot, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts['test:changed']).toBeDefined()
      expect(pkg.scripts['test:changed']).toContain('test:changed')
      expect(pkg.scripts['test:changed']).toContain('max-old-space-size')
    })

    it('should have test:smart script in root package.json', () => {
      const pkgPath = path.join(projectRoot, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts['test:smart']).toBeDefined()
      expect(pkg.scripts['test:smart']).toContain('test:changed')
    })

    it('should have test:changed script in gui package.json', () => {
      const pkgPath = path.join(guiRoot, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts['test:changed']).toBeDefined()
      expect(pkg.scripts['test:changed']).toContain('--changed')
    })

    it('should have test:related script in gui package.json', () => {
      const pkgPath = path.join(guiRoot, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts['test:related']).toBeDefined()
      expect(pkg.scripts['test:related']).toContain('related')
    })

    it('should have test:memory script in gui package.json', () => {
      const pkgPath = path.join(guiRoot, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts['test:memory']).toBeDefined()
      expect(pkg.scripts['test:memory']).toContain('max-old-space-size')
    })

    it('should have test:changed script in minions package.json', () => {
      const pkgPath = path.join(minionsRoot, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      expect(pkg.scripts['test:changed']).toBeDefined()
      expect(pkg.scripts['test:changed']).toContain('--changed')
    })
  })

  describe('vitest configuration', () => {
    it('should have pool configuration in main vitest config', () => {
      const configPath = path.join(guiRoot, 'vitest.config.ts')
      const configContent = fs.readFileSync(configPath, 'utf-8')
      expect(configContent).toContain("pool: 'forks'")
      expect(configContent).toContain('maxWorkers: 4')
      expect(configContent).toContain('poolOptions')
    })

    it('should have pool configuration in renderer vitest config', () => {
      const configPath = path.join(guiRoot, 'vitest.config.renderer.ts')
      const configContent = fs.readFileSync(configPath, 'utf-8')
      expect(configContent).toContain("pool: 'forks'")
      expect(configContent).toContain('maxWorkers: 4')
      expect(configContent).toContain('poolOptions')
    })

    it('should have pool configuration in minions vitest config', () => {
      const configPath = path.join(minionsRoot, 'vitest.config.ts')
      const configContent = fs.readFileSync(configPath, 'utf-8')
      expect(configContent).toContain("pool: 'forks'")
      expect(configContent).toContain('maxWorkers: 4')
    })
  })

  describe('documentation updates', () => {
    it('should mention test:changed in CLAUDE.md', () => {
      const claudePath = path.join(projectRoot, 'CLAUDE.md')
      const claudeContent = fs.readFileSync(claudePath, 'utf-8')
      expect(claudeContent).toContain('test:changed')
      expect(claudeContent).toContain('memory-efficient')
    })

    it('should mention test:changed in agent-rules.mdc', () => {
      const rulesPath = path.join(minionsRoot, 'rules/agent-rules.mdc')
      const rulesContent = fs.readFileSync(rulesPath, 'utf-8')
      expect(rulesContent).toContain('test:changed')
      expect(rulesContent).toContain('Memory Management')
    })

    it('should mention test:changed in bundled agent-rules.mdc', () => {
      const rulesPath = path.join(guiRoot, 'resources/minions/rules/agent-rules.mdc')
      const rulesContent = fs.readFileSync(rulesPath, 'utf-8')
      expect(rulesContent).toContain('test:changed')
      expect(rulesContent).toContain('Memory Management')
    })
  })

  describe('helper scripts', () => {
    it('should have suggest-tests.js script', () => {
      const scriptPath = path.join(projectRoot, '.github/scripts/suggest-tests.js')
      expect(fs.existsSync(scriptPath)).toBe(true)
    })

    it('suggest-tests.js should be executable', () => {
      const scriptPath = path.join(projectRoot, '.github/scripts/suggest-tests.js')
      const stats = fs.statSync(scriptPath)
      // Check if file has execute permission (for owner)
      expect(stats.mode & 0o100).toBeTruthy()
    })

    it('suggest-tests.js should contain git diff logic', () => {
      const scriptPath = path.join(projectRoot, '.github/scripts/suggest-tests.js')
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8')
      expect(scriptContent).toContain('git diff')
      expect(scriptContent).toContain('test:changed')
      expect(scriptContent).toContain('vitest')
      expect(scriptContent).toContain('config')
    })
  })
})
