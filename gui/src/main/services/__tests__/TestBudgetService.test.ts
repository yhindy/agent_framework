import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TestBudgetService } from '../TestBudgetService'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'

// Generate unique config path for each test run to avoid cross-test pollution
let testConfigDir: string

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: true,  // Use isPackaged=true so it uses getPath instead of __dirname
    getPath: () => testConfigDir
  },
  BrowserWindow: vi.fn()
}))

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(() => ({
    stdout: {
      on: vi.fn()
    },
    stderr: {
      on: vi.fn()
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        // Simulate successful spawn
        setTimeout(() => callback(0), 10)
      }
    }),
    unref: vi.fn()
  }))
}))

describe('TestBudgetService', () => {
  let service: TestBudgetService
  let testDir: string

  beforeEach(() => {
    vi.clearAllMocks()

    // Create unique temporary directories for each test to avoid cross-test pollution
    testDir = join(tmpdir(), `test-budget-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigDir = join(tmpdir(), `test-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(testConfigDir, { recursive: true })

    // Create mock BrowserWindow
    const mockWindow = {
      webContents: {
        send: vi.fn()
      }
    } as any

    service = new TestBudgetService(mockWindow)
  })

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
      rmSync(testConfigDir, { recursive: true, force: true })
    } catch (e) {
      // Ignore cleanup errors
    }
  })

  describe('Configuration', () => {
    it('should return default configuration', () => {
      const config = service.getConfig()

      expect(config).toEqual({
        maxConcurrentLocalTests: 1,
        enableCloudOverflow: true
      })
    })

    it('should update configuration', () => {
      service.setConfig({ maxConcurrentLocalTests: 3 })

      const config = service.getConfig()
      expect(config.maxConcurrentLocalTests).toBe(3)
      expect(config.enableCloudOverflow).toBe(true)
    })

    it('should update multiple config values', () => {
      service.setConfig({
        maxConcurrentLocalTests: 5,
        enableCloudOverflow: false
      })

      const config = service.getConfig()
      expect(config.maxConcurrentLocalTests).toBe(5)
      expect(config.enableCloudOverflow).toBe(false)
    })
  })

  describe('Budget Status', () => {
    it('should return correct initial status', () => {
      const status = service.getBudgetStatus()

      expect(status.maxLocal).toBe(1)
      expect(status.activeLocal).toBe(0)
      expect(status.activeCloud).toBe(0)
      expect(status.availableLocal).toBe(1)
      expect(status.isLocalBudgetExhausted).toBe(false)
    })

    it('should track active local tests', async () => {
      const result = await service.requestTestRun(
        'agent-1',
        testDir,
        testDir,
        'npm test'
      )

      expect(result.isCloud).toBe(false)

      const status = service.getBudgetStatus()
      expect(status.activeLocal).toBe(1)
      expect(status.availableLocal).toBe(0)
      expect(status.isLocalBudgetExhausted).toBe(true)
    })

    it('should update status when local test completes', async () => {
      const result = await service.requestTestRun(
        'agent-1',
        testDir,
        testDir,
        'npm test'
      )

      service.completeLocalTest(result.testRunId)

      const status = service.getBudgetStatus()
      expect(status.activeLocal).toBe(0)
      expect(status.isLocalBudgetExhausted).toBe(false)
    })
  })

  describe('Local Test Execution', () => {
    it('should run test locally when budget available', async () => {
      const result = await service.requestTestRun(
        'agent-1',
        testDir,
        testDir,
        'npm test'
      )

      expect(result.isCloud).toBe(false)
      expect(result.testRunId).toMatch(/^test-agent-1-/)
    })

    it('should respect maxConcurrentLocalTests setting', async () => {
      service.setConfig({ maxConcurrentLocalTests: 2 })

      // First test
      const result1 = await service.requestTestRun('agent-1', testDir, testDir, 'npm test')
      expect(result1.isCloud).toBe(false)

      // Second test
      const result2 = await service.requestTestRun('agent-2', testDir, testDir, 'npm test')
      expect(result2.isCloud).toBe(false)

      const status = service.getBudgetStatus()
      expect(status.activeLocal).toBe(2)
      expect(status.isLocalBudgetExhausted).toBe(true)
    })
  })

  describe('Cloud Overflow', () => {
    it('should spawn cloud agent when local budget exhausted', async () => {
      // Fill local budget
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      // Wait for the spawn mock to be set up
      await new Promise(resolve => setTimeout(resolve, 50))

      // Next test should go to cloud
      const result = await service.requestTestRun('agent-2', testDir, testDir, 'npm test')

      expect(result.isCloud).toBe(true)
    })

    it('should throw error when cloud overflow disabled and budget exhausted', async () => {
      service.setConfig({ enableCloudOverflow: false })

      // Fill local budget
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      // Next test should fail
      await expect(
        service.requestTestRun('agent-2', testDir, testDir, 'npm test')
      ).rejects.toThrow(/Local test budget exhausted/)
    })

    it('should track cloud tests separately from local tests', async () => {
      // Fill local budget
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      await new Promise(resolve => setTimeout(resolve, 50))

      // Cloud test
      await service.requestTestRun('agent-2', testDir, testDir, 'npm test')

      const status = service.getBudgetStatus()
      expect(status.activeLocal).toBe(1)
      expect(status.activeCloud).toBe(1)
    })
  })

  describe('Test Completion', () => {
    it('should complete local test and free budget', async () => {
      const result = await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      expect(service.canRunLocally()).toBe(false)

      service.completeLocalTest(result.testRunId)

      expect(service.canRunLocally()).toBe(true)
    })

    it('should store cloud test result', async () => {
      // Fill local budget
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      await new Promise(resolve => setTimeout(resolve, 50))

      // Cloud test
      const cloudResult = await service.requestTestRun('agent-2', testDir, testDir, 'npm test')

      // Manually complete cloud test (simulating result file creation)
      service.completeCloudTest(cloudResult.testRunId, 0, 'Tests passed', '')

      const result = service.getCloudResult(cloudResult.testRunId)
      expect(result).not.toBeNull()
      expect(result!.exitCode).toBe(0)
      expect(result!.stdout).toBe('Tests passed')
    })

    it('should notify on cloud test completion', async () => {
      const completionCallback = vi.fn()
      service.onTestComplete(completionCallback)

      // Fill local budget
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      await new Promise(resolve => setTimeout(resolve, 50))

      // Cloud test
      const cloudResult = await service.requestTestRun('agent-2', testDir, testDir, 'npm test')

      // Complete it
      service.completeCloudTest(cloudResult.testRunId, 0, 'Tests passed', '')

      expect(completionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId: cloudResult.testRunId,
          exitCode: 0
        })
      )
    })
  })

  describe('Active Tests', () => {
    it('should list all active tests', async () => {
      service.setConfig({ maxConcurrentLocalTests: 2 })

      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')
      await service.requestTestRun('agent-2', testDir, testDir, 'npm test')

      const active = service.getActiveTests()
      expect(active.local).toHaveLength(2)
      expect(active.cloud).toHaveLength(0)
    })

    it('should separate local and cloud tests', async () => {
      // One local
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      await new Promise(resolve => setTimeout(resolve, 50))

      // One cloud
      await service.requestTestRun('agent-2', testDir, testDir, 'npm test')

      const active = service.getActiveTests()
      expect(active.local).toHaveLength(1)
      expect(active.cloud).toHaveLength(1)
      expect(active.local[0].agentId).toBe('agent-1')
      expect(active.cloud[0].agentId).toBe('agent-2')
    })
  })

  describe('Event Callbacks', () => {
    it('should notify on budget change', async () => {
      const budgetCallback = vi.fn()
      service.onBudgetChange(budgetCallback)

      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      expect(budgetCallback).toHaveBeenCalledWith(1, 0)
    })

    it('should allow unsubscribing from callbacks', async () => {
      const budgetCallback = vi.fn()
      const unsubscribe = service.onBudgetChange(budgetCallback)

      unsubscribe()

      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      expect(budgetCallback).not.toHaveBeenCalled()
    })
  })

  describe('Cleanup', () => {
    it('should clear all state on cleanup', async () => {
      await service.requestTestRun('agent-1', testDir, testDir, 'npm test')

      service.cleanup()

      const status = service.getBudgetStatus()
      expect(status.activeLocal).toBe(0)
      expect(status.activeCloud).toBe(0)

      const active = service.getActiveTests()
      expect(active.local).toHaveLength(0)
      expect(active.cloud).toHaveLength(0)
    })
  })
})
