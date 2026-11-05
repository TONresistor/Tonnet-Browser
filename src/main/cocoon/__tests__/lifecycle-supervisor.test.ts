import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  directory: vi.fn(),
  fetch: vi.fn(),
  loadWallet: vi.fn(),
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../../daemon-registry', () => ({
  trackDaemon: vi.fn(),
  untrackDaemon: vi.fn(),
  forceKillTree: vi.fn(),
}))
vi.mock('../../logging/native-log-router', () => ({
  nativeLogRouter: { createSession: () => ({ stdout() {}, stderr() {}, close() {} }) },
}))
vi.mock('../paths', () => ({
  getCocoonBinaryPath: () => 'test-runner',
  getTonConfigPath: () => 'test-config',
  getClientConfigTemplatePath: () => 'test-template',
}))
vi.mock('../platform', () => ({ checkCocoonAvailability: () => ({ available: true }) }))
vi.mock('../wallet', () => ({ loadCocoonWallet: mocks.loadWallet }))
vi.mock('fs/promises', () => ({
  mkdtemp: mocks.directory,
  chmod: async () => {},
  readFile: async () => '{}',
  writeFile: async () => {},
  copyFile: async () => {},
  rm: async () => {},
}))

import { CocoonManager } from '../manager'
import { startCocoonManager } from '../lifecycle'

function processMock() {
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      void Promise.resolve().then(() => child.emit('exit', 0))
      return true
    }),
  })
  return child
}

const readyStats = { proxy_connections: [{ is_ready: true }], proxies: [{ state: 0 }] }
const readyResponse = () => Response.json(readyStats)

function streamingResponse(signal: AbortSignal, honorAbort = true) {
  const bytes = new TextEncoder().encode(JSON.stringify(readyStats))
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      controller.enqueue(bytes.subarray(0, 1))
    },
  })
  const abort = vi.fn(() => {
    if (closed) return
    closed = true
    controller.error(signal.reason)
  })
  if (honorAbort) signal.addEventListener('abort', abort, { once: true })
  return {
    response: new Response(body),
    signal,
    abort,
    finish() {
      if (closed) return
      closed = true
      signal.removeEventListener('abort', abort)
      controller.enqueue(bytes.subarray(1))
      controller.close()
    },
  }
}

