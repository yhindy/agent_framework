import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  IdleDetector,
  IdleDetectorConfig,
  IdleDetectorCallbacks,
  CLAUDE_WORKING_PATTERNS,
  CLAUDE_IDLE_INDICATORS,
  CLAUDE_START_PATTERN,
  SHELL_WORKING_PATTERNS,
  SHELL_IDLE_INDICATORS
} from '../IdleDetector'

describe('IdleDetector', () => {
  let detector: IdleDetector
  let mockCallbacks: IdleDetectorCallbacks
  let onWaitingForInput: ReturnType<typeof vi.fn>
  let onResumedWork: ReturnType<typeof vi.fn>

  const createDetector = (configOverrides: Partial<IdleDetectorConfig> = {}): IdleDetector => {
    const config: IdleDetectorConfig = {
      workingPatterns: CLAUDE_WORKING_PATTERNS,
      idleIndicators: CLAUDE_IDLE_INDICATORS,
      idleThreshold: 2000,
      inputGracePeriod: 1000,
      ...configOverrides
    }
    return new IdleDetector(config, mockCallbacks)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    onWaitingForInput = vi.fn()
    onResumedWork = vi.fn()
    mockCallbacks = {
      onWaitingForInput,
      onResumedWork
    }
  })

  afterEach(() => {
    detector?.dispose()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('pattern matching', () => {
    it('detects working patterns and resets idle timer', () => {
      detector = createDetector()

      // Send some output
      detector.processOutput('Some text here\n')

      // Advance time partway
      vi.advanceTimersByTime(1000)

      // Send working pattern - should reset timer
      detector.processOutput('Thinking…')

      // Advance past original threshold
      vi.advanceTimersByTime(1500)

      // Should NOT have triggered waiting (timer was reset)
      expect(onWaitingForInput).not.toHaveBeenCalled()
    })

    it('detects all Claude working patterns', () => {
      detector = createDetector()

      const patterns = [
        'Sussing…',
        'Booping…',
        'Puttering…',
        'Thinking…',
        'Inferring…',
        'Working…',
        'Running…',
        'Waiting…',
        'Press esc to interrupt'
      ]

      for (const pattern of patterns) {
        // Reset state
        detector.dispose()
        detector = createDetector()

        // Start idle timer
        detector.processOutput('Some text\n')
        vi.advanceTimersByTime(1000)

        // Send working pattern
        detector.processOutput(pattern)

        // Advance past threshold
        vi.advanceTimersByTime(3000)

        // Should NOT be waiting since we saw working pattern
        expect(onWaitingForInput).not.toHaveBeenCalled()
        onWaitingForInput.mockClear()
      }
    })

    it('handles ANSI escape sequences correctly', () => {
      detector = createDetector()

      // Send text with ANSI codes wrapping "Thinking"
      const ansiText = '\x1b[32mThinking…\x1b[0m'
      detector.processOutput(ansiText)

      vi.advanceTimersByTime(3000)

      // Should have detected the working pattern despite ANSI codes
      expect(onWaitingForInput).not.toHaveBeenCalled()
    })

    it('detects idle indicators', () => {
      detector = createDetector()

      // Send idle indicator
      detector.processOutput('>\n')

      // Wait for threshold
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalled()
    })
  })

  describe('state machine', () => {
    it('transitions to waiting after idle threshold', () => {
      detector = createDetector()

      // Send non-working output
      detector.processOutput('Some regular output\n')

      // Not waiting yet
      expect(onWaitingForInput).not.toHaveBeenCalled()

      // Advance past threshold
      vi.advanceTimersByTime(2500)

      // Now waiting
      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
      expect(detector.getIsWaiting()).toBe(true)
    })

    it('transitions back to working on working pattern', () => {
      detector = createDetector()

      // Trigger waiting state
      detector.processOutput('Some output\n')
      vi.advanceTimersByTime(2500)
      expect(detector.getIsWaiting()).toBe(true)

      // Send working pattern
      detector.processOutput('Thinking…')

      // Should have resumed
      expect(onResumedWork).toHaveBeenCalledTimes(1)
      expect(detector.getIsWaiting()).toBe(false)
    })

    it('respects input grace period', () => {
      detector = createDetector({ inputGracePeriod: 1000 })

      // Send output to start idle timer
      detector.processOutput('Some output\n')

      // Advance 1500ms (partway through 2000ms idle threshold)
      vi.advanceTimersByTime(1500)

      // Now send input - this sets lastInputTime to 1500ms (virtual time)
      // and cancels the pending timer
      detector.recordInput()

      // Send more output - starts new 2000ms idle timer (fires at t=3500)
      detector.processOutput('More output\n')

      // Advance 2000ms (now at t=3500, timer fires)
      // When timer fires: Date.now() = 3500ms, lastInputTime = 1500ms
      // timeSinceLastInput = 3500 - 1500 = 2000ms > 1000ms grace period
      // So it WILL emit waiting (which is correct behavior - grace period expired)

      // To actually test the grace period, we need to fire the timer
      // WITHIN the grace period. So let's send input just before the timer fires.
      vi.advanceTimersByTime(1500)  // now at t=3000, timer at t=3500

      // Send input at t=3000 (timer fires at t=3500)
      // timeSinceLastInput at t=3500 = 3500 - 3000 = 500ms < 1000ms
      detector.recordInput()

      // Advance to fire the timer
      vi.advanceTimersByTime(500)  // now at t=3500

      // Timer fires but grace period check should prevent waiting
      // because timeSinceLastInput = 500ms < 1000ms
      expect(onWaitingForInput).not.toHaveBeenCalled()
    })

    it('emits callbacks on state transitions', () => {
      detector = createDetector()

      // Trigger waiting
      detector.processOutput('Output\n')
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
      expect(onWaitingForInput).toHaveBeenCalledWith(expect.stringContaining('Output'))

      // Resume
      detector.processOutput('Thinking…')
      expect(onResumedWork).toHaveBeenCalledTimes(1)
    })

    it('does not emit waiting if already waiting', () => {
      detector = createDetector()

      // Trigger waiting
      detector.processOutput('Output\n')
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalledTimes(1)

      // More output while waiting
      detector.processOutput('More output\n')
      vi.advanceTimersByTime(2500)

      // Should still only have one call
      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
    })

    it('clears waiting state on user input', () => {
      detector = createDetector()

      // Trigger waiting
      detector.processOutput('Output\n')
      vi.advanceTimersByTime(2500)
      expect(detector.getIsWaiting()).toBe(true)

      // Send input
      detector.recordInput()

      expect(onResumedWork).toHaveBeenCalledTimes(1)
      expect(detector.getIsWaiting()).toBe(false)
    })
  })

  describe('timer management', () => {
    it('cancels timer on dispose', () => {
      detector = createDetector()

      // Start timer
      detector.processOutput('Output\n')

      // Dispose before timer fires
      detector.dispose()

      // Advance time
      vi.advanceTimersByTime(3000)

      // Should not have fired
      expect(onWaitingForInput).not.toHaveBeenCalled()
    })

    it('resets timer on new working output', () => {
      detector = createDetector()

      // Start timer
      detector.processOutput('Output\n')
      vi.advanceTimersByTime(1500)

      // Working pattern resets timer
      detector.processOutput('Thinking…')

      // Advance past original threshold
      vi.advanceTimersByTime(1000)

      // Should not be waiting
      expect(onWaitingForInput).not.toHaveBeenCalled()

      // Non-working output starts new timer
      detector.processOutput('Done thinking\n')

      // Wait for new threshold
      vi.advanceTimersByTime(2500)

      // Now should be waiting
      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
    })

    it('does not double-emit waiting events', () => {
      detector = createDetector()

      detector.processOutput('Output\n')
      vi.advanceTimersByTime(2500)
      expect(onWaitingForInput).toHaveBeenCalledTimes(1)

      // More non-working output
      detector.processOutput('More output\n')
      vi.advanceTimersByTime(2500)

      // Should still be just one call
      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
    })
  })

  describe('start signal handling', () => {
    it('waits for start pattern before enabling detection', () => {
      detector = createDetector({
        requireStartSignal: true,
        startPattern: CLAUDE_START_PATTERN
      })

      // Output before start signal
      detector.processOutput('Some early output\n')
      vi.advanceTimersByTime(3000)

      // Should NOT be waiting - not started yet
      expect(onWaitingForInput).not.toHaveBeenCalled()

      // Start signal
      detector.processOutput('Welcome to Claude Code\n')

      // Now output triggers detection
      detector.processOutput('>\n')
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
    })

    it('immediately detects if requireStartSignal is false', () => {
      detector = createDetector({
        requireStartSignal: false
      })

      detector.processOutput('Some output\n')
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalledTimes(1)
    })
  })

  describe('shell patterns', () => {
    it('detects shell working patterns', () => {
      detector = createDetector({
        workingPatterns: SHELL_WORKING_PATTERNS,
        idleIndicators: SHELL_IDLE_INDICATORS
      })

      const shellWorkingPatterns = [
        'Installing packages... 50%',
        'Building project...',
        'Compiling TypeScript...',
        'Downloading dependencies...',
        'Running tests...'
      ]

      for (const pattern of shellWorkingPatterns) {
        detector.dispose()
        detector = createDetector({
          workingPatterns: SHELL_WORKING_PATTERNS,
          idleIndicators: SHELL_IDLE_INDICATORS
        })

        detector.processOutput('Starting...\n')
        vi.advanceTimersByTime(1000)

        detector.processOutput(pattern + '\n')
        vi.advanceTimersByTime(3000)

        expect(onWaitingForInput).not.toHaveBeenCalled()
        onWaitingForInput.mockClear()
      }
    })

    it('detects shell idle indicators', () => {
      // Shell idle indicators just mean the terminal is at a prompt
      // The test should verify that when these indicators are present,
      // after the idle threshold, the waiting event fires
      detector = createDetector({
        workingPatterns: SHELL_WORKING_PATTERNS,
        idleIndicators: SHELL_IDLE_INDICATORS
      })

      // Send shell prompt - this is an idle indicator but not a working pattern
      detector.processOutput('user@host:~$ ')
      vi.advanceTimersByTime(2500)

      // Should have emitted waiting because no working patterns were detected
      expect(onWaitingForInput).toHaveBeenCalled()
    })
  })

  describe('output buffer', () => {
    it('maintains rolling buffer of recent output', () => {
      detector = createDetector()

      // Send some output
      detector.processOutput('Line 1\n')
      detector.processOutput('Line 2\n')
      detector.processOutput('Line 3\n')

      const buffer = detector.getOutputBuffer()
      expect(buffer).toContain('Line 1')
      expect(buffer).toContain('Line 2')
      expect(buffer).toContain('Line 3')
    })

    it('limits buffer size to 2000 characters', () => {
      detector = createDetector()

      // Send a lot of output
      const longOutput = 'x'.repeat(3000)
      detector.processOutput(longOutput)

      const buffer = detector.getOutputBuffer()
      expect(buffer.length).toBe(2000)
    })

    it('includes recent context in waiting callback', () => {
      detector = createDetector()

      detector.processOutput('Important context here\n')
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalledWith(expect.stringContaining('Important context'))
    })
  })

  describe('state management', () => {
    it('allows setting waiting state externally', () => {
      detector = createDetector()

      expect(detector.getIsWaiting()).toBe(false)

      detector.setIsWaiting(true)
      expect(detector.getIsWaiting()).toBe(true)

      detector.setIsWaiting(false)
      expect(detector.getIsWaiting()).toBe(false)
    })

    it('allows setting started state externally', () => {
      detector = createDetector({
        requireStartSignal: true,
        startPattern: CLAUDE_START_PATTERN
      })

      // Manually set as started
      detector.setHasStarted(true)

      // Should now detect
      detector.processOutput('Output\n')
      vi.advanceTimersByTime(2500)

      expect(onWaitingForInput).toHaveBeenCalled()
    })
  })
})
