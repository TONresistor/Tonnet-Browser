import type { ChatIdentityInfo } from '../../shared/types'
import type { WireEnvelope } from './envelope'
import { verifyEnvelope, fingerprint } from './envelope'
import { verifyProof, friendlyAddress, shortAddress } from './tonproof'

const NEG_TTL_S = 600
const MAX_VERDICTS = 4096

const proofVerdicts = new Map<string, { until: number; address: string | null; addressShort: string | null }>()

export type Classified = { drop: true; reason: string } | { drop: false; identity: ChatIdentityInfo }

function proofVerdict(e: WireEnvelope, nowSec: number): { address: string | null; addressShort: string | null } {
  const key = `${e.wkey}:${e.wsig}:${e.wts}:${e.wexp}:${e.key}`
  const cached = proofVerdicts.get(key)
  if (cached && cached.until > nowSec) return cached
  const res = verifyProof(e, nowSec)
  const verdict = res.ok
    ? { until: e.wexp as number, address: friendlyAddress(res.address), addressShort: shortAddress(res.address) }
    : { until: nowSec + NEG_TTL_S, address: null, addressShort: null }
  if (proofVerdicts.size >= MAX_VERDICTS) {
    const first = proofVerdicts.keys().next().value
    if (first !== undefined) proofVerdicts.delete(first)
  }
  proofVerdicts.set(key, verdict)
  return verdict
}

export function classify(e: WireEnvelope, localRoom: string, nowSec: number): Classified {
  const status = verifyEnvelope(e)
  if (status !== 'valid') return { drop: true, reason: status === 'invalid' ? 'bad signature' : 'unsigned' }

  if (!e.room || e.room !== localRoom)
    return { drop: true, reason: e.room ? `signed for room ${e.room}` : 'missing room' }

  const fp = fingerprint(e)

  if (e.wkey) {
    const verdict = proofVerdict(e, nowSec)
    if (verdict.address && verdict.addressShort) {
      return {
        drop: false,
        identity: {
          tier: 'wallet',
          name: verdict.addressShort,
          address: verdict.address,
          addressShort: verdict.addressShort,
          fingerprint: fp,
        },
      }
    }
  }

  return {
    drop: false,
    identity: {
      tier: 'device',
      name: fp ? `#${fp}` : 'anon',
      fingerprint: fp,
    },
  }
}
