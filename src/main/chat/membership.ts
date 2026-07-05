import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { keyPairFromSeed } from '@ton/crypto'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { writeJsonAtomic } from '../utils/secure-fs'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import { issueCertificate, verifyCertificate, CERT_MAX_SIZE } from './cert'
import { overlayIdForRoom } from './room'

const log = createLogger('chat:membership')

const FILE = 'chat-membership.json'
const CERT_TTL_S = 30 * 24 * 3600
const RENEW_BEFORE_S = 7 * 24 * 3600

interface MembershipFile {
  v: 1
  owned: Record<string, string> // ownerPubHex -> encrypted owner seed (hex-in-SENC) or plain hex
  certs: Record<string, string> // full room name -> granted cert bytes (base64)
}

export class ChatMembership {
  private storage = new ElectronSafeStorageAdapter()
  private file: MembershipFile | null = null
  private loaded = false

  private path(): string {
    return join(app.getPath('userData'), FILE)
  }

  private async load(): Promise<MembershipFile> {
    if (this.loaded && this.file) return this.file
    this.loaded = true
    try {
      const raw = await fs.readFile(this.path(), 'utf-8')
      const parsed = JSON.parse(raw) as MembershipFile
      if (parsed && parsed.v === 1) this.file = parsed
    } catch (err) {
      if (!isEnoent(err)) log.warn('membership file unreadable:', err)
    }
    if (!this.file) this.file = { v: 1, owned: {}, certs: {} }
    return this.file
  }

  private persist(): void {
    if (this.file) writeJsonAtomic(this.path(), this.file)
  }

  private encodeSeed(seed: Buffer): string {
    if (this.storage.isAvailable()) return 'SENC:' + this.storage.encrypt(seed.toString('hex')).toString('base64')
    return 'PLN:' + seed.toString('hex')
  }

  private decodeSeed(s: string): Buffer | null {
    if (s.startsWith('SENC:')) return Buffer.from(this.storage.decrypt(Buffer.from(s.slice(5), 'base64')), 'hex')
    if (s.startsWith('PLN:')) return Buffer.from(s.slice(4), 'hex')
    return null
  }

  // createGatedRoom mints an owner key and returns the self-certifying full room
  // name NAME#o=<ownerPubHex>, per spec section 2.
  async createGatedRoom(display: string): Promise<string> {
    const file = await this.load()
    const seed = randomBytes(32)
    const ownerPub = keyPairFromSeed(seed).publicKey
    const ownerHex = ownerPub.toString('hex')
    file.owned[ownerHex] = this.encodeSeed(seed)
    this.persist()
    return `${display}#o=${ownerHex}`
  }

  async isOwner(ownerPubHex: string): Promise<boolean> {
    const file = await this.load()
    return Boolean(file.owned[ownerPubHex])
  }

  private async ownerSeed(ownerPubHex: string): Promise<Buffer | null> {
    const file = await this.load()
    const enc = file.owned[ownerPubHex]
    if (!enc) return null
    try {
      return this.decodeSeed(enc)
    } catch (err) {
      log.warn('owner seed unreadable:', err)
      return null
    }
  }

  // issue mints a member certificate as the room owner (auto-grant policy).
  async issue(fullRoom: string, ownerPubHex: string, memberDevicePub: Buffer, nowSec: number): Promise<Buffer | null> {
    const seed = await this.ownerSeed(ownerPubHex)
    if (!seed) return null
    const overlayId = overlayIdForRoom(fullRoom)
    return issueCertificate(seed, overlayId, memberDevicePub, nowSec + CERT_TTL_S, CERT_MAX_SIZE)
  }

  async storeCert(fullRoom: string, cert: Buffer): Promise<void> {
    const file = await this.load()
    file.certs[fullRoom] = cert.toString('base64')
    this.persist()
  }

  // validCert returns a stored, non-expiring-soon certificate for the room.
  async validCert(fullRoom: string, memberDevicePub: Buffer, ownerPub: Buffer, nowSec: number): Promise<Buffer | null> {
    const file = await this.load()
    const b64 = file.certs[fullRoom]
    if (!b64) return null
    const cert = Buffer.from(b64, 'base64')
    const overlayId = overlayIdForRoom(fullRoom)
    if (!verifyCertificate(cert, memberDevicePub, overlayId, CERT_MAX_SIZE, ownerPub, nowSec + RENEW_BEFORE_S)) {
      return null
    }
    return cert
  }
}
