/**
 * Electron Application Test Utilities
 *
 * Provides utilities for launching and interacting with the Electron app in E2E tests.
 */

import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import { spawn } from 'child_process'

export interface ElectronAppContext {
  app: ElectronApplication
  mainWindow: Page
  evaluateInMain: <T>(fn: () => T | Promise<T>) => Promise<T>
  getMainProcessLogs: () => string[]
  close: () => Promise<void>
}

const mainProcessLogs: string[] = []

const BUILD_TIMEOUT = 120000

/**
 * Build the Electron app before testing. Returns true on success.
 */
export function buildApp(): Promise<boolean> {
  return new Promise((resolve) => {
    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: path.join(__dirname, '..'),
      shell: true,
      stdio: 'pipe',
    })

    let output = ''
    const collectOutput = (data: Buffer): void => {
      output += data.toString()
    }
    buildProcess.stdout?.on('data', collectOutput)
    buildProcess.stderr?.on('data', collectOutput)

    const timeout = setTimeout(() => {
      buildProcess.kill()
      console.error('Build timed out')
      resolve(false)
    }, BUILD_TIMEOUT)

    buildProcess.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        console.error('Build failed:', output)
        resolve(false)
      } else {
        resolve(true)
      }
    })
  })
}

export interface LaunchOptions {
  env?: Record<string, string>
  testProjectPath?: string
}

/**
 * Launch the Electron application for testing.
 */
export async function launchElectronApp(options: LaunchOptions = {}): Promise<ElectronAppContext> {
  const { env = {}, testProjectPath } = options

  mainProcessLogs.length = 0

  const mainPath = path.join(__dirname, '..', 'out', 'main', 'index.js')

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      E2E_TEST: 'true',
      ...(testProjectPath && { E2E_TEST_PROJECT: testProjectPath }),
      ...env,
    },
  })

  app.on('console', (msg) => {
    mainProcessLogs.push(`[${msg.type()}] ${msg.text()}`)
  })

  const mainWindow = await app.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')

  return {
    app,
    mainWindow,
    evaluateInMain: <T>(fn: () => T | Promise<T>): Promise<T> => app.evaluate(fn),
    getMainProcessLogs: () => [...mainProcessLogs],
    close: () => app.close(),
  }
}

/**
 * Wait for the Electron app to be fully initialized.
 */
export async function waitForAppReady(context: ElectronAppContext): Promise<void> {
  const { mainWindow } = context

  await mainWindow.waitForSelector('[data-testid="app-root"], #root', {
    state: 'attached',
    timeout: 30000,
  })

  await mainWindow.waitForFunction(
    () => typeof (window as unknown as { electronAPI?: unknown }).electronAPI !== 'undefined',
    { timeout: 10000 }
  )
}

/**
 * Create a temporary test project directory with minions installed.
 */
export async function createTestProject(name = 'test-project'): Promise<string> {
  const { mkdtemp, mkdir, writeFile } = await import('fs/promises')
  const os = await import('os')
  const { execSync } = await import('child_process')

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), `e2e-${name}-`))

  execSync('git init', { cwd: tmpDir })
  execSync('git config user.email "test@test.com"', { cwd: tmpDir })
  execSync('git config user.name "Test User"', { cwd: tmpDir })

  await writeFile(path.join(tmpDir, 'README.md'), '# Test Project\n')
  execSync('git add -A && git commit -m "Initial commit"', { cwd: tmpDir })

  const minionsDir = path.join(tmpDir, '.minions')
  await mkdir(path.join(minionsDir, 'assignments'), { recursive: true })
  await mkdir(path.join(minionsDir, 'active'), { recursive: true })

  return tmpDir
}

/**
 * Clean up a test project directory.
 */
export async function cleanupTestProject(projectPath: string): Promise<void> {
  const { rm } = await import('fs/promises')
  await rm(projectPath, { recursive: true, force: true })
}

/**
 * Capture a screenshot with a descriptive name.
 */
export async function captureScreenshot(page: Page, name: string): Promise<string> {
  const screenshotPath = path.join(__dirname, '..', 'e2e-results', `${name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  return screenshotPath
}
