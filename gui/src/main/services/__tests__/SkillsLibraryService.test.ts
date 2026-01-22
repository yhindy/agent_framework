import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { SkillsLibraryService } from '../SkillsLibraryService'
import { DEFAULT_SKILLS_LIBRARY_SETTINGS } from '../types/SkillsLibraryTypes'

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn()
}))

// Mock chokidar
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn()
    }))
  }
}))

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockReaddirSync = vi.mocked(readdirSync)
const mockStatSync = vi.mocked(statSync)

const TEST_CLAUDE_DIR = '/test/.claude'
const TEST_PROJECT_PATH = '/test/project'

describe('SkillsLibraryService', () => {
  let service: SkillsLibraryService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SkillsLibraryService(TEST_CLAUDE_DIR)
  })

  afterEach(() => {
    service.cleanup()
  })

  describe('getVercelSkillsPath', () => {
    it('should return correct path for Vercel skills', () => {
      expect(service.getVercelSkillsPath()).toBe(join(TEST_CLAUDE_DIR, 'skills'))
    })
  })

  describe('getProjectSkillsPath', () => {
    it('should return null when no project is set', () => {
      expect(service.getProjectSkillsPath()).toBeNull()
    })

    it('should return correct path when project is set', () => {
      service.setProjectPath(TEST_PROJECT_PATH)
      expect(service.getProjectSkillsPath()).toBe(join(TEST_PROJECT_PATH, '.claude', 'skills'))
    })

    it('should use provided projectPath argument', () => {
      expect(service.getProjectSkillsPath('/custom/path')).toBe(join('/custom/path', '.claude', 'skills'))
    })
  })

  describe('scan', () => {
    it('should return empty result when skills directory does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const result = service.scan()

      expect(result.vercelSkills).toHaveLength(0)
      expect(result.projectSkills).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should discover Vercel skills from ~/.claude/skills/', () => {
      setupMockVercelSkill()

      const result = service.scan()

      expect(result.vercelSkills).toHaveLength(1)
      expect(result.vercelSkills[0].name).toBe('Deploy')
      expect(result.vercelSkills[0].id).toBe('vercel:deploy')
    })

    it('should discover project skills', () => {
      service.setProjectPath(TEST_PROJECT_PATH)
      setupMockProjectSkill()

      const result = service.scan(TEST_PROJECT_PATH)

      expect(result.projectSkills).toHaveLength(1)
      expect(result.projectSkills[0].name).toBe('Custom Lint')
      expect(result.projectSkills[0].id).toBe('project:custom-lint')
    })

    it('should parse skill scripts', () => {
      setupMockVercelSkillWithScripts()

      const result = service.scan()

      expect(result.vercelSkills[0].scripts).toHaveLength(1)
      expect(result.vercelSkills[0].scripts[0].name).toBe('deploy')
      expect(result.vercelSkills[0].scripts[0].content).toContain('#!/bin/bash')
    })

    it('should parse skill references', () => {
      setupMockVercelSkillWithReferences()

      const result = service.scan()

      expect(result.vercelSkills[0].references).toHaveLength(1)
      expect(result.vercelSkills[0].references[0].name).toBe('rules.md')
    })

    it('should handle parse errors gracefully', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'skills')) return ['broken-skill'] as any
        return [] as any
      })
      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
      // SKILL.md does not exist in this skill directory

      const result = service.scan()

      expect(result.vercelSkills).toHaveLength(0) // Skill skipped due to missing SKILL.md
    })

    it('should skip directories without SKILL.md', () => {
      mockExistsSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'skills')) return true
        if (String(path).includes('SKILL.md')) return false
        return true
      })
      mockReaddirSync.mockReturnValue(['no-skill-file'] as any)
      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)

      const result = service.scan()

      expect(result.vercelSkills).toHaveLength(0)
    })
  })

  describe('frontmatter parsing', () => {
    it('should parse YAML frontmatter correctly', () => {
      setupMockVercelSkillWithFrontmatter('---\nname: Custom Name\ndescription: Custom description\n---\n\nContent')

      const result = service.scan()

      expect(result.vercelSkills[0].name).toBe('Custom Name')
      expect(result.vercelSkills[0].description).toBe('Custom description')
    })

    it('should use filename as name when no frontmatter', () => {
      setupMockVercelSkillWithFrontmatter('# Deploy Skill\n\nThis is how to deploy.')

      const result = service.scan()

      expect(result.vercelSkills[0].name).toBe('Deploy') // Formatted from 'deploy' directory
    })

    it('should extract first paragraph as description when not in frontmatter', () => {
      setupMockVercelSkillWithFrontmatter('---\nname: Test\n---\n\n# Heading\n\nFirst paragraph here.\n\nSecond paragraph.')

      const result = service.scan()

      expect(result.vercelSkills[0].description).toBe('First paragraph here.')
    })

    it('should truncate long descriptions', () => {
      const longDesc = 'A'.repeat(300)
      setupMockVercelSkillWithFrontmatter(`---\nname: Test\n---\n\n${longDesc}`)

      const result = service.scan()

      expect(result.vercelSkills[0].description.length).toBeLessThanOrEqual(200)
      expect(result.vercelSkills[0].description.endsWith('...')).toBe(true)
    })

    it('should handle quoted strings in YAML', () => {
      setupMockVercelSkillWithFrontmatter('---\nname: "Quoted Name"\ndescription: \'Single quoted\'\n---\n\nContent')

      const result = service.scan()

      expect(result.vercelSkills[0].name).toBe('Quoted Name')
      expect(result.vercelSkills[0].description).toBe('Single quoted')
    })

    it('should handle array values in YAML', () => {
      setupMockVercelSkillWithFrontmatter('---\nname: Test\ntriggers: [deploy, build]\n---\n\nContent')

      const result = service.scan()

      expect(result.errors).toHaveLength(0)
    })
  })

  describe('settings management', () => {
    it('should return default settings initially', () => {
      const settings = service.getSettings()
      expect(settings).toEqual(DEFAULT_SKILLS_LIBRARY_SETTINGS)
    })

    it('should update settings', () => {
      const updated = service.updateSettings({ vercelSkillsEnabled: false })

      expect(updated.vercelSkillsEnabled).toBe(false)
      expect(service.getSettings().vercelSkillsEnabled).toBe(false)
    })

    it('should not scan Vercel skills when disabled', () => {
      service.updateSettings({ vercelSkillsEnabled: false })
      setupMockVercelSkill()

      const result = service.scan()

      expect(result.vercelSkills).toHaveLength(0)
    })

    it('should not scan project skills when disabled', () => {
      service.setProjectPath(TEST_PROJECT_PATH)
      service.updateSettings({ projectSkillsEnabled: false })
      setupMockProjectSkill()

      const result = service.scan(TEST_PROJECT_PATH)

      expect(result.projectSkills).toHaveLength(0)
    })
  })

  describe('getEnabledSkills', () => {
    it('should return all skills when none disabled', () => {
      setupMockVercelSkill()

      const enabled = service.getEnabledSkills()

      expect(enabled).toHaveLength(1)
    })

    it('should filter out disabled skills', () => {
      setupMockVercelSkill()
      service.updateSettings({ disabledSkillIds: ['vercel:deploy'] })

      const enabled = service.getEnabledSkills()

      expect(enabled).toHaveLength(0)
    })
  })

  describe('watching', () => {
    it('should start watching when skills directory exists', () => {
      mockExistsSync.mockReturnValue(true)

      service.startWatching()

      expect(chokidar.watch).toHaveBeenCalled()
    })

    it('should not start watching when no directories exist', () => {
      mockExistsSync.mockReturnValue(false)

      service.startWatching()

      expect(chokidar.watch).not.toHaveBeenCalled()
    })

    it('should stop watching on cleanup', () => {
      mockExistsSync.mockReturnValue(true)
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn()
      }
      vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any)

      service.startWatching()
      service.cleanup()

      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('should not start watching twice', () => {
      mockExistsSync.mockReturnValue(true)
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn()
      }
      vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any)

      service.startWatching()
      service.startWatching()

      expect(chokidar.watch).toHaveBeenCalledTimes(1)
    })
  })

  describe('setWindow', () => {
    it('should set the main window for IPC notifications', () => {
      const mockWindow = {
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: {
          send: vi.fn()
        }
      } as any

      service.setWindow(mockWindow)
      setupMockVercelSkill()
      service.refresh()

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'skillsLibrary:updated',
        expect.objectContaining({
          vercelSkills: expect.any(Array)
        })
      )
    })

    it('should not send IPC when window is destroyed', () => {
      const mockWindow = {
        isDestroyed: vi.fn().mockReturnValue(true),
        webContents: {
          send: vi.fn()
        }
      } as any

      service.setWindow(mockWindow)
      setupMockVercelSkill()
      service.refresh()

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('getScanResult', () => {
    it('should scan on first call', () => {
      setupMockVercelSkill()

      const result = service.getScanResult()

      expect(result.vercelSkills).toHaveLength(1)
    })

    it('should return cached result on subsequent calls', () => {
      setupMockVercelSkill()

      const result1 = service.getScanResult()
      const result2 = service.getScanResult()

      expect(result1).toBe(result2)
    })
  })

  describe('refresh', () => {
    it('should clear cache and re-scan', () => {
      setupMockVercelSkill()

      const result1 = service.getScanResult()

      // Change mock to return no skills
      mockExistsSync.mockReturnValue(false)

      const result2 = service.refresh()

      expect(result1.vercelSkills).toHaveLength(1)
      expect(result2.vercelSkills).toHaveLength(0)
    })
  })

  describe('setProjectPath', () => {
    it('should clear cache when project changes', () => {
      setupMockVercelSkill()
      const result1 = service.getScanResult()

      service.setProjectPath('/new/project')

      // Should return fresh scan, not cached
      const result2 = service.getScanResult()
      expect(result1).not.toBe(result2)
    })
  })

  describe('script description extraction', () => {
    it('should extract description from first comment line', () => {
      setupMockVercelSkillWithScripts()

      const result = service.scan()

      expect(result.vercelSkills[0].scripts[0].description).toBe('Deploy to production')
    })

    it('should skip shebang when extracting description', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'skills')) return ['test-skill'] as any
        if (String(path).includes('scripts')) return ['run.sh'] as any
        return [] as any
      })
      mockStatSync.mockImplementation((path) => ({
        isDirectory: () => !String(path).endsWith('.sh') && !String(path).endsWith('.md'),
        isFile: () => String(path).endsWith('.sh') || String(path).endsWith('.md')
      } as any))
      mockReadFileSync.mockImplementation((path) => {
        if (String(path).includes('SKILL.md')) {
          return '---\nname: Test\n---\n\nContent'
        }
        if (String(path).includes('.sh')) {
          return '#!/bin/bash\n# Actual description\necho "hello"'
        }
        return ''
      })

      const result = service.scan()

      expect(result.vercelSkills[0].scripts[0].description).toBe('Actual description')
    })
  })
})

