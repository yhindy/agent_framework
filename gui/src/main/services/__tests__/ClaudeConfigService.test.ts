import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { ClaudeConfigService } from '../ClaudeConfigService'
import {
  ImportedSubagentType,
  BUILT_IN_AGENT_IDS,
  isBuiltInAgentId,
  DEFAULT_CLAUDE_CONFIG_SETTINGS
} from '../types/ClaudeConfigTypes'

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

describe('ClaudeConfigService', () => {
  let service: ClaudeConfigService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ClaudeConfigService(TEST_CLAUDE_DIR)
  })

  afterEach(() => {
    service.cleanup()
  })

  describe('isClaudeCodeInstalled', () => {
    it('should return true when ~/.claude exists', () => {
      mockExistsSync.mockReturnValue(true)

      expect(service.isClaudeCodeInstalled()).toBe(true)
      expect(mockExistsSync).toHaveBeenCalledWith(TEST_CLAUDE_DIR)
    })

    it('should return false when ~/.claude does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      expect(service.isClaudeCodeInstalled()).toBe(false)
    })
  })

  describe('scanConfigs', () => {
    it('should return empty result when Claude Code is not installed', () => {
      mockExistsSync.mockReturnValue(false)

      const result = service.scanConfigs()

      expect(result.isInstalled).toBe(false)
      expect(result.plugins).toHaveLength(0)
      expect(result.importedTypes).toHaveLength(0)
      expect(result.conflicts).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should return empty plugins when cache directory does not exist', () => {
      mockExistsSync.mockImplementation((path) => {
        if (path === TEST_CLAUDE_DIR) return true
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return false
        return false
      })

      const result = service.scanConfigs()

      expect(result.isInstalled).toBe(true)
      expect(result.plugins).toHaveLength(0)
    })

    it('should discover plugins from marketplace directories', () => {
      setupMockPluginStructure()

      const result = service.scanConfigs()

      expect(result.isInstalled).toBe(true)
      expect(result.plugins).toHaveLength(1)
      expect(result.plugins[0].name).toBe('Test Plugin')
      expect(result.plugins[0].version).toBe('1.0.0')
      expect(result.plugins[0].marketplace).toBe('anthropic')
    })

    it('should discover agents from plugin', () => {
      setupMockPluginStructure()

      const result = service.scanConfigs()

      const agents = result.importedTypes.filter(t => t.source.type === 'plugin-agent')
      expect(agents).toHaveLength(1)
      expect(agents[0].name).toBe('Test Agent')
      expect(agents[0].id).toBe('imported:anthropic/test-plugin:test-agent')
    })

    it('should discover skills from plugin', () => {
      setupMockPluginStructure()

      const result = service.scanConfigs()

      const skills = result.importedTypes.filter(t => t.source.type === 'plugin-skill')
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('Test Skill')
      expect(skills[0].id).toBe('imported:anthropic/test-plugin:skill:test-skill')
    })

    it('should handle parse errors gracefully', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return ['anthropic'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic')) return ['broken-plugin'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic', 'broken-plugin')) return ['1.0.0'] as any
        return [] as any
      })
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Invalid JSON')
      })

      const result = service.scanConfigs()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].type).toBe('parse')
    })
  })

  describe('detectConflicts', () => {
    it('should detect conflicts with built-in agent IDs', () => {
      const importedTypes: ImportedSubagentType[] = [
        {
          id: 'imported:test:explore',
          name: 'Explore',
          description: 'Custom explorer',
          source: {
            type: 'plugin-agent',
            pluginId: 'test',
            pluginName: 'Test',
            pluginVersion: '1.0.0'
          }
        }
      ]

      const conflicts = service.detectConflicts(importedTypes)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].builtInId).toBe('explore')
      expect(conflicts[0].resolution).toBe('rename')
      expect(conflicts[0].resolvedId).toBe('imported:test:explore-imported')
    })

    it('should not flag non-conflicting imports', () => {
      const importedTypes: ImportedSubagentType[] = [
        {
          id: 'imported:myplugin:custom-agent',
          name: 'Custom Agent',
          description: 'A unique agent',
          source: {
            type: 'plugin-agent',
            pluginId: 'myplugin',
            pluginName: 'My Plugin',
            pluginVersion: '1.0.0'
          }
        }
      ]

      const conflicts = service.detectConflicts(importedTypes)

      expect(conflicts).toHaveLength(0)
    })
  })

  describe('getEnabledImports', () => {
    beforeEach(() => {
      setupMockPluginStructure()
    })

    it('should return all imports when enabled and no filters', () => {
      service.updateSettings({ enabled: true, enabledPlugins: [], disabledAgentIds: [] })

      const enabled = service.getEnabledImports()

      expect(enabled.length).toBeGreaterThan(0)
    })

    it('should return empty array when disabled', () => {
      service.updateSettings({ enabled: false })

      const enabled = service.getEnabledImports()

      expect(enabled).toHaveLength(0)
    })

    it('should filter by enabled plugins', () => {
      service.updateSettings({
        enabled: true,
        enabledPlugins: ['other-plugin'],
        disabledAgentIds: []
      })

      const enabled = service.getEnabledImports()

      // No imports because 'anthropic/test-plugin' is not in enabledPlugins
      expect(enabled).toHaveLength(0)
    })

    it('should filter out disabled agent IDs', () => {
      service.updateSettings({
        enabled: true,
        enabledPlugins: [],
        disabledAgentIds: ['imported:anthropic/test-plugin:test-agent']
      })

      const enabled = service.getEnabledImports()

      // Should only have the skill, not the agent
      expect(enabled.every(t => !t.id.includes('test-agent'))).toBe(true)
    })
  })

  describe('settings management', () => {
    it('should return default settings initially', () => {
      const settings = service.getSettings()

      expect(settings).toEqual(DEFAULT_CLAUDE_CONFIG_SETTINGS)
    })

    it('should update settings', () => {
      const updated = service.updateSettings({ enabled: false, autoRefresh: false })

      expect(updated.enabled).toBe(false)
      expect(updated.autoRefresh).toBe(false)
      expect(service.getSettings().enabled).toBe(false)
    })
  })

  describe('watching', () => {
    it('should start watching when Claude Code is installed', () => {
      mockExistsSync.mockReturnValue(true)

      service.startWatching()

      expect(chokidar.watch).toHaveBeenCalled()
    })

    it('should not start watching when Claude Code is not installed', () => {
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
  })
})

