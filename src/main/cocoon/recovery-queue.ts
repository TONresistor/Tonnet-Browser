/**
 * Encrypted persistent queue of recovery intents for archived (rotated-out)
 * Cocoon wallets whose client SC still locks user TON.
 *
 * Why a separate store from cocoon-stake.json (which holds the live wallet's
 * pending-withdraw flag): each entry references an ARCHIVED wallet identity
 * and runs through its own multi-stage state machine in parallel with — and
 * independently of — the live wallet's withdraw cycle. Mixing them would
 * couple two unrelated lifecycles.
 *
 * Schema mirrors stake-cache.ts: SENC marker + safeStorage encryption + atomic
 * write (tmp → rename + chmod 0o600). Crash-safe across app restarts so the
 * RecoveryDriver picks up where it left off after a restart mid-cooldown.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'

const log = createLogger('cocoon:recovery-queue')

const ENCRYPTED_MARKER = Buffer.from('SENC')
const FILE_NAME = 'cocoon-recovery-queue.dat'

/**
 * State machine of a recovery entry. The driver advances entries through these
 * phases per tick.
 *
 *   refund-pending → cooldown      : refund msg dispatched, waiting for SC to
 *                                    enter state=1 with unlock_ts set
 *   cooldown       → claim-pending : on-chain unlock_ts has elapsed; ready to
 *                                    fire the second request_refund (which on
 *                                    state=1 + now>=unlock_ts triggers the
 *                                    actual refund + SC self-destruct)
 *   claim-pending  → drain-pending : second refund tx sent; cocoon_node should
 *                                    now hold the staked TON. Ready to drain.
 *   drain-pending  → done          : cocoon_node drained back to native wallet.
 *   * (transient)  → failed        : unrecoverable error (recorded in lastError).
 */
export type RecoveryPhase = 'refund-pending' | 'cooldown' | 'claim-pending' | 'drain-pending' | 'done' | 'failed'

export interface RecoveryEntry {
  /** Joins this entry to its archive record (1:1 mapping). */
  archivedAt: number
  /** Address of the on-chain CocoonClient SC holding the locked stake. */
  clientSCAddress: string
  phase: RecoveryPhase
  /** Unix ms when the entry was enqueued. */
  addedAt: number
  /** Last error message, set when phase transitions to 'failed' or on transient errors. */
  lastError?: string
  /** On-chain unlock timestamp (seconds since epoch). Populated once the SC reports state=1. */
  unlockTs?: number
  /** Hash of the boc broadcast for the initial refund tx (phase=refund-pending). */
  refundBocHash?: string
  /** Hash of the boc broadcast for the claim refund tx (phase=claim-pending). */
  claimBocHash?: string
  /** Hash of the boc broadcast for the cocoon_node drain tx (phase=drain-pending). */
  drainBocHash?: string
  /** Native wallet address the funds were sent to. */
  sentToMain?: string
}

interface QueueFile {
  entries: RecoveryEntry[]
}

export class RecoveryQueueStore {
  private storage: ISecureStorage
  private filePath: string
  private cached: QueueFile | null = null

  constructor(basePath?: string, storage: ISecureStorage = new ElectronSafeStorageAdapter()) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, FILE_NAME)
  }

  /** Append a new entry. Throws on duplicate `archivedAt` (1:1 with archive). */
  async add(entry: RecoveryEntry): Promise<void> {
    this.ensureEncryptionAvailable()
    const data = (await this.readFile()) ?? { entries: [] }
    if (data.entries.some((e) => e.archivedAt === entry.archivedAt)) {
      throw new Error(`Recovery entry already exists for archivedAt=${entry.archivedAt}`)
    }
    data.entries.push(entry)
    await this.writeFile(data)
    log.info(`Recovery enqueued: archivedAt=${entry.archivedAt} clientSC=${entry.clientSCAddress.slice(0, 8)}…`)
  }

  /** Apply a partial update to the entry identified by `archivedAt`. */
  async update(archivedAt: number, partial: Partial<RecoveryEntry>): Promise<void> {
    this.ensureEncryptionAvailable()
    const data = await this.readFile()
    if (!data) return
    const idx = data.entries.findIndex((e) => e.archivedAt === archivedAt)
    if (idx === -1) return
    data.entries[idx] = { ...data.entries[idx], ...partial, archivedAt: data.entries[idx].archivedAt }
    await this.writeFile(data)
  }

  /** Read the full queue (oldest first). */
  async list(): Promise<RecoveryEntry[]> {
    const data = await this.readFile()
    if (!data) return []
    return [...data.entries].sort((a, b) => a.addedAt - b.addedAt)
  }

  /** Remove the entry identified by `archivedAt`. No-op if not present. */
  async remove(archivedAt: number): Promise<void> {
    this.ensureEncryptionAvailable()
    const data = await this.readFile()
    if (!data) return
    const before = data.entries.length
    data.entries = data.entries.filter((e) => e.archivedAt !== archivedAt)
    if (data.entries.length === before) return
    await this.writeFile(data)
    log.info(`Recovery removed: archivedAt=${archivedAt}`)
  }

  /** Test-only: returns the file path. */
  getFilePath(): string {
    return this.filePath
  }

  private ensureEncryptionAvailable(): void {
    if (!this.storage.isAvailable()) {
      throw new Error(
        'Secure storage is not available. Install a keyring (gnome-keyring, kwallet) to use Cocoon recovery.'
      )
    }
  }

  private async readFile(): Promise<QueueFile | null> {
    if (this.cached) return this.cached
    let buf: Buffer
    try {
      buf = await fs.readFile(this.filePath)
    } catch (err) {
      if (isEnoent(err)) return null
      throw err
    }
    if (!buf.subarray(0, 4).equals(ENCRYPTED_MARKER)) {
      throw new Error(`Unexpected file format at ${this.filePath} (no SENC marker)`)
    }
    const json = this.storage.decrypt(buf.subarray(4))
    const parsed = JSON.parse(json) as QueueFile
    this.cached = parsed
    return parsed
  }

  private async writeFile(data: QueueFile): Promise<void> {
    const json = JSON.stringify(data)
    const encrypted = this.storage.encrypt(json)
    const marked = Buffer.concat([ENCRYPTED_MARKER, encrypted])
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, marked, { mode: 0o600 })
    await fs.rename(tmp, this.filePath)
    if (process.platform !== 'win32') await fs.chmod(this.filePath, 0o600)
    this.cached = data
  }
}

let singleton: RecoveryQueueStore | null = null

export function getRecoveryQueueStore(): RecoveryQueueStore {
  if (!singleton) singleton = new RecoveryQueueStore()
  return singleton
}

/** Test-only: replace the singleton (e.g. with an in-memory adapter). */
export function _setRecoveryQueueForTesting(store: RecoveryQueueStore | null): void {
  singleton = store
}