/**
 * Helper to set up a mock Vercel skill structure.
 */
function setupMockVercelSkill(): void {
  const skillsPath = join(TEST_CLAUDE_DIR, 'skills')
  const skillPath = join(skillsPath, 'deploy')
  const skillMdPath = join(skillPath, 'SKILL.md')

  mockExistsSync.mockImplementation((path) => {
    return [skillsPath, skillMdPath].includes(String(path))
  })
  mockReaddirSync.mockImplementation((path) => {
    if (path === skillsPath) return ['deploy'] as any
    return [] as any
  })
  mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
  mockReadFileSync.mockImplementation((path) => {
    if (String(path).includes('SKILL.md')) {
      return '---\nname: Deploy\ndescription: Deploy to production\n---\n\nDeploy your application.'
    }
    return ''
  })
}

/**
 * Helper to set up a mock project skill.
 */
function setupMockProjectSkill(): void {
  const projectSkillsPath = join(TEST_PROJECT_PATH, '.claude', 'skills')
  const skillPath = join(projectSkillsPath, 'custom-lint')
  const skillMdPath = join(skillPath, 'SKILL.md')

  mockExistsSync.mockImplementation((path) => {
    return [projectSkillsPath, skillMdPath].includes(String(path))
  })
  mockReaddirSync.mockImplementation((path) => {
    if (path === projectSkillsPath) return ['custom-lint'] as any
    return [] as any
  })
  mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
  mockReadFileSync.mockImplementation((path) => {
    if (String(path).includes('SKILL.md')) {
      return '---\nname: Custom Lint\ndescription: Project-specific linting\n---\n\nLint your code.'
    }
    return ''
  })
}

