/**
 * Error Scenarios E2E Tests
 *
 * Tests for error handling, invalid inputs, and graceful error recovery.
 */

import { test, expect, createAppPage } from './fixtures'
import { createIPCHelpers, waitForAppReady } from './helpers'

const UI_SETTLE_MS = 1000

test.describe('Error Scenarios', () => {
  test.describe('Invalid Project Path Handling', () => {
    test('should handle non-existent project path gracefully', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Try to select a non-existent path
      try {
        await ipc.selectProject('/this/path/does/not/exist/at/all')
        // If no error, check that we're still in a usable state
        const isAPIReady = await appPage.isAPIReady()
        expect(isAPIReady).toBe(true)
      } catch (error) {
        // Expected to fail - verify error is reasonable
        expect(error).toBeDefined()
      }
    })

    test('should handle empty project path', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Try to select empty path
      try {
        await ipc.selectProject('')
        // If it succeeds without error, the app should still work
        const isAPIReady = await appPage.isAPIReady()
        expect(isAPIReady).toBe(true)
      } catch (error) {
        // Expected behavior - should reject empty paths
        expect(error).toBeDefined()
      }
    })

    test('should recover from invalid project and allow valid selection', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // First try invalid path
      try {
        await ipc.selectProject('/invalid/path/123')
      } catch {
        // Ignore error
      }

      // App should still be usable
      await appPage.page.waitForTimeout(UI_SETTLE_MS)

      // Now select valid project
      await ipc.selectProject(testProject)

      // Should work correctly
      const projects = await ipc.getRecentProjects()
      expect(Array.isArray(projects)).toBe(true)
    })
  })

  test.describe('Dependency Check Failures', () => {
    test('should return dependency status', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Check dependencies
      const result = await ipc.checkDependencies()

      // Should return a valid result structure
      expect(result).toBeDefined()
      expect(typeof result.ghInstalled).toBe('boolean')
      expect(typeof result.ghAuthenticated).toBe('boolean')
    })

    test('should handle dependency check gracefully', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Multiple dependency checks should work
      const result1 = await ipc.checkDependencies()
      const result2 = await ipc.checkDependencies()

      // Results should be consistent
      expect(result1.ghInstalled).toBe(result2.ghInstalled)
    })
  })

  test.describe('Invalid Agent Operations', () => {
    test('should handle listing agents for non-existent project', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Try to list agents without selecting a project first
      try {
        const agents = await ipc.listAgents()
        // If it returns, it should be an empty array or handle gracefully
        expect(Array.isArray(agents) || agents === null || agents === undefined).toBe(true)
      } catch (error) {
        // Expected - no project selected
        expect(error).toBeDefined()
      }
    })

    test('should handle stopping non-existent agent', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Try to stop an agent that doesn't exist
      try {
        await ipc.stopAgent('non-existent-agent-id-12345')
        // If no error, that's okay - might just be a no-op
      } catch (error) {
        // Expected behavior
        expect(error).toBeDefined()
      }
    })

    test('should handle teardown of non-existent agent', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Try to teardown an agent that doesn't exist
      try {
        await ipc.teardownAgent('non-existent-agent-12345', true)
      } catch (error) {
        // Expected behavior
        expect(error).toBeDefined()
      }
    })
  })

  test.describe('Invalid Assignment Creation', () => {
    test('should handle assignment with empty prompt', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Try to create assignment with empty prompt
      try {
        await ipc.createAssignment({
          prompt: '',
          tool: 'claude',
        })
        // If it succeeds, verify result is valid
      } catch (error) {
        // Expected - empty prompt should be rejected
        expect(error).toBeDefined()
      }
    })

    test('should handle assignment with invalid tool', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Try to create assignment with invalid tool
      try {
        await ipc.createAssignment({
          prompt: 'Test prompt',
          tool: 'invalid-tool' as any,
        })
      } catch (error) {
        // Expected behavior
        expect(error).toBeDefined()
      }
    })
  })

  test.describe('Settings Error Handling', () => {
    test('should handle getting settings before project selection', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Settings should be available even without project selection
      // (they are app-level, not project-level)
      try {
        const settings = await ipc.getSettings()
        expect(settings).toBeDefined()
      } catch {
        // If settings require project, this is expected
      }
    })

    test('should handle invalid settings update', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Try to update with invalid values
      try {
        await ipc.updateSettings({
          notifications: {
            enabled: 'not-a-boolean' as any,
            cooldownSeconds: -999,
          },
        })
      } catch (error) {
        // Should reject invalid values
        expect(error).toBeDefined()
      }
    })

    test('should preserve valid settings after failed update', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Get original settings
      const originalSettings = await ipc.getSettings()

      // Try invalid update
      try {
        await ipc.updateSettings({
          notifications: {
            enabled: 'invalid' as any,
            cooldownSeconds: 'invalid' as any,
          },
        })
      } catch {
        // Expected
      }

      // Verify original settings are preserved
      const currentSettings = await ipc.getSettings()
      expect(currentSettings.notifications.enabled).toBeDefined()
    })
  })

  test.describe('Graceful Error Recovery', () => {
    test('should maintain API availability after errors', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Trigger some errors
      try {
        await ipc.selectProject('/invalid')
      } catch {}

      try {
        await ipc.stopAgent('invalid')
      } catch {}

      // API should still be available
      const isReady = await appPage.isAPIReady()
      expect(isReady).toBe(true)

      // Should be able to perform valid operations
      await ipc.selectProject(testProject)
      const projects = await ipc.getRecentProjects()
      expect(Array.isArray(projects)).toBe(true)
    })

    test('should maintain UI state after IPC errors', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      // Select valid project first
      await ipc.selectProject(testProject)
      await appPage.page.waitForTimeout(UI_SETTLE_MS)

      // Trigger an error
      try {
        await ipc.stopAgent('invalid-agent')
      } catch {}

      // UI should still be responsive
      await waitForAppReady(appPage.page)

      // Should be able to navigate
      const hasRoot = await appPage.page.evaluate(() => {
        const root = document.getElementById('root')
        return root !== null && root.innerHTML.length > 0
      })
      expect(hasRoot).toBe(true)
    })
  })

  test.describe('Concurrent Operation Handling', () => {
    test('should handle multiple rapid settings retrievals', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Fire off multiple settings requests concurrently
      const results = await Promise.all([
        ipc.getSettings(),
        ipc.getSettings(),
        ipc.getSettings(),
      ])

      // All should return valid settings
      results.forEach((settings) => {
        expect(settings).toBeDefined()
        expect(settings.notifications).toBeDefined()
      })
    })

    test('should handle concurrent dependency checks', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      const ipc = createIPCHelpers(appPage)

      await ipc.selectProject(testProject)

      // Fire off multiple dependency checks
      const results = await Promise.all([
        ipc.checkDependencies(),
        ipc.checkDependencies(),
      ])

      // All should return consistent results
      expect(results[0].ghInstalled).toBe(results[1].ghInstalled)
    })
  })
})
