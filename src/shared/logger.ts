/**
 * Centralized logging system.
 * Thin wrapper around electron-log v5 providing scoped loggers.
 * Used by main process modules. Renderer uses electron-log/renderer via src/renderer/src/logger.ts.
 */

import log from 'electron-log'

// Configure file transport
log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}'

// Console: env var override, then verbose in development, warnings only in production
const envLevel = process.env.TONNET_LOG_LEVEL as log.LogLevel | undefined
log.transports.console.level = envLevel || (process.env.NODE_ENV === 'development' ? 'debug' : 'warn')

// Suppress EPIPE errors on stdout/stderr (pipe can break in Electron dev mode).
// Idempotent: brand each stream so repeated module evaluation (e.g. vitest
// re-importing this module per worker) does not stack listeners and trip
// MaxListenersExceededWarning, nor leak listeners in the long-running main process.
const EPIPE_GUARD = Symbol.for('tonnet.logger.epipeGuard')
for (const stream of [process.stdout, process.stderr]) {
  if (!stream) continue
  const tagged = stream as unknown as Record<symbol, true>
  if (tagged[EPIPE_GUARD]) continue
  tagged[EPIPE_GUARD] = true
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}

export default log

// Convenience: create a scoped logger for a module
export function createLogger(scope: string) {
  return log.scope(scope)
}
