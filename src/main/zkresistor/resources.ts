import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import manifest from '../../../resources/zkresistor/manifest.json'
import type { ZkResistorResource, ZkResistorResourceStatus } from '../../shared/ipc-contract/zkresistor'

type CircuitName = ZkResistorResource['name']
interface ResourceManifest {
  protocolRevision: string
  baseUrl: string
  files: Record<CircuitName, { sha256: string; byteLength: number }>
}
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

export class ZkResistorResources {
  private pending: Promise<void> | null = null
  private state: ZkResistorResourceStatus
  private readonly directory: string

  constructor(
    cacheRoot: string,
    private readonly config: ResourceManifest = manifest,
    private readonly fetchFn: typeof fetch = globalThis.fetch
  ) {
    this.directory = path.join(cacheRoot, config.protocolRevision)
    this.state = {
      status: 'idle',
      receivedBytes: 0,
      totalBytes: Object.values(config.files).reduce((sum, file) => sum + file.byteLength, 0),
      error: null,
    }
  }

  status(): ZkResistorResourceStatus {
    return { ...this.state }
  }

  prepare(): ZkResistorResourceStatus {
    if (!this.pending && this.state.status !== 'ready') {
      this.state = { ...this.state, status: 'downloading', receivedBytes: 0, error: null }
      this.pending = this.install()
        .then(() => {
          this.state = { ...this.state, status: 'ready', receivedBytes: this.state.totalBytes }
        })
        .catch(() => {
          this.state = {
            ...this.state,
            status: 'error',
            error: 'Unable to download and verify ZKR resources. Retry the download.',
          }
        })
        .finally(() => {
          this.pending = null
        })
    }
    return this.status()
  }

  async load(name: CircuitName): Promise<Buffer> {
    if (this.state.status !== 'ready') throw new Error('ZKR resources are not ready')
    try {
      const bytes = await this.readVerified(name)
      if (!bytes) throw new Error('ZKR resource failed integrity verification')
      return bytes
    } catch (error) {
      this.state = { ...this.state, status: 'error', error: 'ZKR resources need to be downloaded again.' }
      throw error
    }
  }

  private async readVerified(name: CircuitName): Promise<Buffer | null> {
    const expected = this.config.files[name]
    if (!expected) throw new Error('Unknown ZKR resource')
    try {
      const filePath = path.join(this.directory, name)
      if ((await fs.stat(filePath)).size !== expected.byteLength) return null
      const bytes = await fs.readFile(filePath)
      return bytes.byteLength === expected.byteLength &&
        createHash('sha256').update(bytes).digest('hex') === expected.sha256
        ? bytes
        : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async install(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    // Discard incomplete files left by a previous interrupted application process.
    for (const file of await fs.readdir(this.directory)) {
      if (file.endsWith('.part') && Object.keys(this.config.files).some((name) => file.startsWith(`.${name}-`))) {
        await fs.unlink(path.join(this.directory, file))
      }
    }
    for (const name of Object.keys(this.config.files) as CircuitName[]) {
      const cached = await this.readVerified(name)
      if (cached) {
        this.state.receivedBytes += cached.byteLength
        continue
      }
      await this.download(name)
    }
  }

  private async download(name: CircuitName): Promise<void> {
    const expected = this.config.files[name]
    const signal = AbortSignal.timeout(120_000)
    let url = new URL(name, this.config.baseUrl)
    let response: Response | undefined
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443') ||
        !DOWNLOAD_HOSTS.has(url.hostname)
      ) {
        throw new Error('Untrusted ZKR resource URL')
      }
      response = await this.fetchFn(url, { signal, redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirects === 5) throw new Error('Invalid ZKR resource redirect')
      url = new URL(location, url)
    }
    if (!response?.ok || !response.body) throw new Error('ZKR resource download failed')
    const temporaryPath = path.join(this.directory, `.${name}-${randomUUID()}.part`)
    const handle = await fs.open(temporaryPath, 'wx', 0o600)
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > expected.byteLength) throw new Error('ZKR resource exceeds expected size')
        hash.update(chunk.value)
        await handle.writeFile(chunk.value)
        this.state.receivedBytes += chunk.value.byteLength
      }
      if (size !== expected.byteLength || hash.digest('hex') !== expected.sha256)
        throw new Error('ZKR resource failed integrity verification')
      await handle.sync()
      await handle.close()
      await fs.rename(temporaryPath, path.join(this.directory, name))
    } finally {
      await reader.cancel().catch(() => undefined)
      await handle.close().catch(() => undefined)
      await fs.unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
}

let resources: ZkResistorResources | undefined
export function getZkResistorResources(): ZkResistorResources {
  resources ??= new ZkResistorResources(path.join(app.getPath('userData'), 'zkresistor', 'circuits'))
  return resources
}
export function loadZkResistorResource(name: CircuitName): Promise<Buffer> {
  return getZkResistorResources().load(name)
}
