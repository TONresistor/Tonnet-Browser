import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { writeSecureFileAtomic } from '../utils/secure-fs'
import type { WalletManager } from '../wallet/manager'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import type { OwnChatIdentity } from '../../shared/types'
import { devicePublicKeyHex } from './envelope'
import { proofPayload, deriveWalletAddress, shortAddress, PROOF_TTL_S, TONPROOF_DOMAIN, verifyProof } from './tonproof'
import { checkOwnDomain } from './resolve'
import { VersionedJsonRepository } from '../persistence/versioned-json-repository'

const log = createLogger('chat:identity')

const DEVICE_KEY_FILE = 'chat-device-key.dat'
const IDENTITY_FILE = 'chat-identity.json'
const ENCRYPTED_MARKER = Buffer.from('SENC')
const PLAIN_MARKER = Buffer.from('PLNS')
const PROOF_CLOCK_SAFETY_S = 300

export interface ChatProof {
  wkey: string
  wsig: string
  wts: number
  wexp: number
}

interface IdentityFile {
  v: 1
  wkey?: string
  wsig?: string
  wts?: number
  wexp?: number
  dpub?: string
  domain?: string
  declinedFor?: string
}

const IdentityFileSchema = z.object({
  v: z.literal(1),
  wkey: z.string().optional(),
  wsig: z.string().optional(),
  wts: z.number().finite().optional(),
  wexp: z.number().finite().optional(),
  dpub: z.string().optional(),
  domain: z.string().optional(),
  declinedFor: z.string().optional(),
})

export class ChatIdentityManager {
  private walletManager: WalletManager
  private storage = new ElectronSafeStorageAdapter()
  private seed: Buffer | null = null
  private file: IdentityFile | null = null
  private fileLoaded = false
  private signInFlight: Promise<ChatProof | null> | null = null
  private readonly deviceFilePath: string
  private readonly identityFilePath: string
  private readonly repository: VersionedJsonRepository<IdentityFile>

  constructor(walletManager: WalletManager, paths: { device?: string; identity?: string } = {}) {
    this.walletManager = walletManager
    this.deviceFilePath = paths.device ?? join(app.getPath('userData'), DEVICE_KEY_FILE)
    this.identityFilePath = paths.identity ?? join(app.getPath('userData'), IDENTITY_FILE)
    this.repository = new VersionedJsonRepository({
      filePath: this.identityFilePath,
      version: 1,
      schema: IdentityFileSchema,
      defaults: () => ({ v: 1 }),
      migrate: (raw) => raw,
      mode: 0o600,
      corruption: 'reset-with-backup',
      onCorrupt: (error, backupPath) => log.error(`Quarantined corrupt chat identity at ${backupPath}:`, error),
    })
  }

  async deviceSeed(): Promise<Buffer> {
    if (this.seed) return this.seed
    try {
      const buf = await fs.readFile(this.deviceFilePath)
      const marker = buf.subarray(0, 4)
      if (marker.equals(ENCRYPTED_MARKER)) {
        this.seed = Buffer.from(this.storage.decrypt(buf.subarray(4)), 'hex')
      } else if (marker.equals(PLAIN_MARKER)) {
        this.seed = buf.subarray(4)
      }
      if (this.seed && this.seed.length === 32) return this.seed
      log.warn('chat device key file invalid, regenerating')
    } catch (err) {
      if (!isEnoent(err)) log.warn('chat device key unreadable, regenerating:', err)
    }
    const seed = randomBytes(32)
    let payload: Buffer
    if (this.storage.isAvailable()) {
      payload = Buffer.concat([ENCRYPTED_MARKER, this.storage.encrypt(seed.toString('hex'))])
    } else {
      payload = Buffer.concat([PLAIN_MARKER, seed])
    }
    await writeSecureFileAtomic(this.deviceFilePath, payload)
    this.seed = seed
    return seed
  }

  async devicePub(): Promise<string> {
    return devicePublicKeyHex(await this.deviceSeed())
  }

  private async readFileState(): Promise<IdentityFile | null> {
    if (this.fileLoaded) return this.file
    this.fileLoaded = true
    this.file = await this.repository.load()
    return this.file
  }

  private async persist(file: IdentityFile): Promise<void> {
    await this.repository.save(file)
    this.file = file
    this.fileLoaded = true
  }

  private validProof(
    file: IdentityFile | null,
    walletPub: string,
    devicePub: string,
    nowSec: number
  ): ChatProof | null {
    if (!file || !file.wkey || !file.wsig || !file.wts || !file.wexp) return null
    if (file.wkey !== walletPub) return null
    if (file.dpub !== devicePub) return null
    const verified = verifyProof(
      {
        type: 'msg',
        nick: '',
        text: '',
        ts: nowSec * 1_000,
        room: 'tonnet:proof-cache',
        key: devicePub,
        wkey: file.wkey,
        wsig: file.wsig,
        wts: file.wts,
        wexp: file.wexp,
      },
      nowSec
    )
    if (!verified.ok) return null
    return { wkey: file.wkey, wsig: file.wsig, wts: file.wts, wexp: file.wexp }
  }

