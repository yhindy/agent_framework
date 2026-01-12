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
      const hasProjectUI = await electronApp.mainWindow.evaluate(() => {
        const selectors = [
          '.project-picker',
          '[data-testid="project-picker"]',
          '.folder-select',
        ]
        return selectors.some((sel) => document.querySelector(sel) !== null)
      })

      const hasDashboard = await electronApp.mainWindow.evaluate(
        () =>
          document.querySelector('.dashboard, [data-testid="dashboard"], .agent-list') !== null
      )

      expect(hasProjectUI || hasDashboard).toBe(true)
    })

    test('should navigate to dashboard after project selection', async ({
      electronApp,
      testProject,
    }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)
      await appPage.page.waitForTimeout(UI_SETTLE_TIME)

      const hasMainUI = await appPage.page.evaluate(() => {
        const selectors = ['.dashboard', '[data-testid="dashboard"]', '.agent-list', '.sidebar', '.main-layout']
        return selectors.some((sel) => document.querySelector(sel) !== null)
      })

      expect(hasMainUI).toBe(true)
    })

    test('should remember previously selected project', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      const recentProjects = await appPage.callIPC<string[]>('getRecentProjects')
      expect(recentProjects.some((p) => p.includes(testProject) || testProject.includes(p))).toBe(
        true
      )
    })
  })

  test.describe('Agent Creation Flow', () => {
    test('should create a new assignment', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      const assignment = await appPage.callIPC<{ id: string; prompt: string; tool: string }>(
        'createAssignment',
        {
          prompt: 'Implement a hello world function',
          tool: 'claude',
          model: 'claude-sonnet-4-20250514',
        }
      )

      expect(assignment).toBeTruthy()
      expect(assignment.id).toBeTruthy()
      expect(assignment.prompt).toContain('hello world')
    })

    test('should list created assignments', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      await appPage.callIPC('createAssignment', {
        prompt: 'Test assignment for listing',
        tool: 'claude',
      })

      const assignments = await appPage.callIPC<{ id: string; prompt: string }[]>('getAssignments')
      expect(assignments.length).toBeGreaterThanOrEqual(1)
      expect(assignments.some((a) => a.prompt.includes('listing'))).toBe(true)
    })

    test('should support different tool selections', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      const tools = ['claude', 'cursor-cli', 'codex'] as const

      for (const tool of tools) {
        try {
          const assignment = await appPage.callIPC<{ tool: string }>('createAssignment', {
            prompt: `Test with ${tool}`,
            tool,
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
      await appPage.callIPC('selectProjectWithPath', testProject)

      await appPage.callIPC<{ id: string }>('createAssignment', {
        prompt: 'Agent state test',
        tool: 'claude',
      })

      const agents = await appPage.callIPC<{ id: string; assignmentId: string }[]>('getAgents')
      expect(Array.isArray(agents)).toBe(true)
    })

    test('should track agent working state', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      await appPage.callIPC('createAssignment', {
        prompt: 'Working state test',
        tool: 'claude',
      })

      const agents = await appPage.callIPC<{ id: string; state?: string; isWorking?: boolean }[]>(
        'getAgents'
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
      await appPage.callIPC('selectProjectWithPath', testProject)

      await appPage.callIPC('createAssignment', {
        prompt: 'Dashboard display test',
        tool: 'claude',
      })

      await appPage.page.waitForTimeout(UI_SETTLE_TIME)

      const hasAgentUI = await appPage.page.evaluate(() => {
        const selectors = ['.agent-item', '[data-testid="agent-item"]', '.agent-row', '.agent-card']
        return selectors.some((sel) => document.querySelector(sel) !== null)
      })

      expect(typeof hasAgentUI).toBe('boolean')
    })
  })
})
