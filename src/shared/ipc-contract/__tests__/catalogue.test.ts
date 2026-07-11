import { describe, expect, it } from 'vitest'
import { IPC_CONTRACTS, IPC_EVENT_CONTRACTS, IPC_REQUEST_CONTRACTS } from '../catalogue'
import { IPC_CHANNELS } from '../../ipc-channels'
import { MAIN_RENDERER_EVENT_CHANNELS } from '../channels'

describe('canonical IPC catalogue', () => {
  it('contains unique channels and correct directions', () => {
    const identities = IPC_CONTRACTS.map(({ channel, direction }) => `${direction}:${channel}`)
    expect(new Set(identities).size).toBe(identities.length)
    expect(IPC_REQUEST_CONTRACTS.every(({ direction }) => direction === 'request')).toBe(true)
    expect(IPC_EVENT_CONTRACTS.every(({ direction }) => direction === 'event')).toBe(true)
  })

  it('requires complete policy and redaction metadata for every migrated request', () => {
    for (const contract of IPC_REQUEST_CONTRACTS) {
      expect(contract.authorization).toBeTruthy()
      expect(contract.rateLimit.kind).toMatch(/^(none|fixed-window)$/)
      expect(contract.errors.length).toBeGreaterThan(0)
      expect(contract.redaction).toMatch(/^(public|sensitive|secret)$/)
    }
  })

  it('covers every public IPC channel constant with a canonical contract', () => {
    const covered = new Set(IPC_CONTRACTS.map(({ channel }) => channel))
    const missing = [...new Set(Object.values(IPC_CHANNELS))].filter((channel) => !covered.has(channel))
    expect(missing).toEqual([])
  })

  it('derives the preload allowlist from exactly the main-renderer event contracts', () => {
    const rendererEvents = IPC_EVENT_CONTRACTS.filter(({ recipient }) => recipient === 'main-renderer').map(
      ({ channel }) => channel
    )
    expect([...MAIN_RENDERER_EVENT_CHANNELS].sort()).toEqual(rendererEvents.sort())
  })
})
