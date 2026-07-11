import log from 'electron-log/renderer'

const STRUCTURED_MARKER = '__tonnetLogEvent'

export default log

export function createLogger(scope: string) {
  const scoped = log.scope(scope)
  return {
    debug: (...data: unknown[]) => scoped.debug(...data),
    info: (...data: unknown[]) => scoped.info(...data),
    warn: (...data: unknown[]) => scoped.warn(...data),
    error: (...data: unknown[]) => scoped.error(...data),
    event: (level: 'debug' | 'info' | 'warn' | 'error', event: string, message: string, fields = {}) =>
      scoped[level]({ [STRUCTURED_MARKER]: 1, event, message, fields, console: false }),
    status: (event: string, message: string, fields = {}) =>
      scoped.info({ [STRUCTURED_MARKER]: 1, event, message, fields, console: true }),
  }
}
