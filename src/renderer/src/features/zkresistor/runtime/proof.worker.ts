import './buffer-polyfill'
import { createSnarkjsProver, type Groth16Proof } from '@tonresistor/zkresistor-sdk'

interface ProofRequest {
  id: string
  kind: 'insert' | 'withdraw'
  witness: Record<string, unknown>
  wasm?: Uint8Array
  zkey?: Uint8Array
}

interface ProofResult {
  proof: Groth16Proof
  publicSignals: string[]
}

const provers = new Map<ProofRequest['kind'], ReturnType<typeof createSnarkjsProver>>()

self.onmessage = async (event: MessageEvent<ProofRequest>) => {
  const request = event.data
  try {
    let prover = provers.get(request.kind)
    if (!prover) {
      if (!request.wasm || !request.zkey) throw new Error('Proof worker is missing circuit artifacts')
      prover = createSnarkjsProver({ wasm: request.wasm, zkey: request.zkey })
      provers.set(request.kind, prover)
    }
    const result: ProofResult = await prover(request.witness)
    self.postMessage({ id: request.id, ok: true, initialized: true, ...result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      initialized: provers.has(request.kind),
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