/**
 * Helper to set up a Vercel skill with scripts.
 */
function setupMockVercelSkillWithScripts(): void {
  const skillsPath = join(TEST_CLAUDE_DIR, 'skills')
  const skillPath = join(skillsPath, 'deploy')
  const skillMdPath = join(skillPath, 'SKILL.md')
  const scriptsPath = join(skillPath, 'scripts')

  mockExistsSync.mockImplementation((path) => {
    return [skillsPath, skillMdPath, scriptsPath].includes(String(path))
  })
  mockReaddirSync.mockImplementation((path) => {
    if (path === skillsPath) return ['deploy'] as any
    if (path === scriptsPath) return ['deploy.sh'] as any
    return [] as any
  })
  mockStatSync.mockImplementation((path) => ({
    isDirectory: () => !String(path).endsWith('.sh'),
    isFile: () => String(path).endsWith('.sh')
  } as any))
  mockReadFileSync.mockImplementation((path) => {
    if (String(path).includes('SKILL.md')) {
      return '---\nname: Deploy\n---\n\nDeploy application.'
    }
    if (String(path).includes('deploy.sh')) {
      return '#!/bin/bash\n# Deploy to production\necho "Deploying..."'
    }
    return ''
  })
}

/**
 * Helper to set up a Vercel skill with references.
 */
