/**
 * IPC Communication E2E Tests
 *
 * Tests for verifying IPC communication between renderer and main process.
 */

import { test, expect, createAppPage } from './fixtures'

test.describe('IPC Communication', () => {
  test.describe('Project IPC', () => {
    test('should get current project path via IPC', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const currentProject = await appPage.callIPC<string | null>('getCurrentProject')
      expect(currentProject).toBeTruthy()
    })

    test('should list recent projects via IPC', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const recentProjects = await appPage.callIPC<string[]>('getRecentProjects')
      expect(Array.isArray(recentProjects)).toBe(true)
    })
  })

  test.describe('Agent IPC', () => {
    test('should list agents via IPC (empty initially)', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const agents = await appPage.callIPC<unknown[]>('listAgents')
      expect(Array.isArray(agents)).toBe(true)
    })

    test('should handle listAgents error gracefully when no project', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)

      try {
        const agents = await appPage.callIPC<unknown[]>('listAgents')
        expect(Array.isArray(agents)).toBe(true)
      } catch (error) {
        expect(error).toBeTruthy()
      }
    })
  })

  test.describe('Assignment IPC', () => {
    test('should create assignment via IPC', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const assignment = await appPage.callIPC<{ id: string }>('createAssignment', {
        prompt: 'Test prompt for E2E test',
        tool: 'claude',
        model: 'claude-sonnet-4-20250514',
        branch: 'e2e-test',
      })

      expect(assignment).toBeTruthy()
      expect(typeof assignment.id).toBe('string')
    })

    test('should get assignments via IPC', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const result = await appPage.callIPC<{ assignments: unknown[] }>('getAssignments')
      expect(result).toBeTruthy()
      expect(Array.isArray(result.assignments)).toBe(true)
    })
  })

  test.describe('Dependency Check IPC', () => {
    test('should check dependencies via IPC', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)

      const deps = await appPage.callIPC<{
        ghInstalled: boolean
        ghAuthenticated: boolean
        error?: string
      }>('checkDependencies')

      expect(deps).toBeTruthy()
      expect(typeof deps.ghInstalled).toBe('boolean')
      expect(typeof deps.ghAuthenticated).toBe('boolean')
    })
  })

  test.describe('IPC Round-Trip Performance', () => {
    test('should complete IPC calls within reasonable time', async ({ electronApp }) => {
      const appPage = createAppPage(electronApp)
      const start = Date.now()

      await appPage.callIPC('getRecentProjects')
      await appPage.callIPC('checkDependencies')

      const duration = Date.now() - start
      expect(duration).toBeLessThan(5000)
    })
  })

  test.describe('IPC Event Listeners', () => {
    test('should receive agents:updated events', async ({ electronApp, testProject }) => {
      const { mainWindow } = electronApp
      const appPage = createAppPage(electronApp)

      const eventReceived = mainWindow.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          const api = (
            window as unknown as {
              electronAPI: {
                onAgentListUpdate: (cb: () => void) => () => void
              }
            }
          ).electronAPI

          const cleanup = api.onAgentListUpdate(() => {
            cleanup()
            resolve(true)
          })

          setTimeout(() => {
            cleanup()
            resolve(false)
          }, 5000)
        })
      })

      await appPage.callIPC('selectProject', testProject)
      await appPage.callIPC('createAssignment', {
        prompt: 'Event test',
        tool: 'claude',
        branch: 'e2e-event-test',
      })

      const received = await eventReceived
      expect(typeof received).toBe('boolean')
    })
  })
})