  private async signProof(walletPub: string): Promise<ChatProof> {
    const devicePub = await this.devicePub()
    // wts is chosen by the wallet after this payload is built. Reserve the
    // permitted clock-skew window so wexp-wts cannot exceed the 7-day profile.
    const wexp = Math.floor(Date.now() / 1000) + PROOF_TTL_S - PROOF_CLOCK_SAFETY_S
    const reply = await this.walletManager.signTonProof(TONPROOF_DOMAIN, proofPayload(devicePub, wexp))
    const proof: ChatProof = {
      wkey: walletPub,
      wsig: Buffer.from(reply.signature, 'base64').toString('hex'),
      wts: reply.timestamp,
      wexp,
    }
    const verified = verifyProof(
      {
        type: 'msg',
        nick: '',
        text: '',
        ts: Date.now(),
        room: 'tonnet:proof-signing',
        key: devicePub,
        ...proof,
      },
      Math.floor(Date.now() / 1000)
    )
    if (!verified.ok) throw new Error(`Wallet returned an invalid TON proof (${verified.reason})`)
    const domain = this.file?.wkey === walletPub ? this.file?.domain : undefined
    await this.persist({ v: 1, ...proof, dpub: devicePub, domain })
    return proof
  }

  async currentProof(): Promise<ChatProof | null> {
    const state = this.walletManager.getState()
    if (!state.isCreated || !state.publicKey) return null
    const file = await this.readFileState()
    return this.validProof(file, state.publicKey, await this.devicePub(), Math.floor(Date.now() / 1000))
  }

  async ensureProof(): Promise<ChatProof | null> {
    const state = this.walletManager.getState()
    if (!state.isCreated || !state.publicKey) return null
    const walletPub = state.publicKey
    const devicePub = await this.devicePub()
    const nowSec = Math.floor(Date.now() / 1000)
    const file = await this.readFileState()

    const proof = this.validProof(file, walletPub, devicePub, nowSec)
    if (proof) return proof

    if (this.signInFlight) return this.signInFlight
    this.signInFlight = this.signProof(walletPub)
      .catch((err) => {
        log.error('chat auto-link failed:', err)
        return null
      })
      .finally(() => {
        this.signInFlight = null
      })
    return this.signInFlight
  }

  async ownIdentity(): Promise<OwnChatIdentity> {
    const devicePub = await this.devicePub()
    const state = this.walletManager.getState()
    const nowSec = Math.floor(Date.now() / 1000)
    const file = await this.readFileState()
    const out: OwnChatIdentity = {
      deviceKey: devicePub,
      linked: false,
      declined: false,
      walletReady: Boolean(state.isCreated && state.publicKey),
    }
    if (!state.isCreated || !state.publicKey) return out
    const address = deriveWalletAddress(state.publicKey)
    if (address) {
      out.address = address.toString({ bounceable: false })
      out.addressShort = shortAddress(address)
    }
    if (this.validProof(file, state.publicKey, devicePub, nowSec)) {
      out.linked = true
      if (file?.domain) out.domain = file.domain
    } else if (file?.declinedFor === state.publicKey) out.declined = true
    return out
  }

  async relink(): Promise<ChatProof | null> {
    const state = this.walletManager.getState()
    if (!state.isCreated || !state.publicKey) return null
    const file = await this.readFileState()
    if (file?.declinedFor) {
      await this.persist({ v: 1 })
    }
    return this.ensureProof()
  }

  async claimedDomain(): Promise<string | null> {
    const state = this.walletManager.getState()
    if (!state.isCreated || !state.publicKey) return null
    const devicePub = await this.devicePub()
    const file = await this.readFileState()
    if (!file?.domain) return null
    if (!this.validProof(file, state.publicKey, devicePub, Math.floor(Date.now() / 1000))) return null
    return file.domain
  }

  async claimDomain(domain: string): Promise<{ ok: boolean; reason?: string }> {
    const state = this.walletManager.getState()
    if (!state.isCreated || !state.publicKey) return { ok: false, reason: 'No wallet' }
    const address = deriveWalletAddress(state.publicKey)
    if (!address) return { ok: false, reason: 'No wallet address' }
    const result = await checkOwnDomain(
      domain,
      address.toString({ bounceable: false }),
      (d) => this.walletManager.resolveDomain(d),
      Math.floor(Date.now() / 1000)
    )
    if (!result.ok) return result
    const file = (await this.readFileState()) ?? { v: 1 }
    await this.persist({ ...file, v: 1, domain: domain.trim().toLowerCase() })
    return { ok: true }
  }

  async clearDomain(): Promise<void> {
    const file = await this.readFileState()
    if (!file) return
    const next = { ...file }
    delete next.domain
    await this.persist(next)
  }

  async resetIdentity(): Promise<void> {
    this.seed = null
    this.file = null
    this.fileLoaded = false
    this.signInFlight = null
    await fs.rm(this.deviceFilePath, { force: true })
    await fs.rm(this.identityFilePath, { force: true })
    log.info('chat identity reset: device key and attribution cleared')
  }
}
