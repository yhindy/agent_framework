/**
 * IdleDetector - Shared idle detection module for terminal sessions.
 *
 * This module encapsulates the logic for detecting when a terminal is idle
 * (waiting for user input) vs actively working. It can be used by both
 * agent terminals (running Claude) and plain terminals (user shells).
 */

// Simple ANSI strip function to avoid ESM issues
function stripAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

export interface IdleDetectorConfig {
  /** Patterns that indicate work is happening (resets idle timer) */
  workingPatterns: RegExp[]
  /** Patterns that indicate waiting for input (optional heuristic) */
  idleIndicators: RegExp[]
  /** How long to wait before emitting waiting event (ms) */
  idleThreshold: number
  /** Grace period after user input before allowing waiting state (ms) */
  inputGracePeriod: number
  /** Whether detection requires a "started" signal before activating */
  requireStartSignal?: boolean
  /** Pattern to detect the "started" signal (e.g., Claude Code header) */
  startPattern?: RegExp
}

export interface IdleDetectorCallbacks {
  onWaitingForInput: (context: string) => void
  onResumedWork: () => void
}

export const DEFAULT_CONFIG: Partial<IdleDetectorConfig> = {
  idleThreshold: 2000,
  inputGracePeriod: 1000
}

// Claude Code specific patterns
export const CLAUDE_WORKING_PATTERNS = [
  /Sussing…/,
  /Booping…/,
  /Puttering…/,
  /Thinking…/,
  /Inferring…/,
  /Working…/,
  /Running…/,
  /Waiting…/,
  /esc to interrupt/
]

export const CLAUDE_IDLE_INDICATORS = [
  /^>\s*$/m, // Just ">" on a line (empty input prompt)
  /⏵⏵\s*bypass/i, // Permission bypass prompt
  /shift\+tab to cycle/i, // Permission selector UI
  /-- INSERT --/ // Vim-like insert mode indicator
]

export const CLAUDE_START_PATTERN = /Claude Code/

// Codex-specific patterns (OpenAI agent CLI)
export const CODEX_WORKING_PATTERNS = [
  /Analyzing/i,
  /Processing/i,
  /Thinking/i,
  /Working/i,
  /Running/i,
  /Making changes/i,
  /Implementing/i,
  /Refactoring/i,
  /Updating/i,
  /^\s*\.\.\./m // Progress dots at start of line
]

// Shell-specific patterns (for plain terminals)
export const SHELL_WORKING_PATTERNS = [
  ...CLAUDE_WORKING_PATTERNS, // Include Claude patterns since users run Claude in plain terminals
  /\d+%/, // Progress percentage
  /Building|Compiling|Bundling/i, // Build processes
  /Installing|Downloading/i, // Package managers
  /Running tests/i, // Test runners
  /^\s*\.\.\./m // Progress dots at start of line
]

export const SHELL_IDLE_INDICATORS = [
  ...CLAUDE_IDLE_INDICATORS, // Include Claude patterns
  /[$%>#]\s*$/m, // Standard shell prompt characters at end of line
  /\)\s*$/m, // End of PS1 with )
  /]\s*$/m, // End of PS1 with ]
  /Tests:\s+\d+\s+passed/i, // Jest/Vitest completion
  /PASS\s|FAIL\s/, // Test results
  /All tests passed/i
]

export class IdleDetector {
  private config: IdleDetectorConfig
  private callbacks: IdleDetectorCallbacks

  // State
  private outputBuffer: string = ''
  private isWaiting: boolean = false
  private hasStarted: boolean = false
  private lastInputTime: number = 0
  private lastWorkingTime: number = 0
  private idleTimer?: NodeJS.Timeout

  constructor(config: IdleDetectorConfig, callbacks: IdleDetectorCallbacks) {
    this.config = { ...DEFAULT_CONFIG, ...config } as IdleDetectorConfig
    this.callbacks = callbacks

    // If no start signal required, consider it already started
    if (!this.config.requireStartSignal) {
      this.hasStarted = true
    }
  }

  /**
   * Process terminal output data.
   * Call this on every chunk of data received from the terminal.
   */
  processOutput(data: string): void {
    // Update output buffer (keep last 2000 chars for pattern detection)
    this.outputBuffer = (this.outputBuffer + data).slice(-2000)

    const stripped = stripAnsi(data)

    // Check for start pattern if required
    if (!this.hasStarted && this.config.startPattern) {
      if (this.config.startPattern.test(this.outputBuffer)) {
        this.hasStarted = true
      }
    }

    // Check for working patterns in the CURRENT CHUNK only
    const isWorkingNow = this.isWorking(stripped)

    if (isWorkingNow) {
      this.lastWorkingTime = Date.now()
      this.cancelIdleTimer()

      if (this.isWaiting) {
        this.isWaiting = false
        this.callbacks.onResumedWork()
      }
      return // Don't process further - terminal is working
    }

    // Only start idle detection if started (for Claude terminals)
    if (!this.hasStarted) {
      return
    }

    // Not showing working indicators - start idle timer
    if (!this.idleTimer && !this.isWaiting) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = undefined

        // Grace period check: if input was sent very recently, don't trigger waiting state
        const timeSinceLastInput = Date.now() - this.lastInputTime
        if (timeSinceLastInput < this.config.inputGracePeriod) {
          return
        }

        // Double-check we haven't seen working indicators recently
        const timeSinceLastWorking = Date.now() - this.lastWorkingTime
        if (timeSinceLastWorking < this.config.idleThreshold) {
          return
        }

        // Terminal is idle - emit waiting event
        this.isWaiting = true
        const context = this.outputBuffer.slice(-500)
        this.callbacks.onWaitingForInput(context)
      }, this.config.idleThreshold)
    }
  }

  /**
   * Record that user input was sent.
   * Call this when the user sends input to the terminal.
   */
  recordInput(): void {
    this.lastInputTime = Date.now()

    // Clear waiting state immediately on input
    if (this.isWaiting) {
      this.isWaiting = false
      this.callbacks.onResumedWork()
    }

    // Cancel any pending idle timer
    this.cancelIdleTimer()
  }

  /**
   * Check if currently in waiting state.
   */
  getIsWaiting(): boolean {
    return this.isWaiting
  }

  /**
   * Set waiting state externally (e.g., restoring from persisted state).
   */
  setIsWaiting(waiting: boolean): void {
    this.isWaiting = waiting
  }

  /**
   * Mark as started (for terminals that require a start signal).
   */
  setHasStarted(started: boolean): void {
    this.hasStarted = started
  }

  /**
   * Get the current output buffer (useful for context in notifications).
   */
  getOutputBuffer(): string {
    return this.outputBuffer
  }

  /**
   * Clean up timers and resources.
   */
  dispose(): void {
    this.cancelIdleTimer()
  }

  private isWorking(strippedText: string): boolean {
    return this.config.workingPatterns.some((pattern) => pattern.test(strippedText))
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }
}
