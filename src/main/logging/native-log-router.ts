import { chmod, mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { createLogger, redactNativeLogLine } from '../../shared/logger'

const log = createLogger('logging')
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_LINE_BYTES = 16 * 1024
const MAX_QUEUE_ENTRIES = 2_048
const FLUSH_BATCH_SIZE = 128
const LEVEL_PRIORITY: Record<NativeLogLevel, number> = { trace: 0, debug: 0, info: 1, warn: 2, error: 3 }

export type NativeLogStream = 'stdout' | 'stderr'
export type NativeLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface NativeLogLine {
  source: string
  runId: string
  pid?: number
  stream: NativeLogStream
  level: NativeLogLevel
  line: string
}

export interface NativeRawLogLine extends NativeLogLine {
  /** Internal parser input. Never persist or forward this value to a renderer. */
  line: string
}

interface QueuedLine {
  level: NativeLogLevel
  serialized: string
}

export class NativeLineFramer {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private discardingOversizeLine = false

  constructor(private readonly emit: (line: string) => void) {}

  push(data: Buffer): void {
    this.pending += this.decoder.write(data)
    this.drain(false)
  }

  end(): void {
    this.pending += this.decoder.end()
    this.drain(true)
  }

  private drain(flush: boolean): void {
    let newline = this.pending.search(/[\r\n]/)
    while (newline !== -1) {
      const line = this.pending.slice(0, newline)
      const width = this.pending[newline] === '\r' && this.pending[newline + 1] === '\n' ? 2 : 1
      this.pending = this.pending.slice(newline + width)
      if (this.discardingOversizeLine) this.discardingOversizeLine = false
      else this.emitBounded(line)
      newline = this.pending.search(/[\r\n]/)
    }
    if (this.discardingOversizeLine) {
      this.pending = ''
    } else if (Buffer.byteLength(this.pending, 'utf8') > MAX_LINE_BYTES) {
      const { prefix } = utf8Prefix(this.pending, MAX_LINE_BYTES)
      this.emit(`${prefix}…[truncated]`)
      this.pending = ''
      this.discardingOversizeLine = true
    }
    if (flush) {
      if (!this.discardingOversizeLine && this.pending) this.emitBounded(this.pending)
      this.pending = ''
      this.discardingOversizeLine = false
    }
  }

  private emitBounded(line: string): void {
    if (!line) return
    const buffer = Buffer.from(line, 'utf8')
    this.emit(buffer.length <= MAX_LINE_BYTES ? line : `${utf8Prefix(line, MAX_LINE_BYTES).prefix}…[truncated]`)
  }
}

function utf8Prefix(value: string, maxBytes: number): { prefix: string; consumedCharacters: number } {
  let bytes = 0
  let consumedCharacters = 0
  for (const character of value) {
    const width = Buffer.byteLength(character, 'utf8')
    if (bytes + width > maxBytes) break
    bytes += width
    consumedCharacters += character.length
  }
  return { prefix: value.slice(0, consumedCharacters), consumedCharacters }
}

class BoundedNativeLogWriter {
  private queue: QueuedLine[] = []
  private draining = false
  private dropped = 0
  private size = 0
  private initialized = false
  private lastFailureAt = 0
  private handle: FileHandle | null = null

  constructor(
    private readonly filePath: string,
    private readonly oldFilePath: string
  ) {}

  enqueue(entry: QueuedLine): void {
    if (this.queue.length >= MAX_QUEUE_ENTRIES) {
      const lowerPriorityIndex = this.queue.findIndex(
        (queued) => LEVEL_PRIORITY[queued.level] < LEVEL_PRIORITY[entry.level]
      )
      if (lowerPriorityIndex >= 0) this.queue.splice(lowerPriorityIndex, 1)
      else {
        this.dropped += 1
        return
      }
      this.dropped += 1
    }
    this.queue.push(entry)
    if (!this.draining) void this.drain()
  }

  async flush(): Promise<void> {
    while (this.draining || this.queue.length > 0) {
      if (!this.draining) void this.drain()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  async close(): Promise<void> {
    await this.flush()
    await this.closeHandle()
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 }).catch(() => undefined)
    await chmod(dirname(this.filePath), 0o700).catch(() => undefined)
    this.size = await stat(this.filePath).then(
      (value) => value.size,
      () => 0
    )
    this.initialized = true
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    if (this.size + incomingBytes <= MAX_FILE_SIZE) return
    await this.closeHandle()
    await rm(this.oldFilePath, { force: true }).catch(() => undefined)
    await rename(this.filePath, this.oldFilePath).catch(() => undefined)
    this.size = 0
  }

  private async getHandle(): Promise<FileHandle> {
    if (!this.handle) {
      this.handle = await open(this.filePath, 'a', 0o600)
      await this.handle.chmod(0o600).catch(() => undefined)
    }
    return this.handle
  }

  private async closeHandle(): Promise<void> {
    const handle = this.handle
    this.handle = null
    await handle?.close().catch(() => undefined)
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      await this.initialize()
      while (this.queue.length > 0 || this.dropped > 0) {
        const batch = this.queue.splice(0, FLUSH_BATCH_SIZE)
        if (this.dropped > 0) {
          batch.unshift({
            level: 'warn',
            serialized: JSON.stringify({
              ts: new Date().toISOString(),
              level: 'warn',
              source: 'logger',
              event: 'native.logs.dropped',
              count: this.dropped,
            }),
          })
          this.dropped = 0
        }
        const content = `${batch.map((entry) => entry.serialized).join('\n')}\n`
        const bytes = Buffer.byteLength(content)
        await this.rotateIfNeeded(bytes)
        const handle = await this.getHandle()
        await handle.appendFile(content, { encoding: 'utf8' })
        this.size += bytes
      }
      await chmod(this.filePath, 0o600).catch(() => undefined)
    } catch (error) {
      await this.closeHandle()
      this.dropped += this.queue.length
      this.queue = []
      const now = Date.now()
      if (now - this.lastFailureAt > 30_000) {
        this.lastFailureAt = now
        log.event('warn', 'logging.native.write_failed', 'native log write failed', { error })
      }
    } finally {
      this.draining = false
      if (this.queue.length > 0) void this.drain()
    }
  }
}

