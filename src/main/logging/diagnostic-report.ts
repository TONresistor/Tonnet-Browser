import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { redactNativeLogLine } from '../../shared/logger'

const MAX_TAIL_BYTES = 256 * 1024
const MAX_EVENTS_PER_SOURCE = 100
const IDENTITY_FIELD = /(?:address|bagId|domain|host|node|path|paymentId|peerId|remote|room|url|wallet)$/i

async function readRecentJsonLines(filePath: string): Promise<unknown[]> {
  let handle
  try {
    handle = await open(filePath, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, MAX_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    const completeText = size > length ? text.slice(Math.max(0, text.indexOf('\n') + 1)) : text
    return completeText
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown]
        } catch {
          return []
        }
      })
      .slice(-MAX_EVENTS_PER_SOURCE)
  } catch {
    return []
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function sanitizeForSupport(value: unknown, key = '', depth = 0): unknown {
  if (IDENTITY_FIELD.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactNativeLogLine(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= 6) return '[MaxDepth]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeForSupport(item, '', depth + 1))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([childKey, child]) => [childKey, sanitizeForSupport(child, childKey, depth + 1)])
  )
}

export interface DiagnosticReportMetadata {
  appVersion: string
  diagnosticLogging: { enabled: boolean; until: number | null }
}

/** Build a bounded, local-only report. The caller decides how it is shared. */
export async function buildDiagnosticReport(logsDir: string, metadata: DiagnosticReportMetadata): Promise<string> {
  const [applicationEvents, nativeEvents] = await Promise.all([
    readRecentJsonLines(join(logsDir, 'app.log')),
    readRecentJsonLines(join(logsDir, 'native.log')),
  ])
  return JSON.stringify(
    sanitizeForSupport({
      generatedAt: new Date().toISOString(),
      appVersion: metadata.appVersion,
      platform: process.platform,
      architecture: process.arch,
      diagnosticLogging: metadata.diagnosticLogging,
      applicationEvents,
      nativeEvents,
    }),
    null,
    2
  )
}
