/**
 * Unit tests for the PollingDriver single-flight guard (TOCTOU fix, #14).
 *
 * The guard must ensure tick() never runs twice concurrently regardless of the
 * entry path (timer, triggerTick, user-initiated), and must coalesce a run
 * requested mid-flight into exactly one trailing tick.
 */

import { describe, it, expect } from 'vitest'

import { PollingDriver } from '../polling-driver'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** Concrete driver exposing guardedRun and a controllable tick. */
class TestDriver extends PollingDriver {
  ticks = 0
  gate = deferred()
  surfaced: boolean[] = []
  throwOnce = false

  constructor() {
    // 60s interval so the timer never fires during a test; we drive manually.
    super(60_000, { info() {}, warn() {}, error() {}, debug() {} } as never)
  }

  protected async tick(surfaceErrors = false): Promise<void> {
    this.ticks++
    this.surfaced.push(surfaceErrors)
    await this.gate.promise
    if (this.throwOnce) {
      this.throwOnce = false
      throw new Error('boom')
    }
  }

  run(surfaceErrors = false): Promise<void> {
    return this.guardedRun(surfaceErrors)
  }
}

describe('PollingDriver guardedRun', () => {
  it('runs tick() only once when invoked concurrently', async () => {
    const d = new TestDriver()

    const a = d.run()
    const b = d.run() // should be skipped: a is in flight
    const c = d.run() // skipped too

    expect(d.ticks).toBe(1)

    d.gate.resolve()
    await Promise.all([a, b, c])

    // The three overlapping calls coalesced into a single trailing rerun.
    // Let the trailing setImmediate-scheduled tick start, then release it.
    d.gate = deferred()
    await new Promise((r) => setImmediate(r))
    expect(d.ticks).toBe(2)
    d.gate.resolve()
    await new Promise((r) => setImmediate(r))
  })

  it('does not queue a rerun when no overlap occurs', async () => {
    const d = new TestDriver()

    d.gate.resolve() // tick resolves immediately
    await d.run()
    await new Promise((r) => setImmediate(r))

    expect(d.ticks).toBe(1)
  })

  it('propagates the surfaceErrors flag and rethrows for the leading call', async () => {
    const d = new TestDriver()
    d.throwOnce = true
    d.gate.resolve()

    await expect(d.run(true)).rejects.toThrow('boom')
    expect(d.surfaced).toEqual([true])
  })

  it('a run requested while busy is coalesced (surfaceErrors not carried to the trailing tick)', async () => {
    const d = new TestDriver()

    const leading = d.run(true) // in flight, surfaceErrors=true
    d.run(true) // skipped → queues one rerun

    d.gate.resolve()
    await leading

    d.gate = deferred()
    await new Promise((r) => setImmediate(r))
    // trailing rerun ran with surfaceErrors=false
    expect(d.surfaced).toEqual([true, false])
    d.gate.resolve()
    await new Promise((r) => setImmediate(r))
  })
})
