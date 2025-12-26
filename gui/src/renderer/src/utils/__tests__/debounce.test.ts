import { debounce } from '../debounce'

describe('debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('should debounce function calls', () => {
    const mockFn = jest.fn()
    const debouncedFn = debounce(mockFn, 1000)

    // Call multiple times
    debouncedFn('call1')
    debouncedFn('call2')
    debouncedFn('call3')

    // Should not have been called yet
    expect(mockFn).not.toHaveBeenCalled()

    // Fast-forward time
    jest.advanceTimersByTime(1000)

    // Should have been called only once with the last argument
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenCalledWith('call3')
  })

  it('should delay execution by the specified wait time', () => {
    const mockFn = jest.fn()
    const debouncedFn = debounce(mockFn, 500)

    debouncedFn('test')

    // Not called before wait time
    jest.advanceTimersByTime(499)
    expect(mockFn).not.toHaveBeenCalled()

    // Called after wait time
    jest.advanceTimersByTime(1)
    expect(mockFn).toHaveBeenCalledWith('test')
  })

  it('should reset timer on subsequent calls', () => {
    const mockFn = jest.fn()
    const debouncedFn = debounce(mockFn, 1000)

    debouncedFn('call1')
    jest.advanceTimersByTime(500)

    // Call again - should reset timer
    debouncedFn('call2')
    jest.advanceTimersByTime(500)

    // Still not called (only 500ms passed since last call)
    expect(mockFn).not.toHaveBeenCalled()

    // Now it should be called
    jest.advanceTimersByTime(500)
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenCalledWith('call2')
  })

  it('should have a cancel method that prevents execution', () => {
    const mockFn = jest.fn()
    const debouncedFn = debounce(mockFn, 1000)

    debouncedFn('test')

    // Cancel before execution
    debouncedFn.cancel()

    // Fast-forward past wait time
    jest.advanceTimersByTime(1000)

    // Should not have been called
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('should allow multiple cancel calls without error', () => {
    const mockFn = jest.fn()
    const debouncedFn = debounce(mockFn, 1000)

    debouncedFn('test')
    debouncedFn.cancel()
    debouncedFn.cancel() // Second cancel should not throw

    jest.advanceTimersByTime(1000)
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('should work with functions that have multiple parameters', () => {
    const mockFn = jest.fn((a: number, b: string, c: boolean) => {})
    const debouncedFn = debounce(mockFn, 1000)

    debouncedFn(42, 'hello', true)
    jest.advanceTimersByTime(1000)

    expect(mockFn).toHaveBeenCalledWith(42, 'hello', true)
  })

  it('should preserve function context and return value', () => {
    const mockFn = jest.fn((x: number) => x * 2)
    const debouncedFn = debounce(mockFn, 1000)

    debouncedFn(5)
    jest.advanceTimersByTime(1000)

    expect(mockFn).toHaveBeenCalledWith(5)
  })
})
