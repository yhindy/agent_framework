/**
 * Playwright Test Fixtures for Electron E2E Testing
 */

import { test as base, expect } from '@playwright/test'
import {
  launchElectronApp,
  waitForAppReady,
  createTestProject,
  cleanupTestProject,
  captureScreenshot,
  type ElectronAppContext,
} from './electron-app'

export interface ElectronTestFixtures {
  electronApp: ElectronAppContext
  testProject: string
}

export interface ElectronWorkerFixtures {
  headed: boolean
}

export const test = base.extend<ElectronTestFixtures, ElectronWorkerFixtures>({
  headed: [false, { scope: 'worker', option: true }],

  electronApp: async ({}, use, testInfo) => {
    const testProject = await createTestProject(`test-${testInfo.testId}`)
    const context = await launchElectronApp({ testProjectPath: testProject })
    await waitForAppReady(context)

    await use(context)

    if (testInfo.status !== 'passed') {
      await captureScreenshot(context.mainWindow, `failure-${testInfo.title.replace(/\s+/g, '-')}`)
    }

    await context.close()
    await cleanupTestProject(testProject)
  },

  testProject: async ({}, use, testInfo) => {
    const projectPath = await createTestProject(`project-${testInfo.testId}`)
    await use(projectPath)
    await cleanupTestProject(projectPath)
  },
})

export { expect }

/**
 * Page Object Model helper for common UI interactions.
 */
export class AppPage {
  constructor(private context: ElectronAppContext) {}

  get page() {
    return this.context.mainWindow
  }

  async callIPC<T>(method: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(
      async ({ method, args }) => {
        const api = (window as unknown as { electronAPI: Record<string, (...a: unknown[]) => T> })
          .electronAPI
        if (!api[method]) {
          throw new Error(`IPC method not found: ${method}`)
        }
        return api[method](...args)
      },
      { method, args }
    )
  }

  async isAPIReady(): Promise<boolean> {
    return this.page.evaluate(() => {
      return typeof (window as unknown as { electronAPI?: unknown }).electronAPI !== 'undefined'
    })
  }
}

export function createAppPage(context: ElectronAppContext): AppPage {
  return new AppPage(context)
}
