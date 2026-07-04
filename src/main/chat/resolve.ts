import { Address } from '@ton/core'
import { isTonDomain } from '../../shared/utils/ton'
import type { DnsResolveResult } from '../../shared/types'

export type ResolveFn = (domain: string) => Promise<DnsResolveResult>

const SOFT_TTL_S = 600
const ERROR_TTL_S = 15
const MAX_ENTRIES = 4096

interface Verdict {
  until: number
  ok: boolean
}

const verdicts = new Map<string, Verdict>()
const inFlight = new Map<string, Promise<boolean>>()

function rawOf(addr: string | null): string | null {
  if (!addr) return null
  try {
    return Address.parse(addr).toRawString()
  } catch {
    return null
  }
}

export async function verifyDomainOwnership(
  domain: string,
  expectedAddress: string,
  resolve: ResolveFn,
  nowSec: number
): Promise<boolean> {
  const nick = domain.toLowerCase()
  if (!isTonDomain(nick)) return false
  const addressRaw = rawOf(expectedAddress)
  if (!addressRaw) return false
  const key = `${nick}|${addressRaw}`

  const cached = verdicts.get(key)
  if (cached && cached.until > nowSec) return cached.ok

  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    let ok = false
    let until = nowSec + SOFT_TTL_S
    try {
      const rec = await resolve(nick)
      if (rec.initialized && (!rec.expiring_at || rec.expiring_at > nowSec)) {
        const target = rawOf(rec.wallet) ?? rawOf(rec.owner)
        ok = target === addressRaw
      }
      if (rec.expiring_at && rec.expiring_at < until) until = rec.expiring_at
    } catch {
      ok = false
      until = nowSec + ERROR_TTL_S
    }
    if (verdicts.size >= MAX_ENTRIES) {
      const first = verdicts.keys().next().value
      if (first !== undefined) verdicts.delete(first)
    }
    verdicts.set(key, { until, ok })
    return ok
  })().finally(() => inFlight.delete(key))

  inFlight.set(key, promise)
  return promise
}

export async function checkOwnDomain(
  domain: string,
  ownAddress: string,
  resolve: ResolveFn,
  nowSec: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const nick = domain.trim().toLowerCase()
  if (!isTonDomain(nick)) return { ok: false, reason: 'Invalid .ton domain' }
  const addressRaw = rawOf(ownAddress)
  if (!addressRaw) return { ok: false, reason: 'No wallet address' }
  let rec: DnsResolveResult
  try {
    rec = await resolve(nick)
  } catch {
    return { ok: false, reason: 'Domain not found' }
  }
  if (!rec.initialized) return { ok: false, reason: 'Domain not registered' }
  if (rec.expiring_at && rec.expiring_at < nowSec) return { ok: false, reason: 'Domain expired' }
  const target = rawOf(rec.wallet) ?? rawOf(rec.owner)
  if (target !== addressRaw) return { ok: false, reason: 'This domain is not held by your wallet' }
  return { ok: true }
}
