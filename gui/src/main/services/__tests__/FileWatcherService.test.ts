import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileWatcherService } from '../FileWatcherService'
import { BrowserWindow } from 'electron'
import chokidar from 'chokidar'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}))

vi.mock('chokidar', () => {
  const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined)
  }
  return {
    default: {
      watch: vi.fn().mockReturnValue(mockWatcher)
    }
  }
})

describe('FileWatcherService', () => {
  let service: FileWatcherService
  let mockMainWindow: any
  let mockWebContents: any
  let mockWatcher: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockWebContents = {
      send: vi.fn()
    }
    mockMainWindow = {
      webContents: mockWebContents
    } as unknown as BrowserWindow

    service = new FileWatcherService(mockMainWindow)

    mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as unknown as chokidar.FSWatcher)
  })

  afterEach(() => {
    service.stopWatching()
  })

  describe('watchProject', () => {
    it('watches assignments.json at correct path', () => {
      service.watchProject('/home/user/my-project')

      const watchedPaths = vi.mocked(chokidar.watch).mock.calls[0][0] as string[]
      expect(watchedPaths[0]).toBe('/home/user/my-project/docs/agents/assignments.json')
    })

    it('watches agent worktrees using project name from path', () => {
      service.watchProject('/home/user/my-project')

      const watchedPaths = vi.mocked(chokidar.watch).mock.calls[0][0] as string[]
      expect(watchedPaths[1]).toBe('/home/user/my-project-agent-*/.agent-info')
    })

    it('configures watcher with debounce to avoid partial file reads', () => {
      service.watchProject('/test/project')

      const options = vi.mocked(chokidar.watch).mock.calls[0][1]
      expect(options).toMatchObject({
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      })
    })

    it('closes previous watcher when switching projects', () => {
      const firstWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }
      const secondWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }

      vi.mocked(chokidar.watch)
        .mockReturnValueOnce(firstWatcher as unknown as chokidar.FSWatcher)
        .mockReturnValueOnce(secondWatcher as unknown as chokidar.FSWatcher)

      service.watchProject('/project-1')
      service.watchProject('/project-2')

      expect(firstWatcher.close).toHaveBeenCalled()
    })
  })

  describe('file change notifications', () => {
    function getHandler(eventName: string) {
      return mockWatcher.on.mock.calls.find((call: any[]) => call[0] === eventName)?.[1]
    }

    it('sends assignments:updated when assignments.json changes', () => {
      service.watchProject('/test/project')
      getHandler('change')('/any/path/assignments.json')

      expect(mockWebContents.send).toHaveBeenCalledWith('assignments:updated')
    })

    it('sends agents:updated when .agent-info file changes', () => {
      service.watchProject('/test/project')
      getHandler('change')('/test/project-agent-1/.agent-info')

      expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
    })

    it('sends agents:updated when new agent worktree is created', () => {
      service.watchProject('/test/project')
      getHandler('add')('/test/project-agent-2/.agent-info')

      expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
    })

    it('sends agents:updated when agent worktree is deleted', () => {
      service.watchProject('/test/project')
      getHandler('unlink')('/test/project-agent-3/.agent-info')

      expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
    })

    it('ignores changes to unrelated files', () => {
      service.watchProject('/test/project')

      getHandler('change')('/test/project/package.json')
      getHandler('add')('/test/project/new-file.ts')
      getHandler('unlink')('/test/project/deleted.ts')

      expect(mockWebContents.send).not.toHaveBeenCalled()
    })
  })

  describe('stopWatching', () => {
    it('closes watcher and allows restart', () => {
      service.watchProject('/test/project')
      service.stopWatching()

      expect(mockWatcher.close).toHaveBeenCalled()

      // Can start watching again
      service.watchProject('/other/project')
      expect(chokidar.watch).toHaveBeenCalledTimes(2)
    })

    it('is safe to call when not watching', () => {
      expect(() => service.stopWatching()).not.toThrow()
    })

    it('is idempotent', () => {
      service.watchProject('/test/project')
      service.stopWatching()
      service.stopWatching()

      expect(mockWatcher.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('setWindow', () => {
    it('uses new window for subsequent IPC messages', () => {
      const newWebContents = { send: vi.fn() }
      const newWindow = { webContents: newWebContents } as unknown as BrowserWindow

      service.watchProject('/test/project')
      service.setWindow(newWindow)

      const changeHandler = mockWatcher.on.mock.calls.find(
        (call: any[]) => call[0] === 'change'
      )?.[1]
      changeHandler('/test/project/docs/agents/assignments.json')

      expect(newWebContents.send).toHaveBeenCalledWith('assignments:updated')
      expect(mockWebContents.send).not.toHaveBeenCalled()
    })
  })
})
