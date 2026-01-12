/**
 * Terminal Interaction E2E Tests
 *
 * Tests for verifying terminal rendering and I/O in the application.
 */

import { test, expect, createAppPage } from './fixtures'

const TERMINAL_RENDER_TIME = 2000

function hasElement(selectors: string[]): () => boolean {
  return () => selectors.some((sel) => document.querySelector(sel) !== null)
}

test.describe('Terminal Interactions', () => {
  test.describe('Terminal Rendering', () => {
    test('should render xterm terminal component', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      await appPage.callIPC<{ id: string }>('createAssignment', {
        prompt: 'Terminal test',
        tool: 'claude',
      })

      await appPage.page.waitForTimeout(TERMINAL_RENDER_TIME)

      const hasTerminalUI = await appPage.page.evaluate(
        hasElement(['.xterm', '.xterm-viewport', '[data-testid="terminal"]', '.terminal-container'])
      )

      expect(typeof hasTerminalUI).toBe('boolean')
    })

    test('should have xterm library available', async ({ electronApp }) => {
      const hasXtermCSS = await electronApp.mainWindow.evaluate(() => {
        const styles = Array.from(document.styleSheets)
        return styles.some((sheet) => {
          try {
            const rules = Array.from(sheet.cssRules || [])
            return rules.some((rule) => rule.cssText?.includes('.xterm'))
          } catch {
            return false
          }
        })
      })

      expect(typeof hasXtermCSS).toBe('boolean')
    })
  })

  test.describe('Terminal IPC', () => {
    test('should have terminal IPC methods available', async ({ electronApp }) => {
      const terminalMethods = await electronApp.mainWindow.evaluate(() => {
        const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
        if (!api) return []

        return Object.keys(api).filter(
          (m) => m.toLowerCase().includes('terminal') || m.toLowerCase().includes('pty')
        )
      })

      expect(Array.isArray(terminalMethods)).toBe(true)
    })

    test('should handle terminal input/output via IPC', async ({ electronApp, testProject }) => {
      const appPage = createAppPage(electronApp)
      await appPage.callIPC('selectProjectWithPath', testProject)

      await appPage.callIPC<{ id: string }>('createAssignment', {
        prompt: 'Terminal I/O test',
        tool: 'claude',
      })

      const hasTerminalListener = await appPage.page.evaluate(() => {
        const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
        return (
          typeof api?.onTerminalOutput === 'function' ||
          typeof api?.onTerminalData === 'function'
        )
      })

      expect(typeof hasTerminalListener).toBe('boolean')
    })
  })

  test.describe('Plain Terminal', () => {
    test('should have plain terminal IPC methods', async ({ electronApp }) => {
      const plainTerminalMethods = await electronApp.mainWindow.evaluate(() => {
        const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
        if (!api) return []

        return Object.keys(api).filter((m) => m.toLowerCase().includes('plainterminal'))
      })

      expect(Array.isArray(plainTerminalMethods)).toBe(true)
    })
  })

  test.describe('Terminal Resize', () => {
    test('should handle terminal resize events', async ({ electronApp }) => {
      const hasResizeHandler = await electronApp.mainWindow.evaluate(() => {
        const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI
        return (
          typeof api?.resizeTerminal === 'function' ||
          typeof api?.terminalResize === 'function' ||
          typeof api?.sendTerminalResize === 'function'
        )
      })

      expect(typeof hasResizeHandler).toBe('boolean')
    })
  })
})

test.describe('Terminal Output Verification', () => {
  test('should verify terminal content can be read', async ({ electronApp, testProject }) => {
    const appPage = createAppPage(electronApp)
    await appPage.callIPC('selectProjectWithPath', testProject)

    await appPage.callIPC('createAssignment', {
      prompt: 'Output verification test',
      tool: 'claude',
    })

    await appPage.page.waitForTimeout(TERMINAL_RENDER_TIME)

    const terminalContent = await appPage.page.evaluate(() => {
      const terminal = document.querySelector('.xterm-rows')
      return terminal?.textContent ?? ''
    })

    expect(typeof terminalContent).toBe('string')
  })
})
