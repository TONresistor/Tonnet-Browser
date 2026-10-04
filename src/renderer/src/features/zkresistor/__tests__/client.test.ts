// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcClientError } from '@shared/ipc-failure'
import { zkResistorClient } from '../client'

afterEach(() => vi.unstubAllGlobals())

function reply(value: unknown) {
  const catalog = vi.fn(async () => value)
  vi.stubGlobal('electron', { zkresistor: { catalog } })
  return catalog
}

describe('ZKR catalog IPC result', () => {
  it.each([true, false])('preserves retryable=%s when reconstructing an error in the renderer', async (retryable) => {
    reply({ ok: false, error: { code: 'ZKRESISTOR_CATALOG_FAILED', message: 'Catalog unavailable', retryable } })
    await expect(zkResistorClient.catalog()).rejects.toBeInstanceOf(IpcClientError)
    await expect(zkResistorClient.catalog()).rejects.toMatchObject({
      code: 'ZKRESISTOR_CATALOG_FAILED',
      message: 'Catalog unavailable',
      retryable,
    })
  })

  it('returns the successful catalog unchanged', async () => {
    const catalog = { factoryAddress: 'factory', sdkVersion: '2.0.1', loadedAt: '2026-10-05T00:00:00.000Z', pools: [] }
    reply(catalog)
    await expect(zkResistorClient.catalog()).resolves.toBe(catalog)
  })
})
