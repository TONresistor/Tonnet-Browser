import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { writeSecureFileAtomic, writeJsonAtomic } from '../utils/secure-fs'
import type { WalletManager } from '../wallet/manager'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import type { OwnChatIdentity } from '../../shared/types'
import { devicePublicKeyHex } from './envelope'
import { proofPayload, deriveWalletAddress, shortAddress, PROOF_TTL_S, TONPROOF_DOMAIN } from './tonproof'
import { checkOwnDomain } from './resolve'

const log = createLogger('chat:identity')

const DEVICE_KEY_FILE = 'chat-device-key.dat'
const IDENTITY_FILE = 'chat-identity.json'
const ENCRYPTED_MARKER = Buffer.from('SENC')
const PLAIN_MARKER = Buffer.from('PLNS')

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

export class ChatIdentityManager {
  private walletManager: WalletManager
  private storage = new ElectronSafeStorageAdapter()
  private seed: Buffer | null = null
  private file: IdentityFile | null = null
  private fileLoaded = false
  private signInFlight: Promise<ChatProof | null> | null = null

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager
  }

  private devicePath(): string {
    return join(app.getPath('userData'), DEVICE_KEY_FILE)
  }

  private identityPath(): string {
    return join(app.getPath('userData'), IDENTITY_FILE)
  }

  async deviceSeed(): Promise<Buffer> {
    if (this.seed) return this.seed
    try {
      const buf = await fs.readFile(this.devicePath())
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
    await writeSecureFileAtomic(this.devicePath(), payload)
    this.seed = seed
    return seed
  }

  async devicePub(): Promise<string> {
    return devicePublicKeyHex(await this.deviceSeed())
  }

  private async readFileState(): Promise<IdentityFile | null> {
    if (this.fileLoaded) return this.file
    this.fileLoaded = true
    try {
      const raw = await fs.readFile(this.identityPath(), 'utf-8')
      const parsed = JSON.parse(raw) as IdentityFile
      if (parsed && parsed.v === 1) this.file = parsed
    } catch (err) {
      if (!isEnoent(err)) log.warn('chat identity file unreadable:', err)
    }
    return this.file
  }

  private persist(file: IdentityFile): void {
    this.file = file
    this.fileLoaded = true
    writeJsonAtomic(this.identityPath(), file)
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
    if (file.wexp <= nowSec) return null
    return { wkey: file.wkey, wsig: file.wsig, wts: file.wts, wexp: file.wexp }
  }

  private async signProof(walletPub: string): Promise<ChatProof> {
    const devicePub = await this.devicePub()
    const wexp = Math.floor(Date.now() / 1000) + PROOF_TTL_S
    const reply = await this.walletManager.signTonProof(TONPROOF_DOMAIN, proofPayload(devicePub, wexp))
    const proof: ChatProof = {
      wkey: walletPub,
      wsig: Buffer.from(reply.signature, 'base64').toString('hex'),
      wts: reply.timestamp,
      wexp,
    }
    const domain = this.file?.wkey === walletPub ? this.file?.domain : undefined
    this.persist({ v: 1, ...proof, dpub: devicePub, domain })
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
      this.persist({ v: 1 })
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
    this.persist({ ...file, v: 1, domain: domain.trim().toLowerCase() })
    return { ok: true }
  }

  async clearDomain(): Promise<void> {
    const file = await this.readFileState()
    if (!file) return
    const next = { ...file }
    delete next.domain
    this.persist(next)
  }

  async resetIdentity(): Promise<void> {
    this.seed = null
    this.file = null
    this.fileLoaded = false
    this.signInFlight = null
    await fs.rm(this.devicePath(), { force: true })
    await fs.rm(this.identityPath(), { force: true })
    log.info('chat identity reset: device key and attribution cleared')
  }
}
