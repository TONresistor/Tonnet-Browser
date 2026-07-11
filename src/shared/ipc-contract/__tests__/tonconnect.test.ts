import { describe, expect, it } from 'vitest'
import {
  tonConnectDisconnectSessionContract,
  tonConnectEventContract,
  tonConnectRequestContract,
  TonConnectRequestPayloadSchema,
} from '../tonconnect'

describe('TonConnect IPC contracts', () => {
  it('declares distinct tonsite and main-window origin policies', () => {
    expect(tonConnectRequestContract).toMatchObject({
      caller: 'tonsite',
      authorization: 'owning-tonsite-session',
      rateLimit: { kind: 'fixed-window', key: 'domain' },
    })
    expect(tonConnectDisconnectSessionContract).toMatchObject({
      caller: 'main-renderer',
      authorization: 'main-window',
    })
  })

  it('rejects malformed requests before the TonConnect workflow', () => {
    expect(() => TonConnectRequestPayloadSchema.parse({ method: 'send', message: { id: 1 } })).toThrow()
    expect(() => TonConnectRequestPayloadSchema.parse({ method: 'unknown' })).toThrow()
  })

  it('runtime-validates disconnect push events', () => {
    expect(tonConnectEventContract.payload.parse([{ event: 'disconnect', id: 1, payload: {} }])).toHaveLength(1)
    expect(() => tonConnectEventContract.payload.parse([{ event: 'disconnect', id: -1, payload: {} }])).toThrow()
  })
})
