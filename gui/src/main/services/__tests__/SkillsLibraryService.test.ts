import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { SkillsLibraryService } from '../SkillsLibraryService'
import { DEFAULT_SKILLS_LIBRARY_SETTINGS } from '../types/SkillsLibraryTypes'

vi.mock('fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), readdirSync: vi.fn(), statSync: vi.fn() }))
vi.mock('chokidar', () => ({ default: { watch: vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() })) } }))

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'

const mocks = { exists: vi.mocked(existsSync), read: vi.mocked(readFileSync), dir: vi.mocked(readdirSync), stat: vi.mocked(statSync) }
const CLAUDE_DIR = '/test/.claude', PROJECT = '/test/project'

const mockSkill = (base: string, name: string, content: string, extras?: { scripts?: string[]; refs?: string[] }) => {
  const skillsPath = join(base, 'skills'), skillPath = join(skillsPath, name), mdPath = join(skillPath, 'SKILL.md')
  const scriptsPath = join(skillPath, 'scripts'), refsPath = join(skillPath, 'references')
  const paths = [skillsPath, mdPath, ...(extras?.scripts ? [scriptsPath] : []), ...(extras?.refs ? [refsPath] : [])]

  mocks.exists.mockImplementation(p => paths.includes(String(p)))
  mocks.dir.mockImplementation(p => {
    if (p === skillsPath) return [name] as any
    if (p === scriptsPath) return extras?.scripts as any || []
    if (p === refsPath) return extras?.refs as any || []
    return []
  })
  mocks.stat.mockImplementation(p => ({
    isDirectory: () => !String(p).match(/\.(sh|md)$/) || String(p).includes('references'),
    isFile: () => !!String(p).match(/\.(sh|md)$/) && !String(p).includes('references')
  } as any))
  mocks.read.mockImplementation(p => {
    if (String(p).includes('SKILL.md')) return content
    if (String(p).includes('.sh')) return '#!/bin/bash\n# Deploy to production\necho "Deploying..."'
    if (String(p).includes('rules.md')) return '# Deployment Rules'
    return ''
  })
}

