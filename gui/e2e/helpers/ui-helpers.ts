/**
 * UI Interaction Helpers for E2E Testing
 *
 * Provides utility functions for common UI interactions and assertions
 * during E2E tests.
 */

import { Page, Locator, expect } from '@playwright/test'

/**
 * Wait for the app to be fully ready (React rendered and electronAPI available)
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 *
 * @example
 * ```typescript
 * const page = electronApp.mainWindow
 * await waitForAppReady(page)
 * ```
 */
export async function waitForAppReady(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root')
      return root && root.children.length > 0
    },
    { timeout }
  )
}

/**
 * Wait for the electronAPI to be available on the window object
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 */
export async function waitForElectronAPI(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI !== 'undefined',
    { timeout }
  )
}

/**
 * Get the count of visible agent cards on the page
 *
 * @param page - Playwright Page object
 * @returns Number of visible agent cards
 */
export async function getVisibleAgentCount(page: Page): Promise<number> {
  return page.locator('[data-testid="agent-card"], .agent-item').count()
}

/**
 * Wait until a specific number of agents are visible
 *
 * @param page - Playwright Page object
 * @param count - Expected number of agents
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 */
export async function waitForAgentCount(
  page: Page,
  count: number,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const cards = document.querySelectorAll('[data-testid="agent-card"], .agent-item')
      return cards.length >= expected
    },
    count,
    { timeout }
  )
}

/**
 * Wait for the dashboard to be visible
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 */
export async function waitForDashboard(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="dashboard"], .dashboard', { timeout })
}

/**
 * Wait for the sidebar to be visible
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 */
export async function waitForSidebar(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="sidebar"], .sidebar', { timeout })
}

/**
 * Wait for the settings page to be visible
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 */
export async function waitForSettingsPage(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="settings-page"], .settings-page', { timeout })
}

/**
 * Wait for the agent view to be visible
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 */
export async function waitForAgentView(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="agent-view"], .agent-view', { timeout })
}

/**
 * Click the settings link in the sidebar
 *
 * @param page - Playwright Page object
 */
export async function clickSettingsLink(page: Page): Promise<void> {
  const settingsLink = page.locator('[data-testid="settings-link"], .settings-nav-item')
  await settingsLink.click()
}

/**
 * Click the create agent button to open the new mission dropdown
 *
 * @param page - Playwright Page object
 */
export async function clickCreateAgentButton(page: Page): Promise<void> {
  const createBtn = page.locator('[data-testid="create-agent-btn"], .mission-dropdown-btn')
  await createBtn.click()
}

/**
 * Get a locator for an agent card by agent ID
 *
 * @param page - Playwright Page object
 * @param agentId - The agent's ID
 * @returns Locator for the agent card
 */
export function getAgentCard(page: Page, agentId: string): Locator {
  return page.locator(`[data-testid="agent-card"]:has-text("${agentId}")`)
}

/**
 * Check if an element with the given test ID exists
 *
 * @param page - Playwright Page object
 * @param testId - The data-testid value to look for
 * @returns True if the element exists
 */
export async function hasTestId(page: Page, testId: string): Promise<boolean> {
  const count = await page.locator(`[data-testid="${testId}"]`).count()
  return count > 0
}

/**
 * Get all text content from agent cards
 *
 * @param page - Playwright Page object
 * @returns Array of text content from each agent card
 */
export async function getAgentCardTexts(page: Page): Promise<string[]> {
  const cards = page.locator('[data-testid="agent-card"], .agent-item, .assignment-card')
  const count = await cards.count()
  const texts: string[] = []
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).textContent()
    texts.push(text || '')
  }
  return texts
}

/**
 * Check if the dashboard is showing any loading state
 *
 * @param page - Playwright Page object
 * @returns True if loading indicators are present
 */
export async function isDashboardLoading(page: Page): Promise<boolean> {
  const loadingIndicators = await page.locator('.loading, .spinner, [data-loading="true"]').count()
  return loadingIndicators > 0
}

/**
 * Wait for all loading indicators to disappear
 *
 * @param page - Playwright Page object
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 */
export async function waitForLoadingComplete(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => {
      const loading = document.querySelectorAll('.loading, .spinner, [data-loading="true"]')
      return loading.length === 0
    },
    { timeout }
  )
}

/**
 * Assert that a specific test ID element is visible
 *
 * @param page - Playwright Page object
 * @param testId - The data-testid value to check
 */
export async function expectTestIdVisible(page: Page, testId: string): Promise<void> {
  await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible()
}

/**
 * Assert that a specific test ID element is not visible
 *
 * @param page - Playwright Page object
 * @param testId - The data-testid value to check
 */
export async function expectTestIdNotVisible(page: Page, testId: string): Promise<void> {
  await expect(page.locator(`[data-testid="${testId}"]`)).not.toBeVisible()
}

/**
 * Get the current URL/route of the page
 */
export function getCurrentRoute(page: Page): string {
  return page.url()
}

/**
 * Check if the app has navigated to the workspace
 */
export function isOnWorkspace(page: Page): boolean {
  return page.url().includes('/workspace')
}

/**
 * Check if the app has navigated to settings
 */
export function isOnSettings(page: Page): boolean {
  return page.url().includes('/settings')
}

/**
 * Take a screenshot with a descriptive name for debugging
 *
 * @param page - Playwright Page object
 * @param name - Name for the screenshot file
 * @returns Path to the saved screenshot
 */
export async function takeDebugScreenshot(page: Page, name: string): Promise<string> {
  const path = `e2e-results/debug-${name}-${Date.now()}.png`
  await page.screenshot({ path, fullPage: true })
  return path
}
