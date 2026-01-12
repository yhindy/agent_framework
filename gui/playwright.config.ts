import { defineConfig } from '@playwright/test'
import path from 'path'

/**
 * Playwright configuration for Electron E2E testing.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  retries: process.env.CI ? 2 : 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,

  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e-results.json' }],
    ['html', { outputFolder: 'e2e-report', open: 'never' }],
  ],

  globalSetup: path.join(__dirname, 'e2e/global-setup.ts'),
  globalTeardown: path.join(__dirname, 'e2e/global-teardown.ts'),

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  outputDir: 'e2e-results/',

  projects: [{ name: 'electron' }],
})
