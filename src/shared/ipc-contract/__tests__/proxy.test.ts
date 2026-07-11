import { describe, expect, it } from 'vitest'
import { proxyProgressEventContract, ProxyStatusSchema, proxyStatusEventContract } from '../proxy'

describe('proxy IPC contracts', () => {
  it('validates complete and degraded status events', () => {
    expect(proxyStatusEventContract.payload.parse([{ status: 'connected', connected: true, port: 8080 }])).toHaveLength(
      1
    )
    expect(ProxyStatusSchema.parse({ status: 'error', error: 'failed' })).toMatchObject({ status: 'error' })
    expect(() => ProxyStatusSchema.parse({ status: 'unknown' })).toThrow()
  })
  it('bounds progress data', () => {
    expect(proxyProgressEventContract.payload.parse([{ step: 1, message: 'Starting' }])).toHaveLength(1)
    expect(() => proxyProgressEventContract.payload.parse([{ step: -1, message: '' }])).toThrow()
  })
})
