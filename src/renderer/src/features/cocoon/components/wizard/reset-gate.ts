/**
 * Pure safety-gate decision for the "start setup over" escape hatch, kept out of
 * the component so the critical branch (never treat a funded or unverifiable
 * wallet as empty) can be unit-tested.
 */

// Below this the owner wallet is considered empty (dust / gas only).
export const DUST_NANO = 100_000_000n // 0.1 GRAM

export type ResetGate = 'empty' | 'funded' | 'unverified'

/**
 * Classify how risky deleting the Cocoon wallet is, from the owner-balance IPC
 * result. `unverified` (IPC error or non-numeric payload) is treated as risky
 * on purpose — we never make deletion easy when we can't confirm it's empty.
 */
export function classifyOwnerBalance(result: unknown): ResetGate {
  try {
    return BigInt(result as string) >= DUST_NANO ? 'funded' : 'empty'
  } catch {
    return 'unverified'
  }
}

export interface ResetDecision {
  /** UI phase to move to. */
  phase: 'confirmEmpty' | 'warnFunded'
  /** True when the balance couldn't be verified (shown as a softer warning). */
  verifyFailed: boolean
  /** Owner balance (nano string) to display, only when funded & numeric. */
  balanceNano: string | null
}

/** Map an owner-balance IPC result to the next reset-flow UI state. */
export function decideReset(result: unknown): ResetDecision {
  const gate = classifyOwnerBalance(result)
  if (gate === 'empty') {
    return { phase: 'confirmEmpty', verifyFailed: false, balanceNano: null }
  }
  return {
    phase: 'warnFunded',
    verifyFailed: gate === 'unverified',
    balanceNano: gate === 'funded' ? (result as string) : null,
  }
}
