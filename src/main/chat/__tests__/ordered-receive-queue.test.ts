import { describe, expect, it, vi } from 'vitest'
import { CHAT_RECEIVE_CONCURRENCY, CHAT_RECEIVE_MAX_PENDING, OrderedReceiveQueue } from '../ordered-receive-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('OrderedReceiveQueue', () => {
  it('runs concurrently but commits strictly in enqueue order', async () => {
    const work = Array.from({ length: 4 }, () => deferred<number>())
    const committed: number[] = []
    let active = 0
    let maxActive = 0
    const queue = new OrderedReceiveQueue<number, number>({
      maxPending: 8,
      concurrency: 2,
      process: async (index) => {
        active++
        maxActive = Math.max(maxActive, active)
        const value = await work[index].promise
        active--
        return value
      },
      commit: (value) => {
        committed.push(value)
      },
    })

    for (let index = 0; index < 4; index++) expect(queue.enqueue(index)).toBe(true)
    await vi.waitFor(() => expect(active).toBe(2))

    work[1].resolve(1)
    await Promise.resolve()
    expect(committed).toEqual([])
    work[0].resolve(0)
    await vi.waitFor(() => expect(committed).toEqual([0, 1]))

    work[3].resolve(3)
    work[2].resolve(2)
    await vi.waitFor(() => expect(committed).toEqual([0, 1, 2, 3]))
    expect(maxActive).toBe(2)
    expect(queue.pendingCount).toBe(0)
  })

  it('bounds all retained work and reports one saturation episode', async () => {
    const blockers = Array.from({ length: CHAT_RECEIVE_CONCURRENCY }, () => deferred<number>())
    const onOverflow = vi.fn()
    const onRecovered = vi.fn()
    const queue = new OrderedReceiveQueue<number, number>({
      maxPending: CHAT_RECEIVE_MAX_PENDING,
      concurrency: CHAT_RECEIVE_CONCURRENCY,
      process: (index) => blockers[index]?.promise ?? Promise.resolve(index),
      commit: () => {},
      onOverflow,
      onRecovered,
    })

    for (let index = 0; index < 200; index++) expect(queue.enqueue(index)).toBe(true)
    for (let index = 200; index < CHAT_RECEIVE_MAX_PENDING; index++) expect(queue.enqueue(index)).toBe(true)
    expect(queue.enqueue(CHAT_RECEIVE_MAX_PENDING)).toBe(false)
    expect(queue.enqueue(CHAT_RECEIVE_MAX_PENDING + 1)).toBe(false)
    expect(onOverflow).toHaveBeenCalledOnce()
    expect(queue.pendingCount).toBe(CHAT_RECEIVE_MAX_PENDING)

    for (let index = 0; index < blockers.length; index++) blockers[index].resolve(index)
    await vi.waitFor(() => expect(queue.pendingCount).toBeLessThan(CHAT_RECEIVE_MAX_PENDING / 2))
    expect(onRecovered).toHaveBeenCalledWith(2)
  })

  it('advances past worker failures and ignores late results after close', async () => {
    const late = deferred<number>()
    const committed: number[] = []
    const errors: unknown[] = []
    const queue = new OrderedReceiveQueue<number, number>({
      maxPending: 4,
      concurrency: 2,
      process: async (value) => {
        if (value === 0) throw new Error('invalid frame')
        if (value === 2) return late.promise
        return value
      },
      commit: (value) => {
        committed.push(value)
      },
      onError: (error) => errors.push(error),
    })

    queue.enqueue(0)
    queue.enqueue(1)
    await vi.waitFor(() => expect(committed).toEqual([1]))
    expect(errors).toHaveLength(1)

    queue.enqueue(2)
    queue.close()
    late.resolve(2)
    await Promise.resolve()
    expect(committed).toEqual([1])
    expect(queue.pendingCount).toBe(0)
  })
})
