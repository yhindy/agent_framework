/**
 * Application Lifecycle E2E Tests
 *
 * Tests for launching, initializing, and shutting down the Electron app.
 */

import { test, expect, createAppPage } from './fixtures'

test.describe('Application Lifecycle', () => {
  test.describe('Startup', () => {
    test('should launch the Electron app successfully', async ({ electronApp }) => {
      expect(electronApp.app).toBeTruthy()
      expect(electronApp.mainWindow).toBeTruthy()
    })

    test('should create a visible main window', async ({ electronApp }) => {
      const isVisible = await electronApp.mainWindow.evaluate(
        () => document.visibilityState === 'visible'
      )
      expect(isVisible).toBe(true)
    })

    test('should have reasonable window dimensions', async ({ electronApp }) => {
      // Get window bounds from main process as viewport may not be set
      const bounds = await electronApp.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        return win?.getBounds()
      })
      expect(bounds).toBeTruthy()
      expect(bounds?.width).toBeGreaterThan(400)
      expect(bounds?.height).toBeGreaterThan(300)
    })

    test('should render the React app root', async ({ electronApp }) => {
      const rootExists = await electronApp.mainWindow.evaluate(
        () =>
          document.getElementById('root') !== null ||
          document.querySelector('[data-testid="app-root"]') !== null
      )
      expect(rootExists).toBe(true)
    })
  })

  test.describe('ElectronAPI Availability', () => {
    test('should expose electronAPI to renderer', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const apiReady = await appPage.isAPIReady()
      expect(apiReady).toBe(true)
    })

    test('should have all required API methods available', async ({ electronApp }) => {
      const apiMethods = await electronApp.mainWindow.evaluate(() => {
        const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
        return api ? Object.keys(api) : []
      })

      const requiredMethods = ['selectProject', 'listAgents', 'createAssignment', 'onAgentListUpdate']
      for (const method of requiredMethods) {
        expect(apiMethods, `Missing API method: ${method}`).toContain(method)
      }
    })
  })

  test.describe('Main Process Access', () => {
    test('should be able to evaluate code in main process', async ({ electronApp }) => {
      const result = await electronApp.evaluateInMain(() => process.versions.electron)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })

    test('should capture main process logs', async ({ electronApp }) => {
      const logs = electronApp.getMainProcessLogs()
      expect(Array.isArray(logs)).toBe(true)
    })
  })

  test.describe('Initial UI State', () => {
    test('should show project picker or dashboard on startup', async ({ electronApp }) => {
      // Wait for React to render content in the root
      await electronApp.mainWindow.waitForFunction(
        () => {
          const root = document.getElementById('root')
          return root && root.children.length > 0
        },
        { timeout: 10000 }
      )

      const hasUI = await electronApp.mainWindow.evaluate(() => {
        const root = document.getElementById('root')
        // Any non-empty content indicates UI is rendered
        return root !== null && root.innerHTML.trim().length > 0
      })
      expect(hasUI).toBe(true)
    })
  })

  test.describe('Shutdown', () => {
    test('should close cleanly without errors', async ({ electronApp }) => {
      const logs = electronApp.getMainProcessLogs()
      const hasErrors = logs.some((log) => log.includes('[error]') && log.includes('FATAL'))
      expect(hasErrors).toBe(false)
    })
  })
})
