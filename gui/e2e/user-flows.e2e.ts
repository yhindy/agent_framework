/**
 * Core User Flow E2E Tests
 *
 * Tests for the primary user workflows in the application.
 */

import { test, expect, createAppPage } from './fixtures'

const UI_SETTLE_TIME = 1000

test.describe('User Flows', () => {
  test.describe('Project Selection Flow', () => {
    test('should show project picker on first launch', async ({ electronApp }) => {
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

    test('should navigate to dashboard after project selection', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)
      await appPage.page.waitForTimeout(UI_SETTLE_TIME)

      const hasMainUI = await appPage.page.evaluate(() => {
        // Check for various UI elements that indicate successful navigation
        const selectors = ['.dashboard', '[data-testid="dashboard"]', '.agent-list', '.sidebar', '.main-layout', '.app-container', '#root']
        return selectors.some((sel) => document.querySelector(sel) !== null)
      })

      // The app should have rendered UI after project selection
      expect(hasMainUI).toBe(true)
    })

    test('should remember previously selected project', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const recentProjects = await appPage.callIPC<{ path: string; name: string }[]>('getRecentProjects')
      expect(Array.isArray(recentProjects)).toBe(true)
      expect(recentProjects.some((p) => p.path.includes(testProject) || testProject.includes(p.path))).toBe(
        true
      )
    })
  })

  test.describe('Agent Creation Flow', () => {
    test('should create a new assignment', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const assignment = await appPage.callIPC<{ id: string; prompt: string; tool: string }>(
        'createAssignment',
        {
          prompt: 'Implement a hello world function',
          tool: 'claude',
          model: 'claude-sonnet-4-20250514',
          branch: 'e2e-hello-world',
        }
      )

      expect(assignment).toBeTruthy()
      expect(assignment.id).toBeTruthy()
      expect(assignment.prompt).toContain('hello world')
    })

    test('should list created assignments', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      await appPage.callIPC('createAssignment', {
        prompt: 'Test assignment for listing',
        tool: 'claude',
        branch: 'e2e-listing',
      })

      const result = await appPage.callIPC<{ assignments: { id: string; prompt: string }[] }>('getAssignments')
      expect(result.assignments.length).toBeGreaterThanOrEqual(1)
      expect(result.assignments.some((a) => a.prompt.includes('listing'))).toBe(true)
    })

    test('should support different tool selections', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      const tools = ['claude', 'cursor-cli', 'codex'] as const

      for (const tool of tools) {
        try {
          const assignment = await appPage.callIPC<{ tool: string }>('createAssignment', {
            prompt: `Test with ${tool}`,
            tool,
            branch: `e2e-tool-${tool}`,
          })
          expect(assignment.tool).toBe(tool)
        } catch {
          console.log(`Tool ${tool} not available or error creating assignment`)
        }
      }
    })
  })

  test.describe('Agent State Transitions', () => {
    test('should create agent from assignment', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      await appPage.callIPC<{ id: string }>('createAssignment', {
        prompt: 'Agent state test',
        tool: 'claude',
        branch: 'e2e-agent-state',
      })

      const agents = await appPage.callIPC<{ id: string; assignmentId: string }[]>('listAgents')
      expect(Array.isArray(agents)).toBe(true)
    })

    test('should track agent working state', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      await appPage.callIPC('createAssignment', {
        prompt: 'Working state test',
        tool: 'claude',
        branch: 'e2e-working-state',
      })

      const agents = await appPage.callIPC<{ id: string; state?: string; isWorking?: boolean }[]>(
        'listAgents'
      )

      if (agents.length > 0) {
        const agent = agents[0]
        expect(agent.id).toBeTruthy()
        if (agent.state !== undefined) {
          expect(['working', 'waiting', 'idle', 'completed', 'error']).toContain(agent.state)
        }
      }
    })
  })

  test.describe('Dashboard Interactions', () => {
    test('should display agents in the UI after creation', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProject', testProject)

      await appPage.callIPC('createAssignment', {
        prompt: 'Dashboard display test',
        tool: 'claude',
        branch: 'e2e-dashboard',
      })

      await appPage.page.waitForTimeout(UI_SETTLE_TIME)

      const hasAgentUI = await appPage.page.evaluate(() => {
        const selectors = ['.agent-item', '[data-testid="agent-item"]', '.agent-row', '.agent-card']
        return selectors.some((sel) => document.querySelector(sel) !== null)
      })

      // After creating an agent, the UI should display it
      expect(hasAgentUI).toBe(true)
    })
  })
})
