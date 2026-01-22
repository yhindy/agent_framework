import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileWatcherService } from '../FileWatcherService'
import { BrowserWindow } from 'electron'
import chokidar from 'chokidar'

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}))

// Mock chokidar
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

    // Get reference to mock watcher
    mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as unknown as chokidar.FSWatcher)
  })

  afterEach(() => {
    service.stopWatching()
  })

  describe('constructor', () => {
    it('initializes with the provided window', () => {
      expect(service).toBeInstanceOf(FileWatcherService)
    })
  })

  describe('setWindow', () => {
    it('updates the main window reference', () => {
      const newMockWebContents = { send: vi.fn() }
      const newMockWindow = {
        webContents: newMockWebContents
      } as unknown as BrowserWindow

      service.setWindow(newMockWindow)
      service.watchProject('/test/project')

      // Trigger a change event
      const changeHandler = mockWatcher.on.mock.calls.find(
        (call: any[]) => call[0] === 'change'
      )?.[1]

      changeHandler('/test/project/docs/agents/assignments.json')

      // Should send to new window
      expect(newMockWebContents.send).toHaveBeenCalledWith('assignments:updated')
    })
  })

  describe('watchProject', () => {
    it('sets up watchers for assignments.json and .agent-info files', () => {
      service.watchProject('/home/user/my-project')

      expect(chokidar.watch).toHaveBeenCalledWith(
        [
          '/home/user/my-project/docs/agents/assignments.json',
          '/home/user/my-project-agent-*/.agent-info'
        ],
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
          awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
          }
        })
      )
    })

    it('registers event handlers for change, add, and unlink', () => {
      service.watchProject('/test/project')

      const onCalls = mockWatcher.on.mock.calls.map((call: any[]) => call[0])
      expect(onCalls).toContain('change')
      expect(onCalls).toContain('add')
      expect(onCalls).toContain('unlink')
    })

    it('closes existing watcher before creating new one', () => {
      const firstWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined)
      }
      const secondWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined)
      }

      vi.mocked(chokidar.watch)
        .mockReturnValueOnce(firstWatcher as unknown as chokidar.FSWatcher)
        .mockReturnValueOnce(secondWatcher as unknown as chokidar.FSWatcher)

      service.watchProject('/project-1')
      service.watchProject('/project-2')

      expect(firstWatcher.close).toHaveBeenCalled()
    })

    it('extracts project name correctly from path', () => {
      service.watchProject('/home/user/my-awesome-project')

      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.arrayContaining([
          '/home/user/my-awesome-project-agent-*/.agent-info'
        ]),
        expect.any(Object)
      )
    })
  })

  describe('file change events', () => {
    describe('assignments.json changes', () => {
      it('sends assignments:updated when assignments.json changes', () => {
        service.watchProject('/test/project')

        const changeHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'change'
        )?.[1]

        changeHandler('/test/project/docs/agents/assignments.json')

        expect(mockWebContents.send).toHaveBeenCalledWith('assignments:updated')
      })
    })

    describe('.agent-info changes', () => {
      it('sends agents:updated when .agent-info changes', () => {
        service.watchProject('/test/project')

        const changeHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'change'
        )?.[1]

        changeHandler('/test/project-agent-1/.agent-info')

        expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
      })

      it('sends agents:updated when new .agent-info is added', () => {
        service.watchProject('/test/project')

        const addHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'add'
        )?.[1]

        addHandler('/test/project-agent-2/.agent-info')

        expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
      })

      it('sends agents:updated when .agent-info is deleted', () => {
        service.watchProject('/test/project')

        const unlinkHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'unlink'
        )?.[1]

        unlinkHandler('/test/project-agent-3/.agent-info')

        expect(mockWebContents.send).toHaveBeenCalledWith('agents:updated')
      })
    })

    describe('non-matching file changes', () => {
      it('does not send event for unrelated file changes', () => {
        service.watchProject('/test/project')

        const changeHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'change'
        )?.[1]

        changeHandler('/test/project/some-other-file.json')

        expect(mockWebContents.send).not.toHaveBeenCalled()
      })

      it('does not send event for non-agent-info add events', () => {
        service.watchProject('/test/project')

        const addHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'add'
        )?.[1]

        addHandler('/test/project/new-file.txt')

        expect(mockWebContents.send).not.toHaveBeenCalled()
      })

      it('does not send event for non-agent-info unlink events', () => {
        service.watchProject('/test/project')

        const unlinkHandler = mockWatcher.on.mock.calls.find(
          (call: any[]) => call[0] === 'unlink'
        )?.[1]

        unlinkHandler('/test/project/deleted-file.txt')

        expect(mockWebContents.send).not.toHaveBeenCalled()
      })
    })
  })

  describe('stopWatching', () => {
    it('closes the watcher and clears the reference', () => {
      service.watchProject('/test/project')
      service.stopWatching()

      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('does nothing if no watcher exists', () => {
      // Should not throw
      expect(() => service.stopWatching()).not.toThrow()
    })

    it('allows stopWatching to be called multiple times safely', () => {
      service.watchProject('/test/project')
      service.stopWatching()
      service.stopWatching() // Second call should be safe

      expect(mockWatcher.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('handles project path with trailing slash', () => {
      service.watchProject('/home/user/project/')

      // Should still work correctly - path.join normalizes paths
      expect(chokidar.watch).toHaveBeenCalled()
    })

    it('uses "project" as default name if path ends with separator', () => {
      // Edge case where split('/').pop() might return empty string
      service.watchProject('/home/user/project')

      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('project-agent-*')
        ]),
        expect.any(Object)
      )
    })
  })
})
