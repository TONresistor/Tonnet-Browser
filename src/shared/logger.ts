/**
 * Centralized logging system.
 * Thin wrapper around electron-log v5 providing scoped loggers.
 * Used by main process modules. Renderer uses electron-log/renderer via src/renderer/src/logger.ts.
 */

import log from 'electron-log'

const REDACTED = '[REDACTED]'
const SENSITIVE_FIELD =
  /^(?:authorization|mnemonic|password|payload|private(?:key)?|secret(?:key)?|seed|signature|signed(?:payload)?|token|boc)$/i
const SECRET_LABEL =
  /(authorization|mnemonic|password|private(?:[_ -]?key)?|secret(?:[_ -]?key)?|seed|signature|signed(?:[_ -]?payload)?|token|boc)(\s*[=:]\s*|["']\s*:\s*["'])[^\s,;"']+/gi
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const FULL_HEX_BLOB = /\b(?:0x)?[a-fA-F0-9]{128,}\b/g
const BOC_BASE64 = /\bte6cc[A-Za-z0-9+/=_-]{32,}\b/g

function redactString(value: string): string {
  return value
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(SECRET_LABEL, (_match, label: string, separator: string) => `${label}${separator}${REDACTED}`)
    .replace(FULL_HEX_BLOB, REDACTED)
    .replace(BOC_BASE64, REDACTED)
}

/** Redact log data before it reaches console, file, or any future transport. */
export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[Binary ${(value as Uint8Array).byteLength} bytes]`
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    }
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen))

  const sanitized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_FIELD.test(key) ? REDACTED : redactLogValue(item, seen)
  }
  return sanitized
}

const REDACTION_HOOK = Symbol.for('tonnet.logger.redactionHook')
const taggedLogger = log as typeof log & Record<symbol, true>
if (!taggedLogger[REDACTION_HOOK]) {
  taggedLogger[REDACTION_HOOK] = true
  log.hooks.push((message) => ({ ...message, data: message.data.map((value) => redactLogValue(value)) }))
}

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
