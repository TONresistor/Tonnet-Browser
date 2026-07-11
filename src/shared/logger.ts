/**
 * Application-wide logging boundary for the Electron main process.
 *
 * The public logger keeps the familiar debug/info/warn/error methods while
 * adding structured events and an explicit status channel for the concise
 * developer console. Every file record is a single JSON line.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import log from 'electron-log/main'

const REDACTED = '[REDACTED]'
const STRUCTURED_MARKER = '__tonnetLogEvent'
const MAX_ATTRIBUTE_LENGTH = 16 * 1024
const MAX_OBJECT_DEPTH = 6
const SENSITIVE_FIELD =
  /(?:(?:api[-_]?key|authorization|boc|cookie|login|mnemonic|pass(?:word)?|payload|private(?:key)?|secret(?:key)?|seed|session(?:id)?|signature|signed(?:payload)?|token)$|(?:address|bagId|domain|host|node|path|paymentId|peerId|remote|room|url|wallet)$)/i
const SECRET_LABEL =
  /(api[-_ ]?key|authorization|boc|cookie|login|mnemonic|pass(?:word)?|private(?:[_ -]?key)?|secret(?:[_ -]?key)?|seed|session(?:[_ -]?id)?|signature|signed(?:[_ -]?payload)?|token)(\s*[=:]\s*|["']\s*:\s*["'])[^\s,;"']+/gi
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const IDENTITY_HEX_BLOB = /\b(?:0x)?[a-fA-F0-9]{64,}\b/g
const BOC_BASE64 = /\bte6cc[A-Za-z0-9+/=_-]{32,}\b/g
const URL_VALUE = /\b(?:(?:https?|wss?):\/\/(?!(?:127\.0\.0\.1|localhost)(?=[:/]))|(?:ton|file):\/\/)[^\s,;]+/gi
const BARE_DOMAIN =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+(?!(?:tsx?|jsx?|mjs|cjs|json|css|html?|md|svg|png|jpe?g|woff2?|log|dat)\b)[a-z]{2,63}\b/gi
const ROOM_IDENTIFIER = /\b[a-z0-9_-]{2,64}:[a-z_][a-z0-9_.-]{1,127}\b/gi
const TON_ADDRESS = /\b(?:EQ|UQ)[A-Za-z0-9_-]{46}\b/g
const UUID_VALUE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const NATIVE_IDENTITY_FIELD =
  /\b(address|bag_id|domain|host|node|overlay_id|peer_id|remote|room|wallet|url)=([^\s,;]+)/gi
const IPV4_ADDRESS = /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g
const USER_PATH = /(?:\/Users|\/home)\/[^\s,;]+/g
// Native helpers and remote content are untrusted log sources; control bytes
// must be removed before either human or machine-readable rendering.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const LINE_BREAKS = /[\r\n\u2028\u2029]+/g

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

interface StructuredLogEnvelope {
  [STRUCTURED_MARKER]: 1
  event: string
  message: string
  fields: LogFields
  console: boolean
}

interface LogContext {
  operationId: string
}

const operationContext = new AsyncLocalStorage<LogContext>()
let applicationVersion = 'unknown'
let launchId = randomUUID().slice(0, 8)
let diagnosticUntil = 0
let diagnosticTimer: ReturnType<typeof setTimeout> | null = null
const requestedLogLevel = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'].includes(
  process.env.TONNET_LOG_LEVEL ?? ''
)
  ? (process.env.TONNET_LOG_LEVEL as 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly')
  : undefined

function sanitizeText(value: string): string {
  return value
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(SECRET_LABEL, (_match, label: string, separator: string) => `${label}${separator}${REDACTED}`)
    .replace(IDENTITY_HEX_BLOB, REDACTED)
    .replace(BOC_BASE64, REDACTED)
    .replace(URL_VALUE, '[URL]')
    .replace(TON_ADDRESS, REDACTED)
    .replace(UUID_VALUE, REDACTED)
    .replace(ROOM_IDENTIFIER, REDACTED)
    .replace(BARE_DOMAIN, REDACTED)
    .replace(LINE_BREAKS, ' ↵ ')
    .replace(CONTROL_CHARACTERS, '')
    .slice(0, MAX_ATTRIBUTE_LENGTH)
}

/** Redact and bound data before it reaches any transport. */
export function redactLogValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return sanitizeText(value)
  if (value === null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[Binary ${(value as Uint8Array).byteLength} bytes]`
  if (depth >= MAX_OBJECT_DEPTH) return '[MaxDepth]'
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    return {
      'exception.type': value.name,
      'exception.message': sanitizeText(value.message),
      'exception.stacktrace': value.stack ? sanitizeText(value.stack) : undefined,
    }
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactLogValue(item, seen, depth + 1))

  const sanitized: Record<string, unknown> = {}
  const structuredEnvelope = (value as Record<string, unknown>)[STRUCTURED_MARKER] === 1
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (structuredEnvelope && key === 'event' && typeof item === 'string') {
      sanitized[key] = item.replace(LINE_BREAKS, '.').replace(CONTROL_CHARACTERS, '').slice(0, 256)
    } else {
      sanitized[key] = SENSITIVE_FIELD.test(key) ? REDACTED : redactLogValue(item, seen, depth + 1)
    }
  }
  return sanitized
}

/** Remove browsing and machine identity from unstructured native output. */
export function redactNativeLogLine(value: string): string {
  const sanitized = redactLogValue(value)
  return String(sanitized)
    .replace(NATIVE_IDENTITY_FIELD, '$1=[REDACTED]')
    .replace(IPV4_ADDRESS, '[IP]')
    .replace(USER_PATH, '[PATH]')
}

function isEnvelope(value: unknown): value is StructuredLogEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>)[STRUCTURED_MARKER] === 1 &&
    typeof (value as Record<string, unknown>).event === 'string'
  )
}

function formatLegacyMessage(data: unknown[]): string {
  return data
    .map((value) => {
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    })
    .join(' ')
}

function recordFor(message: {
  data: unknown[]
  date: Date
  level: string
  scope?: string
  variables?: Record<string, unknown>
}): Record<string, unknown> {
  const envelope = isEnvelope(message.data[0]) ? message.data[0] : null
  const context = operationContext.getStore()
  const fields = envelope?.fields ?? {}
  return {
    ts: message.date.toISOString(),
    level: message.level,
    scope: message.scope || 'app',
    event: envelope?.event ?? 'log',
    process: message.variables?.processType ?? 'main',
    appVersion: applicationVersion,
    launchId,
    ...(context?.operationId ? { operationId: context.operationId } : {}),
    message: envelope?.message ?? formatLegacyMessage(message.data),
    ...fields,
  }
}

function consoleText(message: { data: unknown[]; level: string; scope?: string }): string {
  const envelope = isEnvelope(message.data[0]) ? message.data[0] : null
  const body = envelope?.message ?? formatLegacyMessage(message.data)
  const marker = message.level === 'error' ? '✕' : message.level === 'warn' ? '!' : envelope?.console ? '✓' : '·'
  const scope = message.scope || 'app'
  return `${marker} ${scope.padEnd(10)} ${body}`
}

export function isDiagnosticLoggingEnabled(): boolean {
  const envLevel = process.env.TONNET_LOG_LEVEL
  return diagnosticUntil > Date.now() || envLevel === 'debug' || envLevel === 'silly'
}

const LOGGER_HOOK = Symbol.for('tonnet.logger.enterpriseHook')
const taggedLogger = log as typeof log & Record<symbol, true>
if (!taggedLogger[LOGGER_HOOK]) {
  taggedLogger[LOGGER_HOOK] = true
  log.hooks.push((message, _transport, transportName) => {
    const data = message.data.map((value) => redactLogValue(value))
    const next = { ...message, data }
    if (transportName !== 'console') return next

    const envelope = isEnvelope(data[0]) ? data[0] : null
    const alwaysVisible = message.level === 'error' || message.level === 'warn'
    if (!alwaysVisible && !envelope?.console && !isDiagnosticLoggingEnabled()) return false
    return next
  })
}

log.transports.file.level = requestedLogLevel || 'info'
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.writeOptions = { ...log.transports.file.writeOptions, mode: 0o600 }
log.transports.file.format = ({ message }) => [JSON.stringify(recordFor(message))]

log.transports.console.level = requestedLogLevel || (process.env.NODE_ENV === 'development' ? 'info' : 'warn')
log.transports.console.format = ({ message }) => [consoleText(message)]

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

export function configureApplicationLogging(version: string): void {
  applicationVersion = version
  launchId = randomUUID().slice(0, 8)
}

export function enableDiagnosticLogging(durationMs = 15 * 60 * 1000): number {
  if (diagnosticTimer) clearTimeout(diagnosticTimer)
  diagnosticUntil = Date.now() + Math.max(1_000, durationMs)
  log.transports.file.level = 'debug'
  log.transports.console.level = 'debug'
  diagnosticTimer = setTimeout(() => disableDiagnosticLogging(), diagnosticUntil - Date.now())
  diagnosticTimer.unref?.()
  return diagnosticUntil
}

export function disableDiagnosticLogging(): void {
  if (diagnosticTimer) clearTimeout(diagnosticTimer)
  diagnosticTimer = null
  diagnosticUntil = 0
  log.transports.file.level = requestedLogLevel || 'info'
  log.transports.console.level = requestedLogLevel || (process.env.NODE_ENV === 'development' ? 'info' : 'warn')
}

export function diagnosticLoggingStatus(): { enabled: boolean; until: number | null } {
  const enabled = isDiagnosticLoggingEnabled()
  return { enabled, until: diagnosticUntil > Date.now() ? diagnosticUntil : null }
}

export function runWithLogContext<T>(operationId: string, operation: () => T): T {
  return operationContext.run({ operationId }, operation)
}

export function createOperationId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

function envelope(event: string, message: string, fields: LogFields, console: boolean): StructuredLogEnvelope {
  return { [STRUCTURED_MARKER]: 1, event, message, fields, console }
}

export function createLogger(scope: string) {
  const scoped = log.scope(scope)
  return {
    debug: (...data: unknown[]) => scoped.debug(...data),
    info: (...data: unknown[]) => scoped.info(...data),
    warn: (...data: unknown[]) => scoped.warn(...data),
    error: (...data: unknown[]) => scoped.error(...data),
    event: (level: LogLevel, eventName: string, message: string, fields: LogFields = {}) =>
      scoped[level](envelope(eventName, message, fields, false)),
    status: (eventName: string, message: string, fields: LogFields = {}) =>
      scoped.info(envelope(eventName, message, fields, true)),
  }
}

type ScopedLogger = ReturnType<typeof createLogger>

/**
 * Summarizes a repeating recoverable condition without hiding its first
 * occurrence or its final recovery. It is intentionally state-based rather
 * than a global text deduplicator so value-moving/security events are never
 * accidentally collapsed.
 */
export class RepetitionAggregator {
  private readonly entries = new Map<string, { count: number; firstAt: number; lastSummaryAt: number }>()

  constructor(
    private readonly logger: ScopedLogger,
    private readonly summaryWindowMs = 30_000
  ) {}

  record(key: string, eventName: string, message: string, fields: LogFields = {}): void {
    const now = Date.now()
    const existing = this.entries.get(key)
    if (!existing) {
      this.entries.set(key, { count: 1, firstAt: now, lastSummaryAt: now })
      this.logger.event('warn', eventName, message, fields)
      return
    }
    existing.count += 1
    if (now - existing.lastSummaryAt < this.summaryWindowMs) return
    existing.lastSummaryAt = now
    this.logger.event('warn', `${eventName}.summary`, `${message} · ${existing.count} attempts`, {
      ...fields,
      attempts: existing.count,
      durationMs: now - existing.firstAt,
    })
  }

  recovered(key: string, eventName: string, message: string, fields: LogFields = {}): void {
    const existing = this.entries.get(key)
    if (!existing) return
    this.entries.delete(key)
    this.logger.status(eventName, `${message} · ${Date.now() - existing.firstAt}ms`, {
      ...fields,
      attempts: existing.count,
      durationMs: Date.now() - existing.firstAt,
    })
  }
}

export default log
