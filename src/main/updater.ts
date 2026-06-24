/**
 * Update checker.
 * Fetches a version manifest from the project's HTTPS endpoint and, if a newer
 * release is available, opens the download page in the user's external browser.
 *
 * Uses node:https directly so the request is not subject to Chromium's
 * `host-resolver-rules` switch, which blocks all clearnet DNS for the main
 * browser session. The update check is the one explicit exception.
 */

import https from 'node:https'
import { app, shell } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { createLogger } from '../shared/logger'
import { secureHandle } from './ipc/handlers'

const log = createLogger('updater')

const MANIFEST_URL = 'https://tonnet.resistance.dog/updates.json'
const DOWNLOAD_PAGE_URL = 'https://tonnet.resistance.dog/download'
const FETCH_TIMEOUT_MS = 10_000

interface UpdateManifest {
  version: string
  releaseDate?: string
}

interface CheckResult {
  updateAvailable: boolean
  version?: string
  releaseDate?: string
  reason?: 'dev-mode'
}

let initialized = false

export function initUpdater(): void {
  if (initialized) return
  initialized = true

  secureHandle(IPC_CHANNELS.UPDATER_CHECK, async (): Promise<CheckResult> => {
    if (!app.isPackaged) {
      return { updateAvailable: false, reason: 'dev-mode' }
    }
    const manifest = await fetchManifest()
    const isNewer = compareSemver(manifest.version, app.getVersion()) > 0
    return {
      updateAvailable: isNewer,
      version: manifest.version,
      releaseDate: manifest.releaseDate,
    }
  })

  secureHandle(IPC_CHANNELS.UPDATER_OPEN_DOWNLOAD_PAGE, async () => {
    await shell.openExternal(DOWNLOAD_PAGE_URL)
    return { success: true }
  })

  log.info('Update checker initialized')
}

function fetchManifest(): Promise<UpdateManifest> {
  return new Promise((resolve, reject) => {
    // No custom User-Agent: node:https sends none by default, so the update
    // check does not leak the app identity or installed version to the server
    // or any on-path observer. The server compares versions client-side.
    const req = https.get(MANIFEST_URL, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`Update server returned HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(body) as unknown
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            typeof (parsed as { version?: unknown }).version !== 'string'
          ) {
            reject(new Error('Update manifest missing version field'))
            return
          }
          resolve(parsed as UpdateManifest)
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('Update check timed out'))
    })
  })
}

/**
 * Compare two semver-like version strings. Returns >0 if a>b, <0 if a<b, 0 if equal.
 * Supports major.minor.patch only. Pre-release suffixes are ignored.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}
