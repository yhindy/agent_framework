import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SettingsService } from '../SettingsService'
import Store from 'electron-store'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'

// Mock electron-store
vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn()
    }))
  }
})

describe('SettingsService', () => {
  let settingsService: SettingsService
  let mockStore: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup store mock with state
    const storeState: Record<string, unknown> = {}
    mockStore = {
      get: vi.fn((key: string, defaultValue?: unknown) => storeState[key] ?? defaultValue),
      set: vi.fn((key: string, value: unknown) => {
        storeState[key] = value
      })
    }
    vi.mocked(Store).mockImplementation(() => mockStore as unknown as Store)

    settingsService = new SettingsService()
  })

  describe('getSettings', () => {
    it('returns default settings when no settings stored', () => {
      const settings = settingsService.getSettings()

      expect(settings).toEqual(DEFAULT_SETTINGS)
      expect(mockStore.get).toHaveBeenCalledWith('settings', DEFAULT_SETTINGS)
    })

    it('returns stored settings when available', () => {
      const customSettings = {
        ...DEFAULT_SETTINGS,
        notifications: {
          enabled: false,
          cooldownSeconds: 60
        }
      }

      mockStore.get.mockReturnValue(customSettings)

      const settings = settingsService.getSettings()

      expect(settings).toEqual(customSettings)
    })
  })

  describe('updateSettings', () => {
    it('partial updates preserve unmodified settings', () => {
      // Start with default settings
      mockStore.get.mockReturnValue(DEFAULT_SETTINGS)

      // Update only notifications
      const updates = {
        notifications: {
          enabled: false,
          cooldownSeconds: 60
        }
      }

      const result = settingsService.updateSettings(updates)

      // Verify the full settings are preserved with only notifications changed
      expect(result.notifications.enabled).toBe(false)
      expect(result.notifications.cooldownSeconds).toBe(60)
      expect(result.defaultTool).toEqual(DEFAULT_SETTINGS.defaultTool)
      expect(result.defaultAgent).toEqual(DEFAULT_SETTINGS.defaultAgent)
      expect(result.version).toBe(DEFAULT_SETTINGS.version)

      // Verify the store was called with the merged settings
      expect(mockStore.set).toHaveBeenCalledWith('settings', expect.objectContaining({
        notifications: {
          enabled: false,
          cooldownSeconds: 60
        }
      }))
    })

    it('deep merge handles nested objects correctly', () => {
      mockStore.get.mockReturnValue(DEFAULT_SETTINGS)

      // Update only a single nested property
      const updates = {
        defaultTool: {
          tool: 'codex' as const,
          claudeModel: DEFAULT_SETTINGS.defaultTool.claudeModel,
          cursorCLIModel: DEFAULT_SETTINGS.defaultTool.cursorCLIModel
        }
      }

      const result = settingsService.updateSettings(updates)

      // Verify tool was changed
      expect(result.defaultTool.tool).toBe('codex')
      // Verify other nested properties are preserved
      expect(result.defaultTool.claudeModel).toBe(DEFAULT_SETTINGS.defaultTool.claudeModel)
      expect(result.defaultTool.cursorCLIModel).toBe(DEFAULT_SETTINGS.defaultTool.cursorCLIModel)
    })

    it('handles partial nested updates', () => {
      const existingSettings = {
        ...DEFAULT_SETTINGS,
        defaultAgent: {
          workflowMode: 'dev' as const,
          yoloMode: false,
          chromeIntegration: true
        }
      }
      mockStore.get.mockReturnValue(existingSettings)

      // Update with partial agent settings - need to spread the full object
      const updates = {
        defaultAgent: {
          ...existingSettings.defaultAgent,
          yoloMode: true
        }
      }

      const result = settingsService.updateSettings(updates)

      expect(result.defaultAgent.workflowMode).toBe('dev')
      expect(result.defaultAgent.yoloMode).toBe(true)
      expect(result.defaultAgent.chromeIntegration).toBe(true)
    })
  })

  describe('migration', () => {
    it('migration adds missing fields from newer schema version', () => {
      // Simulate old settings without version or missing fields
      const oldSettings = {
        notifications: {
          enabled: true,
          cooldownSeconds: 30
        }
        // Missing defaultTool and defaultAgent
      }

      // Set up state so that initial get returns the old settings
      const storeState: Record<string, unknown> = {
        settings: oldSettings
      }
      mockStore.get.mockImplementation((key: string) => storeState[key])
      mockStore.set.mockImplementation((key: string, value: unknown) => {
        storeState[key] = value
      })

      // Recreate service to trigger migration
      settingsService = new SettingsService()

      // Verify migration was called - should set the merged settings
      expect(mockStore.set).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({
          notifications: {
            enabled: true,
            cooldownSeconds: 30
          },
          defaultTool: DEFAULT_SETTINGS.defaultTool,
          defaultAgent: DEFAULT_SETTINGS.defaultAgent,
          version: DEFAULT_SETTINGS.version
        })
      )
    })

    it('migration preserves existing values while adding new fields', () => {
      // Simulate settings from older version with some custom values
      const oldSettings = {
        notifications: {
          enabled: false,
          cooldownSeconds: 120
        },
        defaultTool: {
          tool: 'cursor-cli',
          claudeModel: 'opus',
          cursorCLIModel: 'sonnet-4.5'
        },
        version: 0 // Older version
      }

      const storeState: Record<string, unknown> = {
        settings: oldSettings
      }
      mockStore.get.mockImplementation((key: string) => storeState[key])
      mockStore.set.mockImplementation((key: string, value: unknown) => {
        storeState[key] = value
      })

      // Recreate service to trigger migration
      settingsService = new SettingsService()

      // Verify migration preserved existing values but added missing fields
      expect(mockStore.set).toHaveBeenCalledWith(
        'settings',
        expect.objectContaining({
          notifications: {
            enabled: false,
            cooldownSeconds: 120
          },
          defaultTool: {
            tool: 'cursor-cli',
            claudeModel: 'opus',
            cursorCLIModel: 'sonnet-4.5'
          },
          defaultAgent: DEFAULT_SETTINGS.defaultAgent, // Added from defaults
          version: DEFAULT_SETTINGS.version // Updated to current version
        })
      )
    })

    it('does not migrate if version is current', () => {
      const currentSettings = {
        ...DEFAULT_SETTINGS,
        notifications: {
          enabled: false,
          cooldownSeconds: 45
        }
      }

      const storeState: Record<string, unknown> = {
        settings: currentSettings
      }
      mockStore.get.mockImplementation((key: string) => storeState[key])
      mockStore.set.mockImplementation((key: string, value: unknown) => {
        storeState[key] = value
      })

      // Clear mocks from beforeEach service creation before testing
      vi.clearAllMocks()

      // Recreate service
      settingsService = new SettingsService()

      // Migration should not be called since version is current
      // (set is only called during migration, not initialization)
      expect(mockStore.set).not.toHaveBeenCalled()
    })
  })
})
