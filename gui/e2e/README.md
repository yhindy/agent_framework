# E2E Testing Guide

This directory contains end-to-end tests for the Electron application using Playwright.

## Quick Start

```bash
# Run all E2E tests
npm run test:e2e

# Run with visible browser (debugging)
npm run test:e2e:headed

# Run specific test suites
npm run test:e2e:smoke    # Quick smoke tests
npm run test:e2e:flow     # User flow tests
npm run test:e2e:settings # Settings page tests
npm run test:e2e:errors   # Error handling tests
```

## Directory Structure

```
gui/e2e/
├── README.md                 # This file
├── fixtures.ts               # Test fixtures and AppPage class
├── electron-app.ts           # Electron app launch utilities
├── global-setup.ts           # Build app before tests
├── global-teardown.ts        # Cleanup after tests
├── helpers/                  # Consolidated test helpers
│   ├── index.ts              # Re-exports all helpers
│   ├── ipc-helpers.ts        # Typed IPC wrappers
│   └── ui-helpers.ts         # UI interaction utilities
├── app-lifecycle.e2e.ts      # App launch/shutdown tests
├── user-flows.e2e.ts         # Core user workflow tests
├── ipc-communication.e2e.ts  # IPC round-trip tests
├── terminal.e2e.ts           # Terminal rendering tests
├── settings.e2e.ts           # Settings page tests
└── error-scenarios.e2e.ts    # Error handling tests
```

## Writing New Tests

### Basic Test Structure

```typescript
import { test, expect, createAppPage } from './fixtures'
import { createIPCHelpers, waitForDashboard } from './helpers'

test.describe('Feature Name', () => {
  test('should do something', async ({ electronApp, testProject }) => {
    // Create helper instances
    const appPage = createAppPage(electronApp)
    const ipc = createIPCHelpers(appPage)

    // Setup: Select project
    await ipc.selectProject(testProject)

    // Action: Perform test action
    const result = await ipc.someIPCCall()

    // Assert: Verify results
    expect(result).toBeDefined()
  })
})
```

### Using IPC Helpers

The `createIPCHelpers` function provides typed wrappers for all IPC calls:

```typescript
const ipc = createIPCHelpers(appPage)

// Project operations
await ipc.selectProject('/path/to/project')
const projects = await ipc.getRecentProjects()

// Agent operations
const agents = await ipc.listAgents()
const assignment = await ipc.createAssignment({
  prompt: 'Implement feature X',
  tool: 'claude',
})
await ipc.stopAgent(agentId)
await ipc.teardownAgent(agentId, force)

// Settings operations
const settings = await ipc.getSettings()
await ipc.updateSettings({ notifications: { enabled: false, cooldownSeconds: 30 } })

// Dependency checks
const deps = await ipc.checkDependencies()
```

### Using UI Helpers

The UI helpers provide common UI interaction patterns:

```typescript
import {
  waitForAppReady,
  waitForDashboard,
  waitForSidebar,
  waitForSettingsPage,
  clickSettingsLink,
  getVisibleAgentCount,
  hasTestId,
} from './helpers'

// Wait for app to be ready
await waitForAppReady(page)

// Wait for specific pages
await waitForDashboard(page)
await waitForSidebar(page)
await waitForSettingsPage(page)

// Navigate
await clickSettingsLink(page)

// Check elements
const count = await getVisibleAgentCount(page)
const exists = await hasTestId(page, 'dashboard')
```

### Available Test IDs

The following `data-testid` attributes are available for testing:

| Test ID | Component | Description |
|---------|-----------|-------------|
| `dashboard` | Dashboard.tsx | Main dashboard container |
| `dashboard-header` | Dashboard.tsx | Dashboard header section |
| `agent-card` | Dashboard.tsx | Individual agent cards |
| `create-agent-btn` | MissionDropdown.tsx | New Mission button |
| `create-agent-btn-icon` | MissionDropdown.tsx | New Mission icon (sidebar) |
| `mission-dropdown-menu` | MissionDropdown.tsx | Dropdown menu |
| `add-project-btn` | MissionDropdown.tsx | Add Project menu item |
| `new-minion-btn` | MissionDropdown.tsx | New Minion menu item |
| `teleport-btn` | MissionDropdown.tsx | Teleport menu item |
| `sidebar` | Sidebar.tsx | Main sidebar container |
| `project-list` | Sidebar.tsx | Project list section |
| `agent-list` | Sidebar.tsx | Agent list in sidebar |
| `settings-link` | Sidebar.tsx | Settings navigation link |
| `settings-page` | SettingsPage.tsx | Settings page container |
| `tool-select` | SettingsPage.tsx | Tool selection dropdown |
| `model-select` | SettingsPage.tsx | Model selection dropdown |
| `agent-view` | AgentView.tsx | Agent view container |
| `terminal-container` | AgentView.tsx | Terminal container |

