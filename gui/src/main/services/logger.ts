/**
 * Simple logger utility for consistent, configurable logging.
 *
 * Usage:
 *   import { createLogger } from './logger'
 *   const log = createLogger('ServiceName')
 *   log.info('Something happened', { data })
 *   log.error('Failed to do thing', error)
 *
 * Log levels (in order of priority):
 *   - error: Always shown (unless LOG_LEVEL=silent)
 *   - warn:  Shown when LOG_LEVEL is warn, info, or debug
 *   - info:  Shown when LOG_LEVEL is info or debug (default)
 *   - debug: Only shown when LOG_LEVEL=debug
 *
 * Set LOG_LEVEL environment variable to control output:
 *   LOG_LEVEL=debug   - Show all logs
 *   LOG_LEVEL=info    - Show info, warn, error (default)
 *   LOG_LEVEL=warn    - Show warn, error only
 *   LOG_LEVEL=error   - Show errors only
 *   LOG_LEVEL=silent  - Show nothing
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
}

function getLogLevel(): LogLevel {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel
  return LOG_LEVELS[level] !== undefined ? level : 'info'
}

function shouldLog(messageLevel: LogLevel): boolean {
  const currentLevel = getLogLevel()
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[currentLevel]
}

function formatPrefix(level: LogLevel, name: string): string {
  const levelTag = level.toUpperCase().padEnd(5)
  return `[${levelTag}] [${name}]`
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

/**
 * Create a logger instance for a service or component.
 *
 * @param name - The name of the service/component (e.g., 'TerminalService')
 * @returns Logger instance with debug, info, warn, error methods
 */
export function createLogger(name: string): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog('debug')) {
        console.log(formatPrefix('debug', name), message, ...args)
      }
    },

    info(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        console.log(formatPrefix('info', name), message, ...args)
      }
    },

    warn(message: string, ...args: unknown[]): void {
      if (shouldLog('warn')) {
        console.warn(formatPrefix('warn', name), message, ...args)
      }
    },

    error(message: string, ...args: unknown[]): void {
      if (shouldLog('error')) {
        console.error(formatPrefix('error', name), message, ...args)
      }
    }
  }
}