describe('Cocoon lifecycle with the real supervisor and process teardown', () => {
  let manager: CocoonManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.directory.mockImplementation(async () => `/tmp/cocoon-readiness-${crypto.randomUUID()}`)
    mocks.loadWallet.mockResolvedValue({ ownerAddress: 'test-owner', nodeSecretBase64: 'test-key' })
    mocks.spawn.mockImplementation(processMock)
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', mocks.fetch)
    manager = new CocoonManager()
  })

  afterEach(async () => {
    await manager.stop()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a real supervisor timeout and becomes ready on the second attempt', async () => {
    mocks.fetch.mockImplementation(async () =>
      mocks.spawn.mock.calls.length > 1 ? readyResponse() : new Response(null, { status: 503 })
    )
    const outcome = startCocoonManager(manager).then(
      () => ({ ready: true }),
      (error: unknown) => ({ error })
    )

    await vi.advanceTimersByTimeAsync(180_000)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('stopped')
    await vi.advanceTimersByTimeAsync(1499)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(await outcome).toEqual({ ready: true })
    expect(manager.getState().kind).toBe('ready')
  })

  it('rejects startup promptly after stop and ignores a late response after a newer start', async () => {
    let pendingResponse!: ReturnType<typeof streamingResponse>
    mocks.fetch.mockImplementation(async () => readyResponse())
    mocks.fetch.mockImplementationOnce(async (_url: unknown, { signal }: { signal: AbortSignal }) => {
      pendingResponse = streamingResponse(signal, false)
      return pendingResponse.response
    })
    let settled = false
    const outcome = startCocoonManager(manager).then(
      () => {
        settled = true
        return {}
      },
      (error: unknown) => {
        settled = true
        return { error }
      }
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    await manager.stop()
    await vi.advanceTimersByTimeAsync(0)
    const settledAfterStop = settled
    const restarting = startCocoonManager(manager)
    await vi.advanceTimersByTimeAsync(0)
    await restarting
    pendingResponse.finish()
    await vi.advanceTimersByTimeAsync(180_000)

    expect(settledAfterStop).toBe(true)
    expect(await outcome).toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('aborted') }),
    })
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(manager.getState().kind).toBe('ready')
  })

  it('cancels the retry backoff after an external stop', async () => {
    const outcome = startCocoonManager(manager).then(
      () => ({}),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(180_000)
    expect(manager.getState().kind).toBe('stopped')
    await manager.stop()
    await vi.advanceTimersByTimeAsync(1500)
    expect(await outcome).toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('cancelled') }),
    })
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('retries only once when both real readiness attempts time out', async () => {
    const outcome = startCocoonManager(manager).then(
      () => ({}),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(361_500)
    expect(await outcome).toMatchObject({
      error: expect.objectContaining({ message: 'Process readiness timed out after 180000ms' }),
    })
    await vi.advanceTimersByTimeAsync(181_500)
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(manager.getState().kind).toBe('stopped')
  })

  it('does not retry a process crash as a readiness timeout', async () => {
    const outcome = startCocoonManager(manager).then(
      () => ({}),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(0)
    const child = mocks.spawn.mock.results[0].value as ReturnType<typeof processMock>
    child.emit('exit', 17)
    child.emit('close', 17)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await outcome).toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('exited before ready') }),
    })
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('bounds stalled JSON bodies and retries the real readiness timeout', async () => {
    const pending: ReturnType<typeof streamingResponse>[] = []
    mocks.fetch.mockImplementation(async (_url: unknown, { signal }: { signal: AbortSignal }) => {
      if (mocks.spawn.mock.calls.length > 1) return readyResponse()
      const response = streamingResponse(signal)
      pending.push(response)
      return response.response
    })
    const outcome = startCocoonManager(manager).then(
      () => ({ ready: true }),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(3000)
    expect(pending[0].abort).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('starting')
    await vi.advanceTimersByTimeAsync(178_500)
    expect(await outcome).toEqual({ ready: true })
    expect(pending.every((response) => response.signal.aborted)).toBe(true)
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(manager.getState().kind).toBe('ready')
  })

  it('accepts a complete streamed body before its deadline and clears its timeout', async () => {
    let pending!: ReturnType<typeof streamingResponse>
    mocks.fetch.mockImplementationOnce(async (_url: unknown, { signal }: { signal: AbortSignal }) => {
      pending = streamingResponse(signal)
      return pending.response
    })
    const starting = startCocoonManager(manager)
    await vi.advanceTimersByTimeAsync(2999)
    expect(manager.getState().kind).toBe('starting')
    pending.finish()
    await vi.advanceTimersByTimeAsync(0)
    await starting
    await vi.advanceTimersByTimeAsync(181_500)
    expect(pending.abort).not.toHaveBeenCalled()
    expect(pending.signal.aborted).toBe(false)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('ready')
  })

  it.each(['headers', 'body'] as const)('aborts an in-flight %s read on stop without a later retry', async (phase) => {
    let requestSignal!: AbortSignal
    let pending: ReturnType<typeof streamingResponse> | undefined
    mocks.fetch.mockImplementationOnce((_url: unknown, { signal }: { signal: AbortSignal }) => {
      requestSignal = signal
      if (phase === 'body') {
        pending = streamingResponse(signal)
        return Promise.resolve(pending.response)
      }
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const outcome = startCocoonManager(manager).then(
      () => ({}),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(1000)
    await manager.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(await outcome).toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('aborted') }),
    })
    expect(requestSignal.aborted).toBe(true)
    if (pending) expect(pending.abort).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(181_500)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('stopped')
  })

  it('recovers from malformed JSON with another probe without restarting the process', async () => {
    mocks.fetch.mockImplementation(async () => readyResponse())
    mocks.fetch.mockResolvedValueOnce(new Response('{'))
    const starting = startCocoonManager(manager)
    await vi.advanceTimersByTimeAsync(3000)
    await starting
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('ready')
  })

  it('releases an incomplete HTTP error body and recovers with the next probe', async () => {
    let pending!: ReturnType<typeof streamingResponse>
    mocks.fetch.mockImplementation(async () => readyResponse())
    mocks.fetch.mockImplementationOnce(async (_url: unknown, { signal }: { signal: AbortSignal }) => {
      pending = streamingResponse(signal)
      return new Response(pending.response.body, { status: 503 })
    })
    const starting = startCocoonManager(manager)
    await vi.advanceTimersByTimeAsync(0)
    expect(pending.abort).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3000)
    await starting
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('ready')
  })

  it('keeps a single request deadline across headers and body', async () => {
    let deliverHeaders!: () => void
    let pending!: ReturnType<typeof streamingResponse>
    mocks.fetch.mockImplementation(async () => readyResponse())
    mocks.fetch.mockImplementationOnce(
      (_url: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise<Response>((resolve) => {
          deliverHeaders = () => {
            pending = streamingResponse(signal)
            resolve(pending.response)
          }
        })
    )
    const starting = startCocoonManager(manager)
    await vi.advanceTimersByTimeAsync(2000)
    deliverHeaders()
    await vi.advanceTimersByTimeAsync(999)
    expect(pending.abort).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pending.abort).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3000)
    await starting
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('ignores a valid body that completes after its request deadline', async () => {
    let pending!: ReturnType<typeof streamingResponse>
    mocks.fetch.mockImplementation(async () => readyResponse())
    mocks.fetch.mockImplementationOnce(async (_url: unknown, { signal }: { signal: AbortSignal }) => {
      pending = streamingResponse(signal, false)
      return pending.response
    })
    const starting = startCocoonManager(manager)
    await vi.advanceTimersByTimeAsync(3001)
    expect(pending.signal.aborted).toBe(true)
    pending.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.getState().kind).toBe('starting')
    await vi.advanceTimersByTimeAsync(3000)
    await starting
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(manager.getState().kind).toBe('ready')
  })
})
