import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { writeSecureFileAtomic, writeJsonAtomic } from '../utils/secure-fs'
import { getMainWindow } from '../windows/main'
import type { OverlayManager } from '../windows/overlay-manager'
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
  private overlayManager: OverlayManager
  private storage = new ElectronSafeStorageAdapter()
  private seed: Buffer | null = null
  private file: IdentityFile | null = null
  private fileLoaded = false
  private promptInFlight: Promise<ChatProof | null> | null = null
  private approvalCounter = 0

  constructor(walletManager: WalletManager, overlayManager: OverlayManager) {
    this.walletManager = walletManager
    this.overlayManager = overlayManager
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

    if (file?.declinedFor === walletPub) return null

    if (this.promptInFlight) return this.promptInFlight
    this.promptInFlight = this.promptAndSign(walletPub).finally(() => {
      this.promptInFlight = null
    })
    return this.promptInFlight
  }

  private async promptAndSign(walletPub: string): Promise<ChatProof | null> {
    const address = deriveWalletAddress(walletPub)
    const approved = await this.showApproval({
      type: 'approval',
      iconTon: true,
      title: 'Chat identity',
      subtitle: 'Sign your chat messages so no one can impersonate you',
      rows: [
        { label: 'Wallet', value: address ? shortAddress(address) : walletPub.slice(0, 8) },
        { label: 'Cost', value: 'Free, off-chain' },
        { label: 'Validity', value: '7 days, re-confirm when it lapses' },
      ],
      actions: [
        { id: 'deny', label: 'Later' },
        { id: 'approve', label: 'Link identity', primary: true },
      ],
    })
    if (approved === null) return null
    if (!approved) {
      this.persist({ v: 1, declinedFor: walletPub })
      return null
    }
    try {
      return await this.signProof(walletPub)
    } catch (err) {
      log.error('chat proof signing failed:', err)
      return null
    }
  }

  private showApproval(content: { type: string; [key: string]: unknown }): Promise<boolean | null> {
    return new Promise((resolve) => {
      const win = getMainWindow()
      if (!win) {
        resolve(null)
        return
      }
      const id = `chat-identity-${++this.approvalCounter}`
      const bounds = win.getContentBounds()
      this.overlayManager.show(
        id,
        { x: 0, y: 0, width: bounds.width, height: bounds.height },
        content,
        (actionType) => {
          this.overlayManager.hide(id)
          resolve(actionType === 'approve')
        },
        { autoDismiss: false }
      )
    })
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
}
