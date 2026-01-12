/**
 * Centralized logging utility for the Agent Framework.
 *
 * Log levels (from least to most verbose):
 * - error: Critical errors that need attention
 * - warn: Warning conditions
 * - info: Important operational messages (default)
 * - debug: Detailed debugging information
 *
 * Control via LOG_LEVEL environment variable:
 * - LOG_LEVEL=error  (only errors)
 * - LOG_LEVEL=warn   (errors + warnings)
 * - LOG_LEVEL=info   (errors + warnings + info) [default]
 * - LOG_LEVEL=debug  (everything)
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

function getCurrentLogLevel(): number {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined
  if (envLevel && envLevel in LOG_LEVELS) {
    return LOG_LEVELS[envLevel]
  }
  return LOG_LEVELS.info // default
}

function formatMessage(prefix: string, message: string): string {
  return `[${prefix}] ${message}`
}

function formatArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return arg.message
    }
    return arg
  })
}

class Logger {
  private prefix: string
  private currentLevel: number

  constructor(prefix: string) {
    this.prefix = prefix
    this.currentLevel = getCurrentLogLevel()
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= this.currentLevel
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(formatMessage(this.prefix, message), ...formatArgs(args))
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(formatMessage(this.prefix, message), ...formatArgs(args))
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(formatMessage(this.prefix, message), ...formatArgs(args))
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(formatMessage(this.prefix, message), ...formatArgs(args))
    }
  }
}

// Pre-configured loggers for each service
export const log = {
  agent: new Logger('AgentService'),
  terminal: new Logger('TerminalService'),
  project: new Logger('ProjectService'),
  ipc: new Logger('IPC'),
  startup: new Logger('Startup'),
  pr: new Logger('PR'),
  prPolling: new Logger('PRPolling'),
  claudeSession: new Logger('ClaudeSession'),
  notification: new Logger('Notification'),
  testEnv: new Logger('TestEnv'),
}

export function createLogger(prefix: string): Logger {
  return new Logger(prefix)
}
