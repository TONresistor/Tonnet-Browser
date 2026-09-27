// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resource: vi.fn(async () => ({ base64: 'AA==' })),
  createPoseidon2: vi.fn(async () => async () => 0n),
}))

vi.mock('@tonresistor/zkresistor-sdk', () => ({ createPoseidon2: mocks.createPoseidon2 }))

vi.mock('../client', () => ({
  zkResistorClient: { resource: mocks.resource },
}))

interface WorkerRequest {
  id: string
  wasm?: Uint8Array
  zkey?: Uint8Array
}

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  readonly messages: WorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: WorkerRequest): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(data: Record<string, unknown>): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  crash(): void {
    this.onerror?.(new Event('error'))
  }
}

beforeEach(() => {
  FakeWorker.instances = []
  mocks.resource.mockReset().mockResolvedValue({ base64: 'AA==' })
  mocks.createPoseidon2.mockReset().mockResolvedValue(async () => 0n)
  vi.resetModules()
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ZKResistor Poseidon initialization', () => {
  it('retries a failed resource read while sharing pending and successful initialization', async () => {
    mocks.resource.mockRejectedValueOnce(new Error('resource unavailable'))
    const { poseidon2 } = await import('../runtime/artifacts')
    const first = poseidon2()
    expect(poseidon2()).toBe(first)
    await expect(first).rejects.toThrow('resource unavailable')
    expect(mocks.createPoseidon2).not.toHaveBeenCalled()

    const hasher = await poseidon2()
    await expect(poseidon2()).resolves.toBe(hasher)
    expect(mocks.resource).toHaveBeenCalledTimes(2)
    expect(mocks.createPoseidon2).toHaveBeenCalledOnce()
  })

  it('retries failed WASM initialization without downloading the resource again', async () => {
    mocks.createPoseidon2.mockRejectedValueOnce(new Error('initialization failed'))
    const { poseidon2 } = await import('../runtime/artifacts')
    await expect(poseidon2()).rejects.toThrow('initialization failed')

    const hasher = await poseidon2()
    await expect(poseidon2()).resolves.toBe(hasher)
    expect(mocks.resource).toHaveBeenCalledOnce()
    expect(mocks.createPoseidon2).toHaveBeenCalledTimes(2)
  })
})

describe('ZKResistor proof worker', () => {
  it('recreates the worker after circuit initialization fails', async () => {
    const { insertProver } = await import('../runtime/artifacts')
    const firstProof = insertProver({})
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const firstWorker = FakeWorker.instances[0]
    const firstRequest = firstWorker.messages[0]
    const firstFailure = expect(firstProof).rejects.toThrow('initialization failed')

    firstWorker.reply({ id: firstRequest.id, ok: false, initialized: false, error: 'initialization failed' })

    await firstFailure
    expect(firstWorker.terminated).toBe(true)

    const retry = insertProver({})
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    const retryWorker = FakeWorker.instances[1]
    const retryRequest = retryWorker.messages[0]
    expect(retryRequest.wasm).toBeInstanceOf(Uint8Array)
    expect(retryRequest.zkey).toBeInstanceOf(Uint8Array)
    retryWorker.reply({ id: retryRequest.id, ok: true, initialized: true, proof: {}, publicSignals: [] })

    await expect(retry).resolves.toEqual({ proof: {}, publicSignals: [] })
  })

  it('recreates the worker after it crashes', async () => {
    const { withdrawProver } = await import('../runtime/artifacts')
    const firstProof = withdrawProver({})
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const firstWorker = FakeWorker.instances[0]
    const firstFailure = expect(firstProof).rejects.toThrow('withdraw proof worker failed')

    firstWorker.crash()

    await firstFailure
    expect(firstWorker.terminated).toBe(true)

    const retry = withdrawProver({})
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    const retryRequest = FakeWorker.instances[1].messages[0]
    expect(retryRequest.wasm).toBeInstanceOf(Uint8Array)
    expect(retryRequest.zkey).toBeInstanceOf(Uint8Array)
    FakeWorker.instances[1].reply({
      id: retryRequest.id,
      ok: true,
      initialized: true,
      proof: {},
      publicSignals: [],
    })

    await expect(retry).resolves.toEqual({ proof: {}, publicSignals: [] })
  })
})
