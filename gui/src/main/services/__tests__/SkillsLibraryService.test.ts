import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { SkillsLibraryService } from '../SkillsLibraryService'
import { DEFAULT_SKILLS_LIBRARY_SETTINGS } from '../types/SkillsLibraryTypes'

vi.mock('fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), readdirSync: vi.fn() }))
vi.mock('chokidar', () => ({ default: { watch: vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() })) } }))

import { existsSync, readFileSync, readdirSync } from 'fs'
import chokidar from 'chokidar'

const mocks = { exists: vi.mocked(existsSync), read: vi.mocked(readFileSync), dir: vi.mocked(readdirSync) }
const CLAUDE_DIR = '/test/.claude', PROJECT = '/test/project'

const mockItem = (type: 'command' | 'agent', name: string, content: string, scope: 'global' | 'project' = 'global') => {
  const base = scope === 'global' ? CLAUDE_DIR : join(PROJECT, '.claude')
  const dir = type === 'command' ? join(base, 'commands') : join(base, 'agents')
  const file = `${name}.md`

  mocks.exists.mockImplementation(p => String(p) === dir || String(p).endsWith('.md'))
  mocks.dir.mockImplementation(p => String(p) === dir ? [file] as any : [])
  mocks.read.mockImplementation(p => String(p).endsWith(file) ? content : '')
}

describe('SkillsLibraryService', () => {
  let svc: SkillsLibraryService

  beforeEach(() => { vi.clearAllMocks(); svc = new SkillsLibraryService(CLAUDE_DIR) })
  afterEach(() => svc.cleanup())

  describe('paths', () => {
    it('commands path', () => expect(svc.getCommandsPath()).toBe(join(CLAUDE_DIR, 'commands')))
    it('agents path', () => expect(svc.getAgentsPath()).toBe(join(CLAUDE_DIR, 'agents')))
    it('project commands path', () => { svc.setProjectPath(PROJECT); expect(svc.getCommandsPath('project')).toBe(join(PROJECT, '.claude', 'commands')) })
    it('project agents path', () => { svc.setProjectPath(PROJECT); expect(svc.getAgentsPath('project')).toBe(join(PROJECT, '.claude', 'agents')) })
  })

  describe('scan', () => {
    it('empty when no dir', () => { mocks.exists.mockReturnValue(false); const r = svc.scan(); expect(r.commands).toHaveLength(0) })

    it('discovers commands', () => {
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      const r = svc.scan()
      expect(r.commands).toHaveLength(1)
      expect(r.commands[0]).toMatchObject({ name: 'Deploy', id: 'command:deploy' })
    })

    it('discovers agents', () => {
      mockItem('agent', 'debugger', '---\nname: Debugger\nmodel: opus\n---\n\nDebug.')
      const r = svc.scan()
      expect(r.agents).toHaveLength(1)
      expect(r.agents[0]).toMatchObject({ name: 'Debugger', id: 'agent:debugger', model: 'opus' })
    })

    it('discovers project commands', () => {
      svc.setProjectPath(PROJECT)
      mockItem('command', 'lint', '---\nname: Lint\n---\n\nLint.', 'project')
      expect(svc.scan(PROJECT).projectCommands[0]).toMatchObject({ name: 'Lint', id: 'project-command:lint' })
    })
  })

  describe('frontmatter', () => {
    it('parses yaml', () => {
      mockItem('command', 'deploy', '---\nname: Custom\ndescription: Desc\n---\n\nContent')
      expect(svc.scan().commands[0]).toMatchObject({ name: 'Custom', description: 'Desc' })
    })

    it('uses filename when no frontmatter', () => {
      mockItem('command', 'my-skill', 'How to deploy.')
      expect(svc.scan().commands[0].name).toBe('My Skill')
    })

    it('extracts description from content', () => {
      mockItem('command', 'test', '---\nname: Test\n---\n\nFirst para here.')
      expect(svc.scan().commands[0].description).toBe('First para here.')
    })

    it('handles quoted strings', () => {
      mockItem('command', 'deploy', '---\nname: "Quoted"\ndescription: \'Single\'\n---\n\nContent')
      expect(svc.scan().commands[0]).toMatchObject({ name: 'Quoted', description: 'Single' })
    })
  })

  describe('settings', () => {
    it('defaults', () => expect(svc.getSettings()).toEqual(DEFAULT_SKILLS_LIBRARY_SETTINGS))
    it('updates', () => { svc.updateSettings({ commandsEnabled: false }); expect(svc.getSettings().commandsEnabled).toBe(false) })

    it('respects commands disabled', () => {
      svc.updateSettings({ commandsEnabled: false })
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.scan().commands).toHaveLength(0)
    })

    it('respects project disabled', () => {
      svc.setProjectPath(PROJECT)
      svc.updateSettings({ projectSkillsEnabled: false })
      mockItem('command', 'lint', '---\nname: Lint\n---\n\nLint.', 'project')
      expect(svc.scan(PROJECT).projectCommands).toHaveLength(0)
    })
  })

  describe('getEnabledItems', () => {
    it('returns all when none disabled', () => {
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.getEnabledItems()).toHaveLength(1)
    })

    it('filters disabled', () => {
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      svc.updateSettings({ disabledSkillIds: ['command:deploy'] })
      expect(svc.getEnabledItems()).toHaveLength(0)
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
  })

  describe('window IPC', () => {
    const mockWindow = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { send: vi.fn() } } as any)

    it('sends updates', () => {
      const w = mockWindow()
      svc.setWindow(w)
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      svc.refresh()
      expect(w.webContents.send).toHaveBeenCalledWith('skillsLibrary:updated', expect.objectContaining({ commands: expect.any(Array) }))
    })

    it('skips destroyed window', () => {
      const w = mockWindow(true)
      svc.setWindow(w)
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      svc.refresh()
      expect(w.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('caching', () => {
    it('scans on first call', () => {
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.getScanResult().commands).toHaveLength(1)
    })

    it('returns cached', () => {
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      expect(svc.getScanResult()).toBe(svc.getScanResult())
    })

    it('setProjectPath clears cache', () => {
      mockItem('command', 'deploy', '---\nname: Deploy\n---\n\nDeploy.')
      const r1 = svc.getScanResult()
      svc.setProjectPath('/new')
      expect(svc.getScanResult()).not.toBe(r1)
    })
  })
})
