import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AdnlConnectionResultSchema,
  WalletChainSnapshotSchema,
  DhtValueResultSchema,
  DnsResolveResultSchema,
  EmulateTransactionResultSchema,
  OverlayMessageEventSchema,
  SubscriptionResultSchema,
} from '../bridge-codecs'
import fixture from './fixtures/tonutils-bridge-v0.5.1.json'

interface HelperPin {
  name: string
  version: string
  commit: string
  patch?: string
}

describe('pinned tonutils-bridge compatibility fixture', () => {
  const manifest = JSON.parse(readFileSync(resolve('scripts/binary-versions.json'), 'utf8')) as {
    binaries: HelperPin[]
  }
  const pin = manifest.binaries.find((entry) => entry.name === fixture.helper)

  it('is tied to the exact helper source used by release builds', () => {
    expect(pin).toMatchObject({
      name: fixture.helper,
      version: fixture.version,
      commit: fixture.commit,
    })
    expect(pin?.patch).toBe(fixture.patch)
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(fixture.patch)))
        .digest('hex')
    ).toBe(fixture.patchSha256)
  })

  it('accepts pinned response and event shapes at the runtime codec boundary', () => {
    expect(WalletChainSnapshotSchema.parse(fixture.responses['wallet.getSnapshot'])).toMatchObject({
      seqno: 0,
      block_time: 2000000000,
    })
    expect(DnsResolveResultSchema.parse(fixture.responses['dns.resolve'])).toMatchObject({ wallet: '0:abc' })
    expect(AdnlConnectionResultSchema.parse(fixture.responses['adnl.connectByADNL'])).toEqual({ peer_id: 'peer' })
    expect(DhtValueResultSchema.parse(fixture.responses['dht.findValue'])).toEqual({
      data: 'dmFsdWU=',
      ttl: 2000000000,
    })
    expect(SubscriptionResultSchema.parse(fixture.responses.subscribe)).toEqual({ subscription_id: 'sub' })
    expect(EmulateTransactionResultSchema.parse(fixture.responses['lite.emulateTransaction'])).toMatchObject({
      accepted: true,
      total_fees: '42',
    })
    expect(OverlayMessageEventSchema.parse(fixture.events['overlay.message'])).toEqual({
      overlay_id: 'overlay',
      message: 'payload',
      trusted: true,
    })
  })
})