describe('SkillsLibraryService', () => {
  let svc: SkillsLibraryService

  beforeEach(() => { vi.clearAllMocks(); svc = new SkillsLibraryService(CLAUDE_DIR) })
  afterEach(() => svc.cleanup())

  describe('paths', () => {
    it('vercel path', () => expect(svc.getVercelSkillsPath()).toBe(join(CLAUDE_DIR, 'skills')))
    it('project path null when unset', () => expect(svc.getProjectSkillsPath()).toBeNull())
    it('project path when set', () => { svc.setProjectPath(PROJECT); expect(svc.getProjectSkillsPath()).toBe(join(PROJECT, '.claude', 'skills')) })
    it('project path with arg', () => expect(svc.getProjectSkillsPath('/custom')).toBe(join('/custom', '.claude', 'skills')))
  })

  describe('scan', () => {
    it('empty when no dir', () => { mocks.exists.mockReturnValue(false); const r = svc.scan(); expect(r.vercelSkills).toHaveLength(0) })

    it('discovers vercel skills', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      const r = svc.scan()
      expect(r.vercelSkills).toHaveLength(1)
      expect(r.vercelSkills[0]).toMatchObject({ name: 'Deploy', id: 'vercel:deploy' })
    })

    it('discovers project skills', () => {
      svc.setProjectPath(PROJECT)
      mockSkill(join(PROJECT, '.claude'), 'custom-lint', '---\nname: Custom Lint\n---\n\nLint.')
      expect(svc.scan(PROJECT).projectSkills[0]).toMatchObject({ name: 'Custom Lint', id: 'project:custom-lint' })
    })

    it('parses scripts', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.', { scripts: ['deploy.sh'] })
      const r = svc.scan()
      expect(r.vercelSkills[0].scripts).toHaveLength(1)
      expect(r.vercelSkills[0].scripts[0]).toMatchObject({ name: 'deploy', description: 'Deploy to production' })
    })

    it('parses references', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.', { refs: ['rules.md'] })
      expect(svc.scan().vercelSkills[0].references[0].name).toBe('rules.md')
    })

    it('skips dirs without SKILL.md', () => {
      mocks.exists.mockImplementation(p => p === join(CLAUDE_DIR, 'skills'))
      mocks.dir.mockReturnValue(['no-skill-file'] as any)
      mocks.stat.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
      expect(svc.scan().vercelSkills).toHaveLength(0)
    })
  })

  describe('frontmatter', () => {
    it('parses yaml', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Custom\ndescription: Desc\n---\n\nContent')
      expect(svc.scan().vercelSkills[0]).toMatchObject({ name: 'Custom', description: 'Desc' })
    })

    it('uses filename when no frontmatter', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '# Deploy Skill\n\nHow to deploy.')
      expect(svc.scan().vercelSkills[0].name).toBe('Deploy')
    })

    it('extracts first paragraph as description', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Test\n---\n\n# Heading\n\nFirst para.\n\nSecond.')
      expect(svc.scan().vercelSkills[0].description).toBe('First para.')
    })

    it('truncates long descriptions', () => {
      mockSkill(CLAUDE_DIR, 'deploy', `---\nname: Test\n---\n\n${'A'.repeat(300)}`)
      const d = svc.scan().vercelSkills[0].description
      expect(d.length).toBeLessThanOrEqual(200)
      expect(d.endsWith('...')).toBe(true)
    })

    it('handles quoted strings', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: "Quoted"\ndescription: \'Single\'\n---\n\nContent')
      expect(svc.scan().vercelSkills[0]).toMatchObject({ name: 'Quoted', description: 'Single' })
    })
  })

  describe('settings', () => {
    it('defaults', () => expect(svc.getSettings()).toEqual(DEFAULT_SKILLS_LIBRARY_SETTINGS))
    it('updates', () => { svc.updateSettings({ vercelSkillsEnabled: false }); expect(svc.getSettings().vercelSkillsEnabled).toBe(false) })

    it('respects vercel disabled', () => {
      svc.updateSettings({ vercelSkillsEnabled: false })
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.scan().vercelSkills).toHaveLength(0)
    })

    it('respects project disabled', () => {
      svc.setProjectPath(PROJECT)
      svc.updateSettings({ projectSkillsEnabled: false })
      mockSkill(join(PROJECT, '.claude'), 'lint', '---\nname: Lint\n---\n\nLint.')
      expect(svc.scan(PROJECT).projectSkills).toHaveLength(0)
    })
  })

  describe('getEnabledSkills', () => {
    it('returns all when none disabled', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.getEnabledSkills()).toHaveLength(1)
    })

    it('filters disabled', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      svc.updateSettings({ disabledSkillIds: ['vercel:deploy'] })
      expect(svc.getEnabledSkills()).toHaveLength(0)
    })
  })

  describe('watching', () => {
    it('starts when dir exists', () => { mocks.exists.mockReturnValue(true); svc.startWatching(); expect(chokidar.watch).toHaveBeenCalled() })
    it('skips when no dir', () => { mocks.exists.mockReturnValue(false); svc.startWatching(); expect(chokidar.watch).not.toHaveBeenCalled() })

    it('stops on cleanup', () => {
      mocks.exists.mockReturnValue(true)
      const watcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }
      vi.mocked(chokidar.watch).mockReturnValue(watcher as any)
      svc.startWatching(); svc.cleanup()
      expect(watcher.close).toHaveBeenCalled()
    })

    it('no double watch', () => {
      mocks.exists.mockReturnValue(true)
      vi.mocked(chokidar.watch).mockReturnValue({ on: vi.fn().mockReturnThis(), close: vi.fn() } as any)
      svc.startWatching(); svc.startWatching()
      expect(chokidar.watch).toHaveBeenCalledTimes(1)
    })
  })

  describe('window IPC', () => {
    const mockWindow = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { send: vi.fn() } } as any)

    it('sends updates', () => {
      const w = mockWindow()
      svc.setWindow(w)
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      svc.refresh()
      expect(w.webContents.send).toHaveBeenCalledWith('skillsLibrary:updated', expect.objectContaining({ vercelSkills: expect.any(Array) }))
    })

    it('skips destroyed window', () => {
      const w = mockWindow(true)
      svc.setWindow(w)
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      svc.refresh()
      expect(w.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('caching', () => {
    it('scans on first call', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.getScanResult().vercelSkills).toHaveLength(1)
    })

    it('returns cached', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.getScanResult()).toBe(svc.getScanResult())
    })

    it('refresh clears cache', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      const r1 = svc.getScanResult()
      mocks.exists.mockReturnValue(false)
      expect(svc.refresh().vercelSkills).toHaveLength(0)
    })

    it('setProjectPath clears cache', () => {
      mockSkill(CLAUDE_DIR, 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      const r1 = svc.getScanResult()
      svc.setProjectPath('/new')
      expect(svc.getScanResult()).not.toBe(r1)
    })
  })
})
