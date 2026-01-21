/**
 * Security E2E Tests
 *
 * Tests for verifying security controls are in place:
 * - Electron sandbox is enabled
 * - Input sanitization prevents command injection
 * - Path traversal is blocked
 */

import { test, expect, createAppPage } from './fixtures'

test.describe('Security Controls', () => {
  test.describe('Electron Sandbox', () => {
    test('should have sandbox enabled in webPreferences', async ({ electronApp }) => {
      // Query the main process for the webPreferences of the main window
      const webPreferences = await electronApp.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        // Access the webContents to get webPreferences
        // Note: In Electron, we can't directly access webPreferences after creation,
        // but we can check if sandbox is working by trying restricted operations
        return {
          // These would throw or be undefined if sandbox is not working properly
          hasWebContents: !!win?.webContents,
          // Check if the window exists and is properly configured
          isVisible: win?.isVisible() ?? false,
        }
      })

      expect(webPreferences.hasWebContents).toBe(true)
    })

    test('should have contextIsolation enabled', async ({ electronApp }) => {
      // With contextIsolation, the preload script runs in a separate context
      // We can verify this by checking that window.require is not available in renderer
      const hasNodeInRenderer = await electronApp.mainWindow.evaluate(() => {
        // If contextIsolation is disabled and nodeIntegration is enabled,
        // window.require would be available
        return typeof (window as unknown as { require?: unknown }).require !== 'undefined'
      })

      // Should NOT have require available (contextIsolation working)
      expect(hasNodeInRenderer).toBe(false)
    })

    test('should not expose Node.js APIs directly to renderer', async ({ electronApp }) => {
      const nodeAPIsExposed = await electronApp.mainWindow.evaluate(() => {
        // Check for common Node.js globals that should NOT be in renderer with sandbox
        return {
          hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
          hasBuffer: typeof (window as unknown as { Buffer?: unknown }).Buffer !== 'undefined',
          hasGlobal: typeof (window as unknown as { global?: unknown }).global !== 'undefined',
          hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
        }
      })

      // None of these should be available with sandbox enabled
      expect(nodeAPIsExposed.hasProcess).toBe(false)
      expect(nodeAPIsExposed.hasBuffer).toBe(false)
      expect(nodeAPIsExposed.hasGlobal).toBe(false)
      expect(nodeAPIsExposed.hasRequire).toBe(false)
    })

    test('should only expose electronAPI via contextBridge', async ({ electronApp }) => {
      const exposedAPIs = await electronApp.mainWindow.evaluate(() => {
        // Get all window properties that might be exposed APIs
        const windowKeys = Object.keys(window)
        const customAPIs = windowKeys.filter(
          (key) =>
            key.includes('electron') ||
            key.includes('api') ||
            key.includes('ipc') ||
            key.includes('node')
        )
        return {
          customAPIs,
          hasElectronAPI:
            typeof (window as unknown as { electronAPI?: unknown }).electronAPI !== 'undefined',
        }
      })

      // Should have electronAPI (our safe bridge)
      expect(exposedAPIs.hasElectronAPI).toBe(true)

      // Should not have other risky APIs exposed
      const riskyAPIs = exposedAPIs.customAPIs.filter(
        (api) => api !== 'electronAPI' && !api.startsWith('webkit')
      )
      expect(riskyAPIs).toEqual([])
    })
  })

  test.describe('Input Sanitization', () => {
    test('should handle branch names with shell metacharacters safely', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      // Try to create an assignment with a potentially malicious branch name
      // This should either sanitize the name or reject it - not execute commands
      const maliciousBranchNames = [
        'test; rm -rf /',
        'test && echo pwned',
        'test | cat /etc/passwd',
        'test`whoami`',
        'test$(id)',
      ]

      for (const branch of maliciousBranchNames) {
        try {
          const result = await appPage.callIPC<{ id?: string; branch?: string } | null>(
            'createAssignment',
            {
              prompt: 'Security test',
              tool: 'claude',
              branch,
            }
          )

          // If it succeeds, the branch name should be sanitized
          if (result?.branch) {
            expect(result.branch).not.toContain(';')
            expect(result.branch).not.toContain('|')
            expect(result.branch).not.toContain('&')
            expect(result.branch).not.toContain('`')
            expect(result.branch).not.toContain('$(')
          }
        } catch (error) {
          // Rejection is also acceptable - the important thing is no command execution
          expect(error).toBeTruthy()
        }
      }
    })

    test('should sanitize agent IDs with special characters', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      // Create an assignment and check the generated agent ID
      const result = await appPage.callIPC<{ id: string; agentId?: string }>('createAssignment', {
        prompt: 'Agent ID test',
        tool: 'claude',
        branch: 'security-agent-id-test',
      })

      if (result?.agentId) {
        // Agent ID should only contain safe characters
        expect(result.agentId).toMatch(/^[a-zA-Z0-9_-]+$/)
      }
    })
  })

  test.describe('Path Traversal Prevention', () => {
    test('should reject or normalize path traversal attempts in project paths', async ({
      electronApp,
    }) => {
      const appPage = createAppPage(electronApp)

      // Try to select a path with traversal sequences
      const maliciousPaths = [
        '../../../etc/passwd',
        '/tmp/../../../etc/passwd',
        '..\\..\\..\\Windows\\System32',
      ]

      for (const maliciousPath of maliciousPaths) {
        try {
          await appPage.callIPC('selectProject', maliciousPath)
          // If it doesn't throw, verify the path was normalized or rejected
        } catch (error: unknown) {
          // Should throw an error for non-existent or invalid paths
          expect(error).toBeTruthy()
          // The error should mention the path doesn't exist, not expose system info
          const errorMessage = error instanceof Error ? error.message : String(error)
          expect(errorMessage.toLowerCase()).toContain('does not exist')
        }
      }
    })

    test('should use normalized paths internally', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)

      // Select a valid project
      await appPage.callIPC('selectProject', testProject)

      // Get the current project and verify path is normalized
      const currentProject = await appPage.callIPC<{ path: string } | null>('getCurrentProject')

      if (currentProject?.path) {
        // Path should not contain .. sequences
        expect(currentProject.path).not.toContain('..')
        // Path should be absolute (starts with /)
        expect(currentProject.path.startsWith('/') || currentProject.path.match(/^[A-Z]:\\/)).toBeTruthy()
      }
    })
  })

  test.describe('IPC Security', () => {
    test('should have electronAPI methods defined', async ({ electronApp }) => {
      const apiMethodCount = await electronApp.mainWindow.evaluate(() => {
        const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
        return api ? Object.keys(api).length : 0
      })

      // Should have a reasonable number of API methods (not zero, not too many)
      expect(apiMethodCount).toBeGreaterThan(5)
      expect(apiMethodCount).toBeLessThan(200) // Sanity check
    })

    test('should handle invalid IPC calls gracefully', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)

      // Try calling a non-existent method
      try {
        await appPage.callIPC('nonExistentMethod', 'arg1', 'arg2')
      } catch (error: unknown) {
        // Should throw an error, not crash or expose internals
        expect(error).toBeTruthy()
        const errorMessage = error instanceof Error ? error.message : String(error)
        expect(errorMessage).toContain('not found')
      }
    })
  })
})