describe('ClaudeConfigTypes', () => {
  describe('BUILT_IN_AGENT_IDS', () => {
    it('should contain all expected built-in IDs', () => {
      expect(BUILT_IN_AGENT_IDS).toEqual([
        'explore', 'plan', 'review', 'implement',
        'test', 'debug', 'document', 'simplify'
      ])
    })
  })

  describe('isBuiltInAgentId', () => {
    it('should return true for built-in IDs', () => {
      expect(isBuiltInAgentId('explore')).toBe(true)
      expect(isBuiltInAgentId('implement')).toBe(true)
    })

    it('should return false for non-built-in IDs', () => {
      expect(isBuiltInAgentId('custom')).toBe(false)
      expect(isBuiltInAgentId('imported:test:agent')).toBe(false)
    })
  })
})

/**
 * Helper to set up mock plugin structure for tests.
 * Note: agents/ and skills/ are at the root of versionPath, NOT inside .claude-plugin/
 */
function setupMockPluginStructure(): void {
  const cachePath = join('/test/.claude', 'plugins', 'cache')
  const marketplacePath = join(cachePath, 'anthropic')
  const pluginPath = join(marketplacePath, 'test-plugin')
  const versionPath = join(pluginPath, '1.0.0')
  const pluginJsonPath = join(versionPath, '.claude-plugin', 'plugin.json')
  // agents and skills are at versionPath root, not inside .claude-plugin
  const agentsDir = join(versionPath, 'agents')
  const skillsDir = join(versionPath, 'skills')
  const skillDir = join(skillsDir, 'test-skill')

  mockExistsSync.mockImplementation((path) => {
    const pathStr = String(path)
    const validPaths = [
      '/test/.claude',
      cachePath,
      pluginJsonPath,
      agentsDir,
      skillsDir,
      join(skillDir, 'SKILL.md')
    ]
    return validPaths.includes(pathStr)
  })

  mockReaddirSync.mockImplementation((path) => {
    const pathStr = String(path)
    if (pathStr === cachePath) return ['anthropic'] as any
    if (pathStr === marketplacePath) return ['test-plugin'] as any
    if (pathStr === pluginPath) return ['1.0.0'] as any
    if (pathStr === agentsDir) return ['test-agent.md'] as any
    if (pathStr === skillsDir) return ['test-skill'] as any
    return [] as any
  })

  mockStatSync.mockReturnValue({ isDirectory: () => true } as any)

  mockReadFileSync.mockImplementation((path) => {
    const pathStr = String(path)

    if (pathStr === pluginJsonPath) {
      return JSON.stringify({
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin'
      })
    }

    if (pathStr.includes('test-agent.md')) {
      return `---
name: Test Agent
description: A test agent for exploring
---

This is the agent content.
`
    }

    if (pathStr.includes('SKILL.md')) {
      return `---
name: Test Skill
description: A test skill
---

This is the skill content.
`
    }

    return ''
  })
}
