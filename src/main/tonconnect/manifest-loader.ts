import { z } from 'zod'
import type { AppManifest } from './types'

const MANIFEST_TIMEOUT_MS = 15_000
const MANIFEST_MAX_BYTES = 16_384
const ICON_TIMEOUT_MS = 8_000
const ICON_MAX_BYTES = 200_000

const AppManifestSchema = z
  .object({
    url: z.string().url(),
    name: z.string().min(1),
    iconUrl: z.string().url(),
    termsOfUseUrl: z.string().url().optional(),
    privacyPolicyUrl: z.string().url().optional(),
  })
  .passthrough()

export interface TonConnectFetchSession {
  fetch(url: string, init: { signal: AbortSignal }): Promise<Response>
}

export class TonConnectManifestLoader {
  async load(session: TonConnectFetchSession, url: string): Promise<AppManifest> {
    requireHttpUrl(url, 'Manifest URL')
    const response = await fetchWithTimeout(session, url, MANIFEST_TIMEOUT_MS)
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
    if (response.url) requireHttpUrl(response.url, 'Manifest redirect')
    const body = await readBounded(response, MANIFEST_MAX_BYTES)
    let parsed: unknown
    try {
      parsed = JSON.parse(body.toString('utf8'))
    } catch {
      throw new Error('Invalid manifest JSON')
    }
    return AppManifestSchema.parse(parsed) as AppManifest
  }

  async loadIcon(session: TonConnectFetchSession, url?: string): Promise<string | null> {
    if (!url || !isHttpUrl(url)) return null
    try {
      const response = await fetchWithTimeout(session, url, ICON_TIMEOUT_MS)
      if (!response.ok) return null
      if (response.url && !isHttpUrl(response.url)) return null
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.startsWith('image/') || contentType.toLowerCase().includes('svg')) return null
      const body = await readBounded(response, ICON_MAX_BYTES)
      if (body.length === 0) return null
      return `data:${contentType};base64,${body.toString('base64')}`
    } catch {
      return null
    }
  }
}

async function fetchWithTimeout(session: TonConnectFetchSession, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await session.fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function requireHttpUrl(url: string, label: string): void {
  if (!isHttpUrl(url)) throw new Error(`${label} must be http(s)`)
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const length = response.headers.get('content-length')
  if (length && Number(length) > maxBytes) throw new Error('Response too large')
  const reader = response.body?.getReader?.()
  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > maxBytes) throw new Error('Response too large')
    return body
  }

  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('Response too large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks)
}
