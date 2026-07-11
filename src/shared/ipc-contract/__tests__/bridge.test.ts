import { describe, expect, it } from 'vitest'
import { bridgeRestartContract, bridgeSendContract, BridgeScopeSchema } from '../bridge'

describe('bridge IPC contracts', () => {
  it('separates tonsite and main-renderer policies', () => {
    expect(bridgeSendContract).toMatchObject({ caller: 'tonsite', authorization: 'owning-tonsite-session' })
    expect(bridgeRestartContract).toMatchObject({ caller: 'main-renderer', authorization: 'main-window' })
  })
  it('accepts only bounded JSON objects and known permission scopes', () => {
    expect(bridgeSendContract.input.parse(['{"jsonrpc":"2.0"}'])).toHaveLength(1)
    expect(() => bridgeSendContract.input.parse(['not-json'])).toThrow()
    expect(() => bridgeSendContract.input.parse(['"string"'])).toThrow()
    expect(BridgeScopeSchema.parse('write')).toBe('write')
    expect(() => BridgeScopeSchema.parse('admin')).toThrow()
  })
})