## Test Fixtures

### `electronApp`

Provides access to the launched Electron application:

```typescript
test('example', async ({ electronApp }) => {
  const mainWindow = electronApp.mainWindow
  // Interact with the window
})
```

### `testProject`

Creates a temporary test project with basic git setup:

```typescript
test('example', async ({ testProject }) => {
  // testProject is a path to a temporary directory
  // with git initialized and minions config
})
```

**Note:** For testing non-git project behavior, create a temporary directory without git initialization and use it as the project path.

## Common Patterns

### Testing IPC with Error Handling

```typescript
test('should handle error gracefully', async ({ electronApp, testProject }) => {
  const appPage = createAppPage(electronApp)
  const ipc = createIPCHelpers(appPage)

  try {
    await ipc.someCallThatMightFail()
    // Verify success state
  } catch (error) {
    // Expected error - verify app is still usable
    const isReady = await appPage.isAPIReady()
    expect(isReady).toBe(true)
  }
})
```

### Waiting for UI Updates

```typescript
const UI_SETTLE_TIME = 1000

test('should update UI', async ({ electronApp, testProject }) => {
  const appPage = createAppPage(electronApp)
  const ipc = createIPCHelpers(appPage)

  await ipc.selectProject(testProject)

  // Wait for React to re-render
  await appPage.page.waitForTimeout(UI_SETTLE_TIME)

  // Now check UI state
  await waitForDashboard(appPage.page)
})
```

### Testing Settings Persistence

```typescript
test('should persist settings', async ({ electronApp, testProject }) => {
  const appPage = createAppPage(electronApp)
  const ipc = createIPCHelpers(appPage)

  await ipc.selectProject(testProject)

  // Get original
  const original = await ipc.getSettings()

  // Update
  await ipc.updateSettings({
    notifications: { ...original.notifications, cooldownSeconds: 45 },
  })

  // Verify persistence
  const updated = await ipc.getSettings()
  expect(updated.notifications.cooldownSeconds).toBe(45)
})
```

## Running Tests

### All Tests

```bash
npm run test:e2e
```

### With Visible Browser

```bash
npm run test:e2e:headed
```

### Debug Mode

```bash
npm run test:e2e:debug
```

### Specific Test File

```bash
cd gui && npx playwright test settings.e2e.ts
```

### Specific Test by Name

```bash
cd gui && npx playwright test --grep "should navigate to settings"
```

### View Test Report

```bash
npm run test:e2e:report
```

## Test Results

After running tests, results are available in:

- `gui/e2e-results.json` - JSON results (parseable by AI agents)
- `gui/e2e-report/` - HTML report
- `gui/e2e-results/` - Screenshots and traces on failure

## CI/CD

E2E tests run automatically in CI when GUI source files change. The CI workflow:

1. Builds the Electron app
2. Runs selective E2E tests based on changed files
3. Uploads test artifacts on failure

## Troubleshooting

### Tests Hang or Timeout

- Ensure the app is built: `npm run build -w gui`
- Check for zombie Electron processes
- Increase timeout in `playwright.config.ts`

### Cannot Find electronAPI

- The app may not have fully loaded
- Call `waitForAppReady()` or `waitForElectronAPI()`

### Flaky Tests

- Add explicit waits: `await page.waitForTimeout(1000)`
- Use `waitForSelector` instead of immediate checks
- Check for race conditions in async operations

### Screenshots Not Captured

- Screenshots are only captured on failure
- Check `gui/e2e-results/` directory

## Best Practices

1. **Use typed IPC helpers** - They provide better autocomplete and type safety
2. **Add data-testid attributes** - More stable than CSS selectors
3. **Wait explicitly** - Use appropriate wait functions instead of arbitrary timeouts
4. **Clean up resources** - The fixture handles cleanup, but be mindful in custom setup
5. **Test isolation** - Each test should be independent
6. **Meaningful assertions** - Assert specific values, not just existence
7. **Error scenarios** - Test both happy path and error cases