function nativeLevel(line: string): NativeLogLevel {
  const match = line.match(/(?:^|\s)(TRC|TRACE|DBG|DEBUG|INF|INFO|WRN|WARN|WARNING|ERR|ERROR|FATAL|SUCCESS)(?:\s|$)/i)
  const value = match?.[1]?.toLowerCase()
  if (value === 'trc' || value === 'trace') return 'trace'
  if (value === 'dbg' || value === 'debug') return 'debug'
  if (value === 'inf' || value === 'info' || value === 'success') return 'info'
  if (value === 'wrn' || value === 'warn' || value === 'warning') return 'warn'
  if (value === 'err' || value === 'error' || value === 'fatal') return 'error'
  return 'debug'
}

function normalizeSource(name: string): string {
  if (name === 'tonutils-proxy') return 'proxy'
  if (name === 'tonutils-bridge') return 'bridge'
  if (name === 'tonutils-storage') return 'storage'
  if (name === 'cocoon-runner') return 'cocoon'
  return name.replace(/[^a-z0-9_.-]/gi, '-').toLowerCase()
}

class NativeLogRouter {
  private writer: BoundedNativeLogWriter | null = null

  configure(logsDir: string): void {
    const previous = this.writer
    this.writer = new BoundedNativeLogWriter(join(logsDir, 'native.log'), join(logsDir, 'native.old.log'))
    void previous?.close()
  }

  createSession(
    processName: string,
    pid: number | undefined,
    onLine?: (entry: NativeLogLine) => void,
    onRawLine?: (entry: NativeRawLogLine) => void
  ): { stdout(data: Buffer): void; stderr(data: Buffer): void; close(): void } {
    const source = normalizeSource(processName)
    const runId = `${source}-${Date.now().toString(36)}`
    const consume = (stream: NativeLogStream, line: string): void => {
      const normalizedLine = stripVTControlCharacters(line)
      const level = nativeLevel(normalizedLine)
      onRawLine?.({ source, runId, pid, stream, level, line: normalizedLine })
      const safeLine = redactNativeLogLine(normalizedLine)
      const entry: NativeLogLine = { source, runId, pid, stream, level, line: safeLine }
      this.writer?.enqueue({
        level: entry.level,
        serialized: JSON.stringify({
          ts: new Date().toISOString(),
          level: entry.level,
          source,
          runId,
          ...(pid ? { pid } : {}),
          stream,
          message: safeLine,
        }),
      })
      onLine?.(entry)
    }
    const stdout = new NativeLineFramer((line) => consume('stdout', line))
    const stderr = new NativeLineFramer((line) => consume('stderr', line))
    return {
      stdout: (data) => stdout.push(data),
      stderr: (data) => stderr.push(data),
      close: () => {
        stdout.end()
        stderr.end()
      },
    }
  }

  flush(): Promise<void> {
    return this.writer?.flush() ?? Promise.resolve()
  }
}

export const nativeLogRouter = new NativeLogRouter()

export function configureNativeLogging(logsDir: string): void {
  nativeLogRouter.configure(logsDir)
}

export function flushNativeLogs(timeoutMs?: number): Promise<void> {
  const draining = nativeLogRouter.flush()
  if (timeoutMs === undefined) return draining
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs)
    timeout.unref?.()
  })
  return Promise.race([draining, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}
