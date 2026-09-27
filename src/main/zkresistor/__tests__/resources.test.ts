import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZkResistorResources } from '../resources'

vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
const names = ['hasher.wasm', 'insert.wasm', 'insert_final.zkey', 'withdraw.wasm', 'withdraw_final.zkey'] as const
const revision = 'recipient-binding-20260711'
const config = {
  protocolRevision: revision,
  baseUrl:
    'https://github.com/TONresistor/zk-resistor-contracts/releases/download/circuits-recipient-binding-20260711/',
  files: Object.fromEntries(
    names.map((name) => [
      name,
      { sha256: createHash('sha256').update(name).digest('hex'), byteLength: Buffer.byteLength(name) },
    ])
  ) as Record<(typeof names)[number], { sha256: string; byteLength: number }>,
}
let directory: string
const okFetch = () => vi.fn(async (input: Parameters<typeof fetch>[0]) => new Response(path.basename(String(input))))
async function ready(manager: ZkResistorResources) {
  manager.prepare()
  await vi.waitFor(() => expect(manager.status().status).toBe('ready'))
}
beforeEach(async () => {
  directory = await fs.mkdtemp('/private/tmp/zkr-resources-test-')
})
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('ZKR resource download and cache', () => {
  it('downloads only on request, deduplicates activation and verifies all five resources', async () => {
    const fetchFn = okFetch()
    const manager = new ZkResistorResources(directory, config, fetchFn)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(manager.status().status).toBe('idle')
    manager.prepare()
    manager.prepare()
    await ready(manager)
    expect(fetchFn).toHaveBeenCalledTimes(5)
    expect(manager.status().receivedBytes).toBe(manager.status().totalBytes)
    for (const name of names) expect((await manager.load(name)).toString()).toBe(name)
    manager.prepare()
    expect(fetchFn).toHaveBeenCalledTimes(5)
  })

  it('cleans incomplete files from a stopped process without deleting older revisions', async () => {
    await fs.mkdir(path.join(directory, revision), { recursive: true })
    await fs.writeFile(path.join(directory, revision, '.hasher.wasm-stopped.part'), 'partial')
    await fs.mkdir(path.join(directory, 'previous-revision'))
    await fs.writeFile(path.join(directory, 'previous-revision', 'hasher.wasm'), 'retained')
    await ready(new ZkResistorResources(directory, config, okFetch()))
    expect(await fs.readdir(path.join(directory, revision))).toEqual(expect.arrayContaining([...names]))
    expect((await fs.readdir(path.join(directory, revision))).some((name) => name.endsWith('.part'))).toBe(false)
    expect(await fs.readFile(path.join(directory, 'previous-revision', 'hasher.wasm'), 'utf8')).toBe('retained')
  })

  it('verifies and reuses the cache after restarting without downloading', async () => {
    await ready(new ZkResistorResources(directory, config, okFetch()))
    const offline = vi.fn(async () => {
      throw new Error('offline')
    })
    const manager = new ZkResistorResources(directory, config, offline)
    await ready(manager)
    expect(offline).not.toHaveBeenCalled()
    expect((await manager.load('insert_final.zkey')).toString()).toBe('insert_final.zkey')
  })

  it.each(['truncated', 'oversized', 'corrupt', 'http-error', 'interrupted'])(
    'rejects %s downloads, cleans partial files and allows retry',
    async (failure) => {
      const fetchFn = okFetch().mockImplementationOnce(async () => {
        if (failure === 'http-error') return new Response('', { status: 503 })
        if (failure === 'interrupted')
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1]))
                controller.error(new Error('disconnected'))
              },
            })
          )
        return new Response(
          failure === 'truncated' ? 'hasher.was' : failure === 'oversized' ? 'hasher.wasm!' : 'Hasher.wasm'
        )
      })
      const manager = new ZkResistorResources(directory, config, fetchFn)
      manager.prepare()
      await vi.waitFor(() => expect(manager.status().status).toBe('error'))
      expect(await fs.readdir(path.join(directory, revision))).toEqual([])
      await expect(manager.load('hasher.wasm')).rejects.toThrow('not ready')
      await ready(manager)
      expect((await manager.load('hasher.wasm')).toString()).toBe('hasher.wasm')
    }
  )

  it('repairs a corrupt cached file while preserving valid files', async () => {
    const fetchFn = okFetch()
    const manager = new ZkResistorResources(directory, config, fetchFn)
    await ready(manager)
    await fs.writeFile(path.join(directory, revision, 'hasher.wasm'), 'corrupt')
    await expect(manager.load('hasher.wasm')).rejects.toThrow('integrity')
    expect(manager.status().status).toBe('error')
    fetchFn.mockClear()
    await ready(manager)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('rejects redirects outside trusted HTTPS release hosts', async () => {
    const fetchFn = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
    )
    const manager = new ZkResistorResources(directory, config, fetchFn)
    manager.prepare()
    await vi.waitFor(() => expect(manager.status().status).toBe('error'))
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('follows a GitHub asset redirect and still verifies the content', async () => {
    const fetchFn = okFetch().mockImplementationOnce(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/hasher.wasm' },
        })
    )
    const manager = new ZkResistorResources(directory, config, fetchFn)
    await ready(manager)
    expect(fetchFn).toHaveBeenCalledTimes(6)
  })
})