function setupMockVercelSkillWithReferences(): void {
  const skillsPath = join(TEST_CLAUDE_DIR, 'skills')
  const skillPath = join(skillsPath, 'deploy')
  const skillMdPath = join(skillPath, 'SKILL.md')
  const refsPath = join(skillPath, 'references')

  mockExistsSync.mockImplementation((path) => {
    return [skillsPath, skillMdPath, refsPath].includes(String(path))
  })
  mockReaddirSync.mockImplementation((path) => {
    if (path === skillsPath) return ['deploy'] as any
    if (path === refsPath) return ['rules.md'] as any
    return [] as any
  })
  mockStatSync.mockImplementation((path) => ({
    isDirectory: () => !String(path).endsWith('.md') || String(path).includes('references'),
    isFile: () => String(path).endsWith('.md') && !String(path).includes('references')
  } as any))
  mockReadFileSync.mockImplementation((path) => {
    if (String(path).includes('SKILL.md')) {
      return '---\nname: Deploy\n---\n\nDeploy application.'
    }
    if (String(path).includes('rules.md')) {
      return '# Deployment Rules\n\n1. Always test first'
    }
    return ''
  })
}

/**
 * Helper to set up a Vercel skill with custom frontmatter content.
 */
function setupMockVercelSkillWithFrontmatter(content: string): void {
  const skillsPath = join(TEST_CLAUDE_DIR, 'skills')
  const skillPath = join(skillsPath, 'deploy')
  const skillMdPath = join(skillPath, 'SKILL.md')

  mockExistsSync.mockImplementation((path) => {
    return [skillsPath, skillMdPath].includes(String(path))
  })
  mockReaddirSync.mockImplementation((path) => {
    if (path === skillsPath) return ['deploy'] as any
    return [] as any
  })
  mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
  mockReadFileSync.mockImplementation((path) => {
    if (String(path).includes('SKILL.md')) {
      return content
    }
    return ''
  })
}
