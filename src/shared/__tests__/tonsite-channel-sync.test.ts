/**
 * resources/preload/tonsite.js is a plain (non-bundled) preload script injected
 * into tonsites, so it cannot import IPC_CHANNELS and must hardcode the channel
 * name. This guards against IPC_CHANNELS.WALLET_PAY_FOR_XHR drifting out of sync
 * with that literal (the constant carries a "keep in sync" comment for the same
 * reason).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { IPC_CHANNELS } from '../ipc-channels'

describe('tonsite.js IPC channel sync', () => {
  it('hardcodes the current WALLET_PAY_FOR_XHR channel value', () => {
    const src = readFileSync(resolve(process.cwd(), 'resources/preload/tonsite.js'), 'utf-8')
    expect(src).toContain(`'${IPC_CHANNELS.WALLET_PAY_FOR_XHR}'`)
  })

  it('hardcodes the current TON Connect channel values', () => {
    const src = readFileSync(resolve(process.cwd(), 'resources/preload/tonsite.js'), 'utf-8')
    expect(src).toContain(`'${IPC_CHANNELS.TONCONNECT_REQUEST}'`)
    expect(src).toContain(`'${IPC_CHANNELS.TONCONNECT_EVENT}'`)
    expect(src).toContain(`'${IPC_CHANNELS.TONCONNECT_AVAILABILITY}'`)
    expect(src).toContain('isEnabled: isTonconnectEnabled')
    expect(src).toContain('await window.tonnet.tonconnect.isEnabled()')
    expect(src).toContain('wallets.unshift(entry)')
    expect(src).toContain('JSON.stringify(wallets)')
    expect(src).not.toContain('JSON.stringify([entry])')
  })
})
