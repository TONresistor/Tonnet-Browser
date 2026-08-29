import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TonBridgeRuntime } from '../runtime'
import type { WsBridgeClient } from '../ws-bridge-client'

interface FakeClient {
  port: number
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function createHarness() {
  const instances: FakeClient[] = []
  const failures = new Map<number, number>()
  const runtime = new TonBridgeRuntime((port) => {
    const client: FakeClient = {
      port,
      connect: vi.fn(async () => {
        const remaining = failures.get(port) ?? 0
        if (remaining > 0) {
          failures.set(port, remaining - 1)
          throw new Error('bridge unavailable')
        }
      }),
      disconnect: vi.fn(),
    }
    instances.push(client)
    return client as unknown as WsBridgeClient
  })
  return { failures, instances, runtime }
}

describe('TonBridgeRuntime', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it('connects once and exposes the shared client', async () => {
    const { instances, runtime } = createHarness()

    await runtime.applyPort(8081)

    expect(instances).toHaveLength(1)
    expect(instances[0].connect).toHaveBeenCalledOnce()
    expect(runtime.getBridge()).toBe(instances[0])
  })

  it('connects the replacement before disconnecting the current client', async () => {
    const { instances, runtime } = createHarness()
    await runtime.applyPort(8081)
    const previous = instances[0]

    await runtime.applyPort(9091)

    const replacement = instances[1]
    expect(replacement.connect).toHaveBeenCalledOnce()
    expect(previous.disconnect).toHaveBeenCalledOnce()
    expect(replacement.connect.mock.invocationCallOrder[0]).toBeLessThan(
      previous.disconnect.mock.invocationCallOrder[0]
    )
    expect(runtime.getBridge()).toBe(replacement)
  })

  it('keeps the current client when the replacement never becomes ready', async () => {
    vi.useFakeTimers()
    const { failures, instances, runtime } = createHarness()
    await runtime.applyPort(8081)
    const previous = instances[0]
    failures.set(9091, 20)

    const applying = runtime.applyPort(9091)
    const rejection = expect(applying).rejects.toThrow('bridge unavailable')
    await vi.advanceTimersByTimeAsync(2_000)
    await rejection

    const replacement = instances[1]
    expect(replacement.connect).toHaveBeenCalledTimes(20)
    expect(replacement.disconnect).toHaveBeenCalledOnce()
    expect(previous.disconnect).not.toHaveBeenCalled()
    expect(runtime.getBridge()).toBe(previous)
  })

  it('coalesces concurrent requests for the same port', async () => {
    const { instances, runtime } = createHarness()

    await Promise.all([runtime.applyPort(8081), runtime.applyPort(8081), runtime.applyPort(8081)])

    expect(instances).toHaveLength(1)
    expect(instances[0].connect).toHaveBeenCalledOnce()
  })

  it('notifies consumers after replacement and during destruction', async () => {
    const { instances, runtime } = createHarness()
    const listener = vi.fn()
    runtime.onBridgeChanged(listener)

    await runtime.applyPort(8081)
    await runtime.applyPort(9091)
    await runtime.destroy()

    expect(listener).toHaveBeenNthCalledWith(1, instances[0])
    expect(listener).toHaveBeenNthCalledWith(2, instances[1])
    expect(listener).toHaveBeenNthCalledWith(3, null)
    expect(instances[1].disconnect).toHaveBeenCalledOnce()
    expect(runtime.getBridge()).toBeNull()
  })
})
