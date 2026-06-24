import { Address, Cell } from '@ton/core'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { APP_VERSION } from '../../shared/constants'
import { errorMessage } from '../../shared/errors'
import { getMainWindow } from '../windows/main'
import { RateLimiter } from '../ipc/validation'
import { createLogger } from '../../shared/logger'
import type { WalletManager } from '../wallet/manager'
import type { OverlayManager } from '../windows/overlay-manager'
import { TonConnectSessionStore } from './session-store'
import { buildSignDataRows } from './sign-data-preview'
import {
  TONCONNECT_PROTOCOL_VERSION,
  TON_MAINNET_CHAIN,
  TONCONNECT_MAX_MESSAGES,
  TONCONNECT_ERROR,
  CONNECT_ERROR,
  type AppManifest,
  type AppRequest,
  type ConnectEvent,
  type ConnectEventError,
  type ConnectItemReply,
  type ConnectRequest,
  type DeviceInfo,
  type DisconnectEvent,
  type SignDataPayloadInput,
  type TonConnectOutMessage,
  type TonProofItem,
  type WalletResponse,
} from './types'
import type { TonConnectSession } from '../../shared/types'

const log = createLogger('tonconnect')

const MANIFEST_TIMEOUT_MS = 15_000
const MANIFEST_MAX_BYTES = 16_384

interface TonConnectRequestPayload {
  method: 'connect' | 'restore' | 'send' | 'disconnect'
  protocolVersion?: number
  request?: ConnectRequest
  message?: AppRequest
}

interface RawSendMessage {
  address?: unknown
  amount?: unknown
  payload?: unknown
  stateInit?: unknown
}

function connectError(code: number, message: string): ConnectEventError {
  return { event: 'connect_error', id: 0, payload: { code, message } }
}

function rpcError(id: string, code: number, message: string): WalletResponse {
  return { id, error: { code, message } }
}

function anyToAddress(value: string): Address {
  try {
    return Address.parseFriendly(value).address
  } catch {
    return Address.parseRaw(value)
  }
}

function sameAddress(a: string, b: string): boolean {
  try {
    return anyToAddress(a).equals(anyToAddress(b))
  } catch {
    return false
  }
}

function isFriendlyAddress(value: string): boolean {
  try {
    Address.parseFriendly(value)
    return true
  } catch {
    return false
  }
}

