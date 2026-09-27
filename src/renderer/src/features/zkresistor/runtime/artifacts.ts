import { createPoseidon2, type Groth16Proof, type Poseidon2, type Prover } from '@tonresistor/zkresistor-sdk'
import { zkResistorClient } from '../client'

interface WorkerReply {
  id: string
  ok: boolean
  initialized: boolean
  proof?: Groth16Proof
  publicSignals?: string[]
  error?: string
}

interface PendingProof {
  resolve: (value: { proof: Groth16Proof; publicSignals: string[] }) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const circuitCache = new Map<string, Promise<Uint8Array>>()
let poseidonPromise: Promise<Poseidon2> | null = null
let insertWorker: ProofWorkerClient | null = null
let withdrawWorker: ProofWorkerClient | null = null

export function poseidon2(): Promise<Poseidon2> {
  poseidonPromise ??= loadCircuit('hasher.wasm')
    .then(createPoseidon2)
    .catch((error) => {
      poseidonPromise = null
      throw error
    })
  return poseidonPromise
}

export const insertProver: Prover = (witness) => {
  insertWorker ??= new ProofWorkerClient('insert')
  return insertWorker.prove(witness)
}

export const withdrawProver: Prover = (witness) => {
  withdrawWorker ??= new ProofWorkerClient('withdraw')
  return withdrawWorker.prove(witness)
}

class ProofWorkerClient {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingProof>()
  private initialized = false

  constructor(private readonly kind: 'insert' | 'withdraw') {}

  prove: Prover = async (witness) => {
    const [wasm, zkey] = await Promise.all([loadCircuit(`${this.kind}.wasm`), loadCircuit(`${this.kind}_final.zkey`)])
    return new Promise((resolve, reject) => {
      const worker = this.getWorker()
      const id = crypto.randomUUID()
      const timeout = setTimeout(() => {
        this.resetWorker(worker, new Error(`${this.kind} proof timed out`))
      }, 10 * 60_000)
      this.pending.set(id, { resolve, reject, timeout })
      try {
        worker.postMessage({
          id,
          kind: this.kind,
          witness,
          ...(this.initialized ? {} : { wasm, zkey }),
        })
      } catch (error) {
        this.resetWorker(worker, toError(error, `${this.kind} proof worker failed`))
      }
    })
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./proof.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(event.data.id)
      this.initialized = event.data.initialized
      if (!event.data.ok || !event.data.proof || !event.data.publicSignals) {
        const error = new Error(event.data.error ?? `${this.kind} proof failed`)
        pending.reject(error)
        if (!event.data.initialized) this.resetWorker(worker, error)
        return
      }
      pending.resolve({ proof: event.data.proof, publicSignals: event.data.publicSignals })
    }
    worker.onerror = () => this.resetWorker(worker, new Error(`${this.kind} proof worker failed`))
    worker.onmessageerror = () => this.resetWorker(worker, new Error(`${this.kind} proof worker returned invalid data`))
    this.worker = worker
    return worker
  }

  private resetWorker(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    worker.terminate()
    this.worker = null
    this.initialized = false
    this.rejectAll(error)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

function loadCircuit(
  name: 'hasher.wasm' | 'insert.wasm' | 'insert_final.zkey' | 'withdraw.wasm' | 'withdraw_final.zkey'
) {
  let pending = circuitCache.get(name)
  if (!pending) {
    pending = zkResistorClient
      .resource({ kind: 'circuit', name })
      .then(({ base64 }) => decodeBase64(base64))
      .catch((error) => {
        circuitCache.delete(name)
        throw error
      })
    circuitCache.set(name, pending)
  }
  return pending
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
