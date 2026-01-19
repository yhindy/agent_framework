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

    it('should not start watching if already watching', () => {
      mockExistsSync.mockReturnValue(true)
      const mockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn()
      }
      vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any)

      service.startWatching()
      service.startWatching() // Second call should be ignored

      expect(chokidar.watch).toHaveBeenCalledTimes(1)
    })

    it('should not start watching if plugins cache does not exist', () => {
      mockExistsSync.mockImplementation((path) => {
        if (path === TEST_CLAUDE_DIR) return true
        return false // plugins/cache does not exist
      })

      service.startWatching()

      expect(chokidar.watch).not.toHaveBeenCalled()
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

      // Verify window is used when refresh is called
      setupMockPluginStructure()
      service.refresh()

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'claudeConfig:updated',
        expect.objectContaining({
          isInstalled: true
        })
      )
    })
  })

  describe('getScanResult', () => {
    it('should perform scan on first call when no cache exists', () => {
      setupMockPluginStructure()

      const result = service.getScanResult()

      expect(result.isInstalled).toBe(true)
      expect(result.plugins).toHaveLength(1)
    })

    it('should return cached result on subsequent calls', () => {
      setupMockPluginStructure()

      const result1 = service.getScanResult()
      const result2 = service.getScanResult()

      // Same reference indicates cached result
      expect(result1).toBe(result2)
    })
  })

  describe('refresh', () => {
    it('should re-scan and return fresh result', () => {
      setupMockPluginStructure()

      const result1 = service.scanConfigs()

      // Modify mock to return different data
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return ['anthropic'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic')) return [] as any // No plugins now
        return [] as any
      })

      const result2 = service.refresh()

      // Result should be different (fresh scan)
      expect(result1.plugins).toHaveLength(1)
      expect(result2.plugins).toHaveLength(0)
    })

    it('should not send IPC when window is destroyed', () => {
      const mockWindow = {
        isDestroyed: vi.fn().mockReturnValue(true),
        webContents: {
          send: vi.fn()
        }
      } as any

      service.setWindow(mockWindow)
      setupMockPluginStructure()
      service.refresh()

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('should not send IPC when no window is set', () => {
      setupMockPluginStructure()
      // No call to setWindow
      const result = service.refresh()

      // Should still return result without error
      expect(result.isInstalled).toBe(true)
    })
  })

  describe('detectConflicts - edge cases', () => {
    it('should detect conflicts for skills that match built-in IDs', () => {
      const importedTypes: ImportedSubagentType[] = [
        {
          id: 'imported:plugin:skill:test',
          name: 'test',
          description: 'A skill named test',
          source: {
            type: 'plugin-skill',
            pluginId: 'plugin',
            pluginName: 'Plugin',
            pluginVersion: '1.0.0'
          }
        }
      ]

      const conflicts = service.detectConflicts(importedTypes)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].builtInId).toBe('test')
    })

    it('should detect conflicts based on name case-insensitively', () => {
      const importedTypes: ImportedSubagentType[] = [
        {
          id: 'imported:plugin:my-explore',
          name: 'EXPLORE', // Uppercase but matches 'explore'
          description: 'Custom explore',
          source: {
            type: 'plugin-agent',
            pluginId: 'plugin',
            pluginName: 'Plugin',
            pluginVersion: '1.0.0'
          }
        }
      ]

      const conflicts = service.detectConflicts(importedTypes)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].builtInId).toBe('explore')
    })

    it('should return empty conflicts array for empty input', () => {
      const conflicts = service.detectConflicts([])
      expect(conflicts).toHaveLength(0)
    })

    it('should not flag agents with partial name matches', () => {
      const importedTypes: ImportedSubagentType[] = [
        {
          id: 'imported:plugin:explorer-pro',
          name: 'Explorer Pro', // Contains 'explore' but not exact match
          description: 'Advanced explorer',
          source: {
            type: 'plugin-agent',
            pluginId: 'plugin',
            pluginName: 'Plugin',
            pluginVersion: '1.0.0'
          }
        }
      ]

      const conflicts = service.detectConflicts(importedTypes)

      expect(conflicts).toHaveLength(0)
    })
  })

  describe('scanConfigs - version sorting', () => {
    it('should use the latest version when multiple versions exist', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return ['anthropic'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic')) return ['test-plugin'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic', 'test-plugin')) {
          return ['1.0.0', '2.0.0', '1.5.0'] as any // Multiple versions
        }
        if (path.includes('2.0.0/agents')) return ['agent.md'] as any
        return [] as any
      })
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any)
      mockReadFileSync.mockImplementation((path) => {
        if (String(path).includes('plugin.json')) {
          return JSON.stringify({ name: 'Test Plugin', version: '2.0.0' })
        }
        if (String(path).includes('agent.md')) {
          return '---\nname: Latest Agent\n---\n\nContent'
        }
        return ''
      })

      const result = service.scanConfigs()

      expect(result.plugins[0].version).toBe('2.0.0')
    })
  })

  describe('scanConfigs - plugins without agents or skills', () => {
    it('should not include plugins that have no agents or skills', () => {
      mockExistsSync.mockImplementation((path) => {
        if (path === TEST_CLAUDE_DIR) return true
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return true
        if (String(path).includes('plugin.json')) return true
        // agents and skills directories don't exist
        return false
      })
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return ['anthropic'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic')) return ['empty-plugin'] as any
        if (path.includes('empty-plugin')) return ['1.0.0'] as any
        return [] as any
      })
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any)
      mockReadFileSync.mockImplementation((path) => {
        if (String(path).includes('plugin.json')) {
          return JSON.stringify({ name: 'Empty Plugin', version: '1.0.0' })
        }
        return ''
      })

      const result = service.scanConfigs()

      expect(result.plugins).toHaveLength(0) // Plugin has no agents or skills
      expect(result.importedTypes).toHaveLength(0)
    })
  })

  describe('scanConfigs - error handling', () => {
    it('should handle errors when reading marketplace directories', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) {
          return ['anthropic'] as any
        }
        throw new Error('Permission denied')
      })

      const result = service.scanConfigs()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.type === 'read')).toBe(true)
    })

    it('should handle errors when reading plugin directories', () => {
      mockExistsSync.mockReturnValue(true)
      let callCount = 0
      mockReaddirSync.mockImplementation((path) => {
        callCount++
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) return ['anthropic'] as any
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache', 'anthropic')) return ['test-plugin'] as any
        if (callCount > 2) throw new Error('Read error')
        return [] as any
      })
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any)

      const result = service.scanConfigs()

      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should handle non-Error thrown values', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation((path) => {
        if (path === join(TEST_CLAUDE_DIR, 'plugins', 'cache')) {
          throw 'String error' // Non-Error thrown value
        }
        return [] as any
      })

      const result = service.scanConfigs()

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toBe('String error')
    })
  })

  describe('markdown parsing edge cases', () => {
    it('should handle markdown without frontmatter', () => {
      const paths = {
        cache: '/test/.claude/plugins/cache',
        marketplace: '/test/.claude/plugins/cache/anthropic',
        plugin: '/test/.claude/plugins/cache/anthropic/test-plugin',
        version: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0',
        pluginJson: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/.claude-plugin/plugin.json',
        agents: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/agents',
        agentFile: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/agents/no-frontmatter.md'
      }

      mockExistsSync.mockImplementation((path) => {
        const validPaths = new Set([
          TEST_CLAUDE_DIR,
          paths.cache,
          paths.pluginJson,
          paths.agents,
          paths.agentFile
        ])
        return validPaths.has(String(path))
      })
      mockReaddirSync.mockImplementation((path) => {
        if (path === paths.cache) return ['anthropic'] as any
        if (path === paths.marketplace) return ['test-plugin'] as any
        if (path === paths.plugin) return ['1.0.0'] as any
        if (path === paths.agents) return ['no-frontmatter.md'] as any
        return [] as any
      })
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any)
      mockReadFileSync.mockImplementation((path) => {
        if (String(path).includes('plugin.json')) {
          return JSON.stringify({ name: 'Test Plugin' })
        }
        if (String(path).includes('no-frontmatter.md')) {
          // No frontmatter, just content
          return '# My Agent\n\nThis is a simple agent without YAML frontmatter.\n'
        }
        return ''
      })

      const result = service.scanConfigs()

      // Should use filename as name
      const agent = result.importedTypes.find(t => t.source.type === 'plugin-agent')
      expect(agent?.name).toBe('no-frontmatter')
    })

    it('should extract first paragraph as description when not in frontmatter', () => {
      setupMockPluginWithCustomAgent('---\nname: Test\n---\n\n# Heading\n\nFirst paragraph content here.\n\nSecond paragraph.')

      const result = service.scanConfigs()

      const agent = result.importedTypes.find(t => t.source.type === 'plugin-agent')
      expect(agent?.description).toBe('First paragraph content here.')
    })

    it('should truncate long descriptions', () => {
      const longDescription = 'A'.repeat(300) // Longer than 200 char limit
      setupMockPluginWithCustomAgent(`---\nname: Test\n---\n\n${longDescription}`)

      const result = service.scanConfigs()

      const agent = result.importedTypes.find(t => t.source.type === 'plugin-agent')
      expect(agent?.description?.length).toBeLessThanOrEqual(200)
      expect(agent?.description?.endsWith('...')).toBe(true)
    })

    it('should handle YAML with quoted strings', () => {
      setupMockPluginWithCustomAgent('---\nname: "Agent With Quotes"\ndescription: \'Single quoted\'\n---\n\nContent')

      const result = service.scanConfigs()

      const agent = result.importedTypes.find(t => t.source.type === 'plugin-agent')
      expect(agent?.name).toBe('Agent With Quotes')
      expect(agent?.description).toBe('Single quoted')
    })

    it('should handle YAML with array values', () => {
      setupMockPluginWithCustomAgent('---\nname: Test\ntools: [tool1, tool2, tool3]\n---\n\nContent')

      const result = service.scanConfigs()

      // Should parse without error, arrays are supported in frontmatter
      expect(result.errors).toHaveLength(0)
    })

    it('should handle YAML with boolean values', () => {
      setupMockPluginWithCustomAgent('---\nname: Test\nenabled: true\ndisabled: false\n---\n\nContent')

      const result = service.scanConfigs()

      expect(result.errors).toHaveLength(0)
    })

    it('should handle YAML with numeric values', () => {
      setupMockPluginWithCustomAgent('---\nname: Test\npriority: 42\nversion: 1.5\n---\n\nContent')

      const result = service.scanConfigs()

      expect(result.errors).toHaveLength(0)
    })

    it('should handle YAML with comments', () => {
      setupMockPluginWithCustomAgent('---\nname: Test\n# This is a comment\ndescription: Desc\n---\n\nContent')

      const result = service.scanConfigs()

      const agent = result.importedTypes.find(t => t.source.type === 'plugin-agent')
      expect(agent?.name).toBe('Test')
      expect(agent?.description).toBe('Desc')
    })

    it('should return default description when content has no paragraphs', () => {
      setupMockPluginWithCustomAgent('---\nname: Test\n---\n\n# Only Heading\n\n')

      const result = service.scanConfigs()

      const agent = result.importedTypes.find(t => t.source.type === 'plugin-agent')
      expect(agent?.description).toBe('No description available')
    })
  })

  describe('stopWatching', () => {
    it('should clear refresh timeout when stopping', async () => {
      vi.useFakeTimers()

      mockExistsSync.mockReturnValue(true)
      let changeHandler: ((path: string) => void) | null = null
      const mockWatcher = {
        on: vi.fn((event, handler) => {
          if (event === 'change') changeHandler = handler
          return mockWatcher
        }),
        close: vi.fn()
      }
      vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any)

      service.startWatching()

      // Simulate a file change to trigger debounced refresh
      if (changeHandler) {
        changeHandler('/some/path')
      }

      // Stop watching before debounce completes
      service.stopWatching()

      // Advance timers - refresh should NOT be called
      vi.advanceTimersByTime(2000)

      // If cleanup worked, the watcher should be closed and no refresh should occur
      expect(mockWatcher.close).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should be safe to call stopWatching when not watching', () => {
      // Should not throw
      expect(() => service.stopWatching()).not.toThrow()
    })
  })

  describe('cleanup', () => {
    it('should clear cached scan result', () => {
      setupMockPluginStructure()

      // First scan to populate cache
      const result1 = service.getScanResult()
      expect(result1.plugins).toHaveLength(1)

      // Cleanup
      service.cleanup()

      // Next call should perform fresh scan
      const result2 = service.getScanResult()

      // Results should be different objects (fresh scan)
      expect(result1).not.toBe(result2)
    })
  })

  describe('getEnabledImports - plugin filtering', () => {
    it('should allow specific plugin when in enabledPlugins list', () => {
      setupMockPluginStructure()
      service.updateSettings({
        enabled: true,
        enabledPlugins: ['anthropic/test-plugin'],
        disabledAgentIds: []
      })

      const enabled = service.getEnabledImports()

      expect(enabled.length).toBe(2) // Both agent and skill
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
  setupMockPluginWithCustomAgent('---\nname: Test Agent\ndescription: A test agent for exploring\n---\n\nThis is the agent content.\n')
}

/**
 * Helper to set up a mock plugin with a custom agent markdown content.
 */
function setupMockPluginWithCustomAgent(agentContent: string): void {
  const paths = {
    cache: '/test/.claude/plugins/cache',
    marketplace: '/test/.claude/plugins/cache/anthropic',
    plugin: '/test/.claude/plugins/cache/anthropic/test-plugin',
    version: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0',
    pluginJson: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/.claude-plugin/plugin.json',
    agents: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/agents',
    skills: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/skills',
    skillMd: '/test/.claude/plugins/cache/anthropic/test-plugin/1.0.0/skills/test-skill/SKILL.md'
  }

  const validPaths = new Set(['/test/.claude', paths.cache, paths.pluginJson, paths.agents, paths.skills, paths.skillMd])
  mockExistsSync.mockImplementation((path) => validPaths.has(String(path)))

  const dirContents: Record<string, string[]> = {
    [paths.cache]: ['anthropic'],
    [paths.marketplace]: ['test-plugin'],
    [paths.plugin]: ['1.0.0'],
    [paths.agents]: ['test-agent.md'],
    [paths.skills]: ['test-skill']
  }
  mockReaddirSync.mockImplementation((path) => (dirContents[String(path)] || []) as any)
  mockStatSync.mockReturnValue({ isDirectory: () => true } as any)

  mockReadFileSync.mockImplementation((path) => {
    const pathStr = String(path)
    if (pathStr === paths.pluginJson) {
      return JSON.stringify({ name: 'Test Plugin', version: '1.0.0', description: 'A test plugin' })
    }
    if (pathStr.includes('test-agent.md')) {
      return agentContent
    }
    if (pathStr.includes('SKILL.md')) {
      return '---\nname: Test Skill\ndescription: A test skill\n---\n\nThis is the skill content.\n'
    }
    return ''
  })
}
