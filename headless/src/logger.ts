type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 }

function level(): number {
  const l = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel
  return LEVELS[l] ?? LEVELS.info
}

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
}

export function createLogger(name: string): Logger {
  const prefix = (l: string) => `[${l.toUpperCase().padEnd(5)}] [${name}]`
  return {
    debug(msg, ...args) { if (level() <= 0) console.log(prefix('debug'), msg, ...args) },
    info(msg, ...args) { if (level() <= 1) console.log(prefix('info'), msg, ...args) },
    warn(msg, ...args) { if (level() <= 2) console.warn(prefix('warn'), msg, ...args) },
    error(msg, ...args) { if (level() <= 3) console.error(prefix('error'), msg, ...args) }
  }
}
