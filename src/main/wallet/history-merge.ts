/**
 * Pure reconciliation of locally-recorded wallet transactions with the
 * authoritative on-chain list. Kept out of WalletHistoryManager (which owns the
 * encrypted store) so the merge is unit tested without electron.
 */

import type { WalletTransaction } from '../../shared/types'

/** Dedup key: on-chain txs key by hash, local optimistic ones by id. */
export function historyKey(tx: WalletTransaction): string {
  return tx.hash ? `h:${tx.hash}` : `i:${tx.id}`
}

function txSignature(tx: WalletTransaction): string {
  return JSON.stringify(
    Object.entries(tx)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  )
}

export function sameHistory(a: WalletTransaction[], b: WalletTransaction[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (txSignature(a[i]) !== txSignature(b[i])) return false
  }
  return true
}

const MATCH_WINDOW_MS = 120_000

function contentMatch(a: WalletTransaction, b: WalletTransaction): boolean {
  return a.address === b.address && a.amount === b.amount && Math.abs(a.timestamp - b.timestamp) < MATCH_WINDOW_MS
}

function carryLocalMetadata(local: WalletTransaction, onChain: WalletTransaction): void {
  if (local.type === 'x402') {
    onChain.type = 'x402'
    onChain.x402Domain = local.x402Domain
    onChain.x402Url = local.x402Url
  }
  if (local.commentEncrypted) {
    onChain.commentEncrypted = true
    onChain.comment ??= local.comment
  }
}

/**
 * Merge on-chain txs onto the cached list.
 *
 * A local optimistic tx (key `i:<id>`) and its confirmed on-chain counterpart
 * (key `h:<hash>`) have DIFFERENT keys, so a key-only merge kept both (a
 * duplicate) and dropped the x402 label. Here, when an on-chain tx
 * content-matches a local `i:` tx, we carry the x402 metadata onto the on-chain
 * tx and drop the superseded local one — for every status, not just pending.
 */
export function mergeHistory(
  cached: WalletTransaction[],
  onChain: WalletTransaction[],
  cacheLimit: number
): WalletTransaction[] {
  const byKey = new Map<string, WalletTransaction>()
  for (const tx of cached) byKey.set(historyKey(tx), { ...tx })

  const supersededLocalKeys = new Set<string>()

  for (const on of onChain) {
    const onCopy: WalletTransaction = { ...on }
    const onKey = historyKey(onCopy)

    // Same tx re-fetched: carry an existing x402 label forward.
    const exact = byKey.get(onKey)
    if (exact) carryLocalMetadata(exact, onCopy)

    // Content-match a local optimistic (i:) tx of a different key.
    for (const [k, local] of byKey) {
      if (!k.startsWith('i:') || supersededLocalKeys.has(k) || k === onKey) continue
      if (!contentMatch(local, onCopy)) continue
      carryLocalMetadata(local, onCopy)
      supersededLocalKeys.add(k)
      break // one local per on-chain tx
    }

    byKey.set(onKey, onCopy)
  }

  for (const k of supersededLocalKeys) byKey.delete(k)

  return [...byKey.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, cacheLimit)
}
