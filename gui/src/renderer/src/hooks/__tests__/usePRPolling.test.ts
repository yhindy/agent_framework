import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePRPolling } from '../usePRPolling'

describe('usePRPolling Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock the specific methods we need on the existing electronAPI
    vi.mocked(window.electronAPI.startPRPolling).mockClear()
    vi.mocked(window.electronAPI.stopPRPolling).mockClear()
    vi.mocked(window.electronAPI.stopAllPRPolling).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should start polling on mount when enabled', () => {
    renderHook(() =>
      usePRPolling({
        assignmentIds: ['assignment-1', 'assignment-2'],
        enabled: true
      })
    )

    expect(window.electronAPI.startPRPolling).toHaveBeenCalledTimes(2)
    expect(window.electronAPI.startPRPolling).toHaveBeenCalledWith('assignment-1', expect.any(String))
    expect(window.electronAPI.startPRPolling).toHaveBeenCalledWith('assignment-2', expect.any(String))
  })

  it('should not start polling when enabled is false', () => {
    renderHook(() =>
      usePRPolling({
        assignmentIds: ['assignment-1'],
        enabled: false
      })
    )

    expect(window.electronAPI.startPRPolling).not.toHaveBeenCalled()
  })

  it('should not start polling when assignmentIds is empty', () => {
    renderHook(() =>
      usePRPolling({
        assignmentIds: [],
        enabled: true
      })
    )

    expect(window.electronAPI.startPRPolling).not.toHaveBeenCalled()
  })

  it('should stop polling on unmount', () => {
    const { unmount } = renderHook(() =>
      usePRPolling({
        assignmentIds: ['assignment-1'],
        enabled: true
      })
    )

    expect(window.electronAPI.startPRPolling).toHaveBeenCalled()
    const subscriberId = (window.electronAPI.startPRPolling as any).mock.calls[0][1]

    unmount()

    expect(window.electronAPI.stopAllPRPolling).toHaveBeenCalledWith(subscriberId)
  })

  it('should update polling when assignmentIds change', () => {
    const { rerender } = renderHook(
      ({ assignmentIds, enabled }) =>
        usePRPolling({
          assignmentIds,
          enabled
        }),
      {
        initialProps: {
          assignmentIds: ['assignment-1'],
          enabled: true
        }
      }
    )

    expect(window.electronAPI.startPRPolling).toHaveBeenCalledTimes(1)

    const subscriberId = (window.electronAPI.startPRPolling as any).mock.calls[0][1]

    // Change assignmentIds
    rerender({
      assignmentIds: ['assignment-1', 'assignment-2'],
      enabled: true
    })

    expect(window.electronAPI.stopPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)
    expect(window.electronAPI.startPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)
    expect(window.electronAPI.startPRPolling).toHaveBeenCalledWith('assignment-2', subscriberId)
  })

  it('should handle enabling/disabling polling', () => {
    const { rerender } = renderHook(
      ({ assignmentIds, enabled }) =>
        usePRPolling({
          assignmentIds,
          enabled
        }),
      {
        initialProps: {
          assignmentIds: ['assignment-1'],
          enabled: true
        }
      }
    )

    expect(window.electronAPI.startPRPolling).toHaveBeenCalled()
    const subscriberId = (window.electronAPI.startPRPolling as any).mock.calls[0][1]

    vi.clearAllMocks()

    // Disable polling
    rerender({
      assignmentIds: ['assignment-1'],
      enabled: false
    })

    expect(window.electronAPI.startPRPolling).not.toHaveBeenCalled()
    expect(window.electronAPI.stopPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)

    vi.clearAllMocks()

    // Re-enable polling
    rerender({
      assignmentIds: ['assignment-1'],
      enabled: true
    })

    expect(window.electronAPI.startPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)
  })

  it('should generate unique subscriberId for each component instance', () => {
    renderHook(() =>
      usePRPolling({
        assignmentIds: ['assignment-1'],
        enabled: true
      })
    )

    renderHook(() =>
      usePRPolling({
        assignmentIds: ['assignment-1'],
        enabled: true
      })
    )

    const subscriberId1 = (window.electronAPI.startPRPolling as any).mock.calls[0][1]
    const subscriberId2 = (window.electronAPI.startPRPolling as any).mock.calls[1][1]

    expect(subscriberId1).not.toEqual(subscriberId2)
  })

  it('should cleanup all subscriptions on unmount', () => {
    const { unmount } = renderHook(() =>
      usePRPolling({
        assignmentIds: ['assignment-1', 'assignment-2', 'assignment-3'],
        enabled: true
      })
    )

    const subscriberId = (window.electronAPI.startPRPolling as any).mock.calls[0][1]

    vi.clearAllMocks()

    unmount()

    // Should call stopAllPRPolling once with the subscriber ID
    expect(window.electronAPI.stopAllPRPolling).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.stopAllPRPolling).toHaveBeenCalledWith(subscriberId)
  })

  it('should handle rapid enable/disable cycles', () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        usePRPolling({
          assignmentIds: ['assignment-1'],
          enabled
        }),
      {
        initialProps: {
          enabled: true
        }
      }
    )

    const subscriberId = (window.electronAPI.startPRPolling as any).mock.calls[0][1]

    vi.clearAllMocks()

    // Rapid enable/disable
    rerender({ enabled: false })
    expect(window.electronAPI.stopPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)

    rerender({ enabled: true })
    expect(window.electronAPI.startPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)

    vi.clearAllMocks()

    rerender({ enabled: false })
    expect(window.electronAPI.stopPRPolling).toHaveBeenCalledWith('assignment-1', subscriberId)
  })
})
