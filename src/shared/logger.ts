/**
 * Centralized logging system.
 * Thin wrapper around electron-log v5 providing scoped loggers.
 */

import log from 'electron-log'

// Configure file transport
log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}'

// Console: verbose in development, warnings only in production
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'

// Catch uncaught exceptions and unhandled rejections automatically
log.errorHandler.startCatching()

export default log

// Convenience: create a scoped logger for a module
export function createLogger(scope: string) {
  return log.scope(scope)
}
