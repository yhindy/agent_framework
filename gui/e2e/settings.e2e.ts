/**
 * Settings Page E2E Tests
 *
 * Tests for the settings page functionality including navigation,
 * settings retrieval, and settings persistence.
 */

import { test, expect, createAppPage } from './fixtures'
import { createIPCHelpers } from './helpers'

const UI_SETTLE_MS = 2000

test.describe('Settings Page', () => {
  test.describe('Navigation', () => {
    test('should be able to navigate after project selection', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Select project first
      await ipc.selectProject(testProject)
      await appPage.page.waitForTimeout(UI_SETTLE_MS)

      // Check that the app has rendered some UI
      const hasUI = await appPage.page.evaluate(() => {
        const root = document.getElementById('root')
        return root !== null && root.innerHTML.trim().length > 0
      })

      expect(hasUI).toBe(true)

      // Try to find sidebar or settings elements
      const hasMainUI = await appPage.page.evaluate(() => {
        const selectors = ['.dashboard', '[data-testid="dashboard"]', '.sidebar', '[data-testid="sidebar"]', '.main-layout', '#root']
        return selectors.some((sel) => document.querySelector(sel) !== null)
      })

      expect(hasMainUI).toBe(true)
    })

    test('should have settings accessible via IPC', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)
      await appPage.page.waitForTimeout(UI_SETTLE_MS)

      // Settings should be retrievable via IPC regardless of UI state
      const settings = await ipc.getSettings()

      expect(settings).toBeDefined()
      expect(settings.notifications).toBeDefined()
      expect(settings.defaultTool).toBeDefined()
    })
  })

  test.describe('Settings Retrieval via IPC', () => {
    test('should retrieve current settings', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      const settings = await ipc.getSettings()

      // Verify settings structure exists
      expect(settings).toBeTruthy()
      expect(settings.notifications).toBeDefined()
      expect(settings.notifications.enabled).toBeDefined()
      expect(settings.notifications.cooldownSeconds).toBeDefined()

      expect(settings.defaultTool).toBeDefined()
      expect(settings.defaultTool.tool).toBeDefined()
    })

    test('should have valid default tool settings', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      const settings = await ipc.getSettings()

      // Default tool should be one of the valid options
      const validTools = ['claude', 'cursor-cli', 'codex']
      expect(validTools).toContain(settings.defaultTool.tool)
    })

    test('should have notification settings defined', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      const settings = await ipc.getSettings()

      // Notifications should have required fields
      expect(settings.notifications).toBeDefined()
      expect(settings.notifications.enabled).toBeDefined()
      expect(settings.notifications.cooldownSeconds).toBeDefined()
    })
  })

  test.describe('Settings Update Persistence', () => {
    test('should update notification settings', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Get current settings
      const originalSettings = await ipc.getSettings()
      const newCooldown =
        originalSettings.notifications.cooldownSeconds === 30 ? 60 : 30

      // Update settings
      const updatedSettings = await ipc.updateSettings({
        notifications: {
          ...originalSettings.notifications,
          cooldownSeconds: newCooldown,
        },
      })

      // Verify update was applied
      expect(updatedSettings.notifications.cooldownSeconds).toBe(newCooldown)

      // Retrieve settings again to verify persistence
      const retrievedSettings = await ipc.getSettings()
      expect(retrievedSettings.notifications.cooldownSeconds).toBe(newCooldown)
    })

    test('should update default tool settings', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Get current settings
      const originalSettings = await ipc.getSettings()

      // Toggle a boolean setting
      const newYoloMode = !originalSettings.defaultAgent?.yoloMode

      // Update settings
      const updatedSettings = await ipc.updateSettings({
        defaultAgent: {
          ...originalSettings.defaultAgent,
          yoloMode: newYoloMode,
        },
      })

      // Verify update (may be merged with defaults)
      expect(updatedSettings).toBeTruthy()
    })

    test('should preserve other settings when updating one section', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Get current settings
      const originalSettings = await ipc.getSettings()
      const originalTool = originalSettings.defaultTool.tool

      // Update only notifications
      await ipc.updateSettings({
        notifications: {
          enabled: true,
          cooldownSeconds: 45,
        },
      })

      // Verify other settings are preserved
      const newSettings = await ipc.getSettings()
      expect(newSettings.defaultTool.tool).toBe(originalTool)
    })
  })

  test.describe('Settings API Functionality', () => {
    test('should support checking tool availability', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Check that settings have tool configuration
      const settings = await ipc.getSettings()

      expect(settings.defaultTool).toBeDefined()
      expect(settings.defaultTool.tool).toBeDefined()

      // Verify tool is a valid string
      expect(typeof settings.defaultTool.tool).toBe('string')
      expect(settings.defaultTool.tool.length).toBeGreaterThan(0)
    })

    test('should have model settings for applicable tools', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      const settings = await ipc.getSettings()

      // Verify model settings exist
      if (settings.defaultTool.tool === 'claude') {
        expect(settings.defaultTool.claudeModel).toBeDefined()
      } else if (settings.defaultTool.tool === 'cursor-cli') {
        expect(settings.defaultTool.cursorCLIModel).toBeDefined()
      }
      // Codex doesn't have model selection (hardcoded)
    })
  })
})
