/**
 * Global Teardown for E2E Tests - runs once after all tests complete
 */

import * as fs from 'fs/promises'
import * as path from 'path'

interface TestResults {
  stats?: {
    expected?: number
    unexpected?: number
    skipped?: number
    duration?: number
  }
  suites?: Array<{
    title: string
    specs?: Array<{
      title: string
      tests?: Array<{
        status: string
        results?: Array<{ error?: { message?: string } }>
      }>
    }>
  }>
}

async function globalTeardown(): Promise<void> {
  console.log('\n=== E2E Test Suite Complete ===\n')

  const resultsPath = path.join(__dirname, '..', 'e2e-results.json')

  try {
    const resultsData = await fs.readFile(resultsPath, 'utf-8')
    const results: TestResults = JSON.parse(resultsData)
    const stats = results.stats ?? {}

    const passed = (stats.expected ?? 0) - (stats.unexpected ?? 0) - (stats.skipped ?? 0)
    console.log('Test Results Summary:')
    console.log(`  Total: ${stats.expected ?? 0}`)
    console.log(`  Passed: ${passed}`)
    console.log(`  Failed: ${stats.unexpected ?? 0}`)
    console.log(`  Skipped: ${stats.skipped ?? 0}`)
    console.log(`  Duration: ${Math.round((stats.duration ?? 0) / 1000)}s`)

    if ((stats.unexpected ?? 0) > 0) {
      console.log('\nFailed tests:')
      for (const suite of results.suites ?? []) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            if (test.status === 'unexpected') {
              console.log(`  - ${suite.title} > ${spec.title}`)
              const errorMsg = test.results?.[0]?.error?.message
              if (errorMsg) {
                console.log(`    Error: ${errorMsg}`)
              }
            }
          }
        }
      }
    }
  } catch {
    console.log('No test results file found.')
  }

  console.log('\nE2E test artifacts saved to: gui/e2e-results/')
  console.log('HTML report available at: gui/e2e-report/index.html\n')
}

export default globalTeardown
