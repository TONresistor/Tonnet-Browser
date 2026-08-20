import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AdnlConnectionResultSchema,
  DhtValueResultSchema,
  DnsResolveResultSchema,
  EmulateTransactionResultSchema,
  OverlayMessageEventSchema,
  SubscriptionResultSchema,
} from '../bridge-codecs'
import fixture from './fixtures/tonutils-bridge-v0.4.0.json'

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
      patch: fixture.patch,
    })
  })

  it('keeps every browser capability method and parameter name byte-stable', () => {
    expect(fixture.requests).toEqual([
      { method: 'dns.resolve', params: { domain: 'site.ton' } },
      { method: 'adnl.connectByADNL', params: { adnl_id: 'anchor' } },
      { method: 'overlay.join', params: { overlay_id: 'overlay', peer_id: 'peer' } },
      { method: 'overlay.sendRaw', params: { overlay_id: 'overlay', data: 'payload' } },
      { method: 'adnl.ping', params: { peer_id: 'peer' } },
      { method: 'overlay.leave', params: { overlay_id: 'overlay' } },
      { method: 'adnl.disconnect', params: { peer_id: 'peer' } },
      { method: 'dht.findValue', params: { key_id: 'key', name: 'address', index: 0 } },
      { method: 'subscribe.unsubscribe', params: { subscription_id: 'sub' } },
      {
        method: 'lite.emulateTransaction',
        params: { address: '0:abc', boc: 'te6ccg==', ignore_chksig: true },
      },
    ])
  })

  it('accepts pinned response and event shapes at the runtime codec boundary', () => {
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