function isValidBoc(b64: string): boolean {
  try {
    Cell.fromBase64(b64)
    return true
  } catch {
    return false
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

async function readBounded(res: Response, maxBytes: number): Promise<Buffer> {
  const lenHeader = res.headers.get('content-length')
  if (lenHeader && Number(lenHeader) > maxBytes) {
    throw new Error('Response too large')
  }
  const reader = res.body?.getReader?.()
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new Error('Response too large')
    return buf
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

function shortAddress(value: string): string {
  let s = value
  try {
    s = anyToAddress(value).toString({ bounceable: false })
  } catch {
    s = value
  }
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

function formatGram(nano: string): string {
  try {
    const n = BigInt(nano)
    const whole = n / 1_000_000_000n
    const frac = (n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : `${whole}`
  } catch {
    return nano
  }
}

function platform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'mac'
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return 'browser'
  }
}

export class TonConnectService {
  private walletManager: WalletManager
  private sessionStore: TonConnectSessionStore
  private overlayManager: OverlayManager
  private sendersByDomain = new Map<string, Set<Electron.WebContents>>()
  private approvalCounter = 0
  private limiter = new RateLimiter(10, 1000)

  constructor(walletManager: WalletManager, sessionStore: TonConnectSessionStore, overlayManager: OverlayManager) {
    this.walletManager = walletManager
    this.sessionStore = sessionStore
    this.overlayManager = overlayManager
  }

  init(): void {
    this.sessionStore.init()
  }

  async handleRequest(
    domain: string,
    event: Electron.IpcMainInvokeEvent,
    payload: TonConnectRequestPayload
  ): Promise<unknown> {
    if (!this.limiter.check()) {
      if (payload?.method === 'send') {
        return rpcError(payload.message?.id ?? '0', TONCONNECT_ERROR.UNKNOWN, 'Rate limit exceeded')
      }
      return connectError(CONNECT_ERROR.UNKNOWN, 'Rate limit exceeded')
    }
    try {
      switch (payload?.method) {
        case 'connect':
          return await this.connect(domain, event, payload.request, payload.protocolVersion)
        case 'restore':
          return this.restore(domain, event)
        case 'send':
          return await this.send(domain, event, payload.message)
        case 'disconnect':
          this.sessionStore.delete(domain)
          return { id: '0', result: {} }
        default:
          return connectError(CONNECT_ERROR.BAD_REQUEST, 'Unknown method')
      }
    } catch (err) {
      log.error(`TON Connect ${payload?.method} failed for ${domain}:`, err)
      if (payload?.method === 'send') {
        return rpcError(payload.message?.id ?? '0', TONCONNECT_ERROR.UNKNOWN, errorMessage(err))
      }
      return connectError(CONNECT_ERROR.UNKNOWN, errorMessage(err))
    }
  }

  getSessions(): TonConnectSession[] {
    return this.sessionStore.list()
  }

  disconnectSession(domain: string): void {
    this.emitDisconnect(domain)
    this.sessionStore.delete(domain)
  }

  clearSessions(): void {
    for (const domain of this.sessionStore.list().map((s) => s.domain)) {
      this.emitDisconnect(domain)
    }
    this.sessionStore.clear()
  }

  private async connect(
    domain: string,
    event: Electron.IpcMainInvokeEvent,
    request?: ConnectRequest,
    protocolVersion?: number
  ): Promise<ConnectEvent> {
    if (protocolVersion && protocolVersion > TONCONNECT_PROTOCOL_VERSION) {
      return connectError(CONNECT_ERROR.BAD_REQUEST, 'Unsupported protocol version')
    }
    const account = this.walletManager.getTonConnectAccount()
    if (!account) {
      return connectError(CONNECT_ERROR.UNKNOWN, 'No wallet available')
    }
    if (!request || !Array.isArray(request.items) || !request.items.some((i) => i.name === 'ton_addr')) {
      return connectError(CONNECT_ERROR.BAD_REQUEST, 'ton_addr item is required')
    }

    let manifest: AppManifest | null = null
    try {
      manifest = await this.fetchManifest(event.sender.session, request.manifestUrl)
    } catch (err) {
      log.warn(`Manifest fetch failed for ${domain}: ${errorMessage(err)}`)
    }

    const appName = manifest?.name || domain
    const appUrl = manifest?.url || `http://${domain}`
    const appIconUrl = manifest?.iconUrl

    const icon = await this.fetchIconDataUri(event.sender.session, manifest?.iconUrl)
    const approved = await this.showApproval({
      type: 'approval',
      icon: icon ?? undefined,
      iconFallback: icon ? undefined : '🌐',
      title: appName,
      subtitle: 'wants to connect to your wallet',
      rows: [
        { label: 'Site', value: domain },
        { label: 'Wallet', value: shortAddress(account.addressRaw) },
      ],
      actions: [
        { id: 'deny', label: 'Cancel' },
        { id: 'approve', label: 'Connect', primary: true },
      ],
    })
    if (!approved) {
      return connectError(CONNECT_ERROR.USER_DECLINED, 'User declined the connection')
    }

    const items: ConnectItemReply[] = [
      {
        name: 'ton_addr',
        address: account.addressRaw,
        network: TON_MAINNET_CHAIN,
        publicKey: account.publicKey,
        walletStateInit: account.walletStateInit,
      },
    ]

    const proofItem = request.items.find((i): i is TonProofItem => i.name === 'ton_proof')
    if (proofItem) {
      try {
        const proof = await this.walletManager.signTonProof(domain, proofItem.payload)
        items.push({ name: 'ton_proof', proof })
      } catch (err) {
        items.push({ name: 'ton_proof', error: { code: 0, message: errorMessage(err) } })
      }
    }

    this.sessionStore.set({
      domain,
      manifestUrl: request.manifestUrl,
      appName,
      appIconUrl,
      url: appUrl,
      address: account.addressRaw,
      network: TON_MAINNET_CHAIN,
      grantedAt: Date.now(),
      lastEventId: 0,
      lastRpcId: null,
    })
    this.trackSender(domain, event.sender)
    log.info(`TON Connect: ${domain} connected as ${appName}`)

    return { event: 'connect', id: 0, payload: { items, device: this.buildDeviceInfo() } }
  }

  private restore(domain: string, event: Electron.IpcMainInvokeEvent): ConnectEvent {
    const session = this.sessionStore.get(domain)
    const account = this.walletManager.getTonConnectAccount()
    if (!session || !account || !sameAddress(session.address, account.addressRaw)) {
      return connectError(CONNECT_ERROR.UNKNOWN_APP, 'Unknown app')
    }
    this.trackSender(domain, event.sender)
    return {
      event: 'connect',
      id: 0,
      payload: {
        items: [
          {
            name: 'ton_addr',
            address: account.addressRaw,
            network: TON_MAINNET_CHAIN,
            publicKey: account.publicKey,
            walletStateInit: account.walletStateInit,
          },
        ],
        device: this.buildDeviceInfo(),
      },
    }
  }

  private async send(
    domain: string,
    event: Electron.IpcMainInvokeEvent,
    message?: AppRequest
  ): Promise<WalletResponse> {
    if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') {
      return rpcError('0', TONCONNECT_ERROR.BAD_REQUEST, 'Malformed request')
    }
    const session = this.sessionStore.get(domain)
    const account = this.walletManager.getTonConnectAccount()
    if (!session || !account || !sameAddress(session.address, account.addressRaw)) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN_APP, 'Unknown app')
    }
    this.trackSender(domain, event.sender)

    if (message.method === 'disconnect') {
      this.sessionStore.delete(domain)
      return { id: message.id, result: {} }
    }

    if (!this.sessionStore.acceptRpcId(domain, message.id)) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Request id must strictly increase')
    }

    switch (message.method) {
      case 'sendTransaction':
        return this.sendTransaction(domain, session.appName, message)
      case 'signData':
        return this.signData(domain, session.appName, message)
      default:
        return rpcError(message.id, TONCONNECT_ERROR.METHOD_NOT_SUPPORTED, `Method ${message.method} not supported`)
    }
  }

  private async sendTransaction(domain: string, appName: string, message: AppRequest): Promise<WalletResponse> {
    let parsed: { network?: string; from?: string; valid_until?: number; messages?: RawSendMessage[] }
    try {
      parsed = JSON.parse(message.params?.[0] ?? '')
    } catch {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid transaction payload')
    }

    const messages = parsed.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'No messages')
    }
    if (messages.length > TONCONNECT_MAX_MESSAGES) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Too many messages')
    }
    if (parsed.network && parsed.network !== TON_MAINNET_CHAIN) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Network mismatch')
    }
    const account = this.walletManager.getTonConnectAccount()
    if (parsed.from && account && !sameAddress(parsed.from, account.addressRaw)) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid sender address')
    }
    if (parsed.valid_until && parsed.valid_until < Math.floor(Date.now() / 1000)) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Transaction expired')
    }

    const out: TonConnectOutMessage[] = []
    for (const m of messages) {
      if (typeof m.address !== 'string' || !isFriendlyAddress(m.address)) {
        return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Address must be user-friendly')
      }
      if (typeof m.amount !== 'string' || !/^[0-9]+$/.test(m.amount)) {
        return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Amount must be a string of nanocoins')
      }
      if (m.payload !== undefined && (typeof m.payload !== 'string' || !isValidBoc(m.payload))) {
        return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid payload BoC')
      }
      if (m.stateInit !== undefined && (typeof m.stateInit !== 'string' || !isValidBoc(m.stateInit))) {
        return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid stateInit BoC')
      }
      out.push({
        address: m.address,
        amount: m.amount,
        payload: typeof m.payload === 'string' ? m.payload : undefined,
        stateInit: typeof m.stateInit === 'string' ? m.stateInit : undefined,
      })
    }

    let totalNano = 0n
    for (const m of out) {
      try {
        totalNano += BigInt(m.amount)
      } catch {
        totalNano += 0n
      }
    }
    const hasPayload = out.some((m) => m.payload || m.stateInit)
    const approved = await this.showApproval({
      type: 'approval',
      iconFallback: '↑',
      title: 'Confirm transaction',
      subtitle: appName,
      amount: `${formatGram(totalNano.toString())} GRAM`,
      warning: hasPayload ? 'Includes a contract payload — this is not a plain transfer.' : undefined,
      rows: out.map((m, i) => ({
        label: out.length > 1 ? `To ${i + 1}` : 'To',
        value: shortAddress(m.address),
      })),
      actions: [
        { id: 'deny', label: 'Reject' },
        { id: 'approve', label: 'Confirm', primary: true },
      ],
    })
    if (!approved) {
      return rpcError(message.id, TONCONNECT_ERROR.USER_DECLINED, 'Transaction rejected by user')
    }

    try {
      const boc = await this.walletManager.signTonConnectTransaction(out)
      return { id: message.id, result: boc }
    } catch (err) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(err))
    }
  }

  private async signData(domain: string, appName: string, message: AppRequest): Promise<WalletResponse> {
    let payload: SignDataPayloadInput
    try {
      payload = JSON.parse(message.params?.[0] ?? '')
    } catch {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid sign-data payload')
    }
    if (!payload || (payload.type !== 'text' && payload.type !== 'binary' && payload.type !== 'cell')) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Unsupported sign-data type')
    }

    const approved = await this.showApproval({
      type: 'approval',
      iconFallback: '✎',
      title: 'Sign data',
      subtitle: appName,
      rows: buildSignDataRows(payload),
      actions: [
        { id: 'deny', label: 'Reject' },
        { id: 'approve', label: 'Sign', primary: true },
      ],
    })
    if (!approved) {
      return rpcError(message.id, TONCONNECT_ERROR.USER_DECLINED, 'Sign request rejected by user')
    }

    try {
      const result = await this.walletManager.signData(domain, payload)
      return { id: message.id, result }
    } catch (err) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(err))
    }
  }

  private buildDeviceInfo(): DeviceInfo {
    return {
      platform: platform(),
      appName: 'tonnet',
      appVersion: APP_VERSION,
      maxProtocolVersion: TONCONNECT_PROTOCOL_VERSION,
      features: [
        { name: 'SendTransaction', maxMessages: TONCONNECT_MAX_MESSAGES, extraCurrencySupported: false },
        { name: 'SignData', types: ['text', 'binary', 'cell'] },
      ],
    }
  }

  private async fetchManifest(session: Electron.Session, url: string): Promise<AppManifest> {
    if (!isHttpUrl(url)) throw new Error('Manifest URL must be http(s)')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
    try {
      const res = await session.fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`)
      const buf = await readBounded(res, MANIFEST_MAX_BYTES)
      const json = JSON.parse(buf.toString('utf-8'))
      if (!json || typeof json.url !== 'string' || typeof json.name !== 'string') {
        throw new Error('Invalid manifest')
      }
      return json as AppManifest
    } finally {
      clearTimeout(timeout)
    }
  }

  private showApproval(content: { type: string; [key: string]: unknown }): Promise<boolean> {
    return new Promise((resolve) => {
      const win = getMainWindow()
      if (!win) {
        resolve(false)
        return
      }
      const id = `tonconnect-approve-${++this.approvalCounter}`
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

  private async fetchIconDataUri(session: Electron.Session, url?: string): Promise<string | null> {
    if (!url || !isHttpUrl(url)) return null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const res = await session.fetch(url, { signal: controller.signal })
      if (!res.ok) return null
      const type = res.headers.get('content-type') || ''
      if (!type.startsWith('image/') || type.includes('svg')) return null
      const buf = await readBounded(res, 200_000)
      if (buf.length === 0) return null
      return `data:${type};base64,${buf.toString('base64')}`
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private trackSender(domain: string, sender: Electron.WebContents): void {
    let set = this.sendersByDomain.get(domain)
    if (!set) {
      set = new Set()
      this.sendersByDomain.set(domain, set)
    }
    if (!set.has(sender)) {
      set.add(sender)
      sender.once('destroyed', () => {
        const current = this.sendersByDomain.get(domain)
        if (current) {
          current.delete(sender)
          if (current.size === 0) this.sendersByDomain.delete(domain)
        }
      })
    }
  }

  private emitDisconnect(domain: string): void {
    const set = this.sendersByDomain.get(domain)
    if (!set || set.size === 0) return
    const evt: DisconnectEvent = { event: 'disconnect', id: this.sessionStore.nextEventId(domain), payload: {} }
    for (const sender of set) {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.TONCONNECT_EVENT, evt)
    }
  }
}
