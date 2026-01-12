/**
 * Global Setup for E2E Tests - runs once before all tests
 */

import { buildApp } from './electron-app'

async function globalSetup(): Promise<void> {
  console.log('\n=== E2E Test Suite Starting ===\n')
  console.log('Building Electron app...')

  const buildSuccess = await buildApp()
  if (!buildSuccess) {
    throw new Error('Failed to build Electron app. Cannot run E2E tests.')
  }

  console.log('Build complete. Starting E2E tests...\n')
}

export default globalSetup
