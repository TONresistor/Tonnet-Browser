import {
  chatClaimDomainContract,
  chatClearDomainContract,
  chatConnectContract,
  chatCreateRoomContract,
  chatDetectDomainsContract,
  chatDisconnectContract,
  chatDmMessageContract,
  chatDmSendContract,
  chatIdentityContract,
  chatLinkIdentityContract,
  chatMessageContract,
  chatResetIdentityContract,
  chatSendContract,
} from '../../../shared/ipc-contract/chat'
import { normalizeRoom, normalizeNodeId, overlayIdB64ForRoom, parseOverlayNodes, parseRoomName } from '../../chat/room'
import { broadcastId, parseBroadcast, sealBroadcast, verifyBroadcast } from '../../chat/broadcast'
import { verifyCertificate, CERT_MAX_SIZE } from '../../chat/cert'
import { ChatMembership } from '../../chat/membership'
import { marshalEnvelope, parseEnvelope, signEnvelope, MAX_TEXT_BYTES, type WireEnvelope } from '../../chat/envelope'
import { deriveWalletAddress, shortAddress } from '../../chat/tonproof'
import { classify } from '../../chat/verify'
import { sealDM, openDM } from '../../chat/dm'
import { verifyDomainOwnership, type ResolveFn } from '../../chat/resolve'
import { ChatIdentityManager, type ChatProof } from '../../chat/identity'
import type { OwnChatIdentity } from '../../../shared/types'
import { ownedDomains } from '../../chat/detect'
import { getSetting } from '../../settings'
import { isTonDomain } from '../../../shared/utils/ton'
import { toError, log } from './shared'
import { ipcFailure, secureContractHandle } from '../contract-handler'
import { emitContractToRenderer } from '../../events/renderer-events'
import type { MessengerBridgePort } from '../../ports/ton-bridge'
import type { ServiceRegistry } from '../../services'
import type { ChatRuntimeSession, ChatSessionController } from '../../chat/session-controller'

type Via = 'node' | 'dht'

interface Candidate {
  adnl: string
  via: Via
}

const RECV_DEDUP_CAP = 8192
const GRANT_COOLDOWN_S = 60

async function resolveCandidates(
  bridge: MessengerBridgePort,
  room: string,
  overlayId: string,
  bootstrap?: string
): Promise<Candidate[]> {
  const seen = new Set<string>()
  const out: Candidate[] = []
  const add = (adnl: string, via: Via): void => {
    if (adnl && !seen.has(adnl)) {
      seen.add(adnl)
      out.push({ adnl, via })
    }
  }

  if (bootstrap) add(bootstrap, 'node')

  if (out.length === 0) {
    try {
      const rec = await bridge.dhtFindValue(overlayId, 'nodes', 0)
      if (rec?.data) {
        for (const node of parseOverlayNodes(Buffer.from(rec.data, 'base64'))) {
          add(node.adnlId.toString('base64'), 'dht')
        }
      }
    } catch (err) {
      log.event('warn', 'chat.discovery.failed', 'chat node discovery failed', { error: toError(err) })
    }
  }

  return out
}

function wireNick(proof: ChatProof | null, domain: string | null): string {
  if (!proof) return ''
  if (domain) return domain
  const address = deriveWalletAddress(proof.wkey)
  return address ? shortAddress(address) : ''
}

function buildSigned(seed: Buffer, base: Omit<WireEnvelope, 'key' | 'sig'>, proof: ChatProof | null): WireEnvelope {
  const env: WireEnvelope = { ...base }
  if (proof) {
    env.wkey = proof.wkey
    env.wsig = proof.wsig
    env.wts = proof.wts
    env.wexp = proof.wexp
  }
  return signEnvelope(env, seed)
}

async function sendEnvelope(
  bridge: MessengerBridgePort,
  overlayId: string,
  env: WireEnvelope,
  seed: Buffer,
  cert?: Buffer | null
): Promise<void> {
  const data = marshalEnvelope(env)
  const wire = sealBroadcast(seed, data, Math.floor(Date.now() / 1000), cert ?? undefined)
  await bridge.overlaySendRaw(overlayId, wire.toString('base64'))
}

async function announcePresence(
  session: ChatRuntimeSession,
  bridge: MessengerBridgePort,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  seed: Buffer,
  room: string
): Promise<void> {
  if (session.room !== room) return
  const attach = getSetting('messenger').attachWalletIdentity
  const [proof, domain] = attach ? await Promise.all([identity.currentProof(), identity.claimedDomain()]) : [null, null]
  if (session.gated && session.ownerKey && !session.cert) {
    const ownHex = await identity.devicePub()
    const ownBuf = Buffer.from(ownHex, 'hex')
    const ownerHex = session.ownerKey.toString('hex')
    session.cert = (await membership.isOwner(ownerHex))
      ? await membership.issue(room, ownerHex, ownBuf, nowSec())
      : await membership.validCert(room, ownBuf, session.ownerKey, nowSec())
  }
  if (session.gated && !session.cert) {
    const req = buildSigned(seed, { type: 'cert-req', nick: '', text: '', ts: Date.now(), room }, proof)
    await sendEnvelope(bridge, session.overlayId, req, seed)
    log.event('info', 'chat.membership.requested', 'chat membership requested')
    return
  }
  const hello = buildSigned(
    seed,
    { type: 'hello', nick: wireNick(proof, domain), text: '', ts: Date.now(), room },
    proof
  )
  await sendEnvelope(bridge, session.overlayId, hello, seed, session.cert)
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function numericTs(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : Date.now()
}

function truncateUtf8(s: string, maxBytes: number): string {
  const raw = Buffer.from(s, 'utf8')
  if (raw.length <= maxBytes) return s
  return raw
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD+$/u, '')
}

async function ownIdentityView(identity: ChatIdentityManager): Promise<OwnChatIdentity> {
  const id = await identity.ownIdentity()
  if (getSetting('messenger').attachWalletIdentity) return id
  return { deviceKey: id.deviceKey, linked: false, declined: false, walletReady: id.walletReady }
}

async function handleEnrollment(
  session: ChatRuntimeSession,
  recentGrants: Map<string, number>,
  bridge: MessengerBridgePort,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  seed: Buffer,
  room: string,
  ownKey: string,
  env: WireEnvelope
): Promise<void> {
  if (session.room !== room || !session.ownerKey) return

  if (env.type === 'cert-req' && env.key) {
    const ownerHex = session.ownerKey.toString('hex')
    if (!(await membership.isOwner(ownerHex))) return
    const reqKey = `${room}:${env.key.toLowerCase()}`
    if ((recentGrants.get(reqKey) ?? 0) > nowSec()) return
    const cert = await membership.issue(room, ownerHex, Buffer.from(env.key, 'hex'), nowSec())
    if (!cert) return
    if (recentGrants.size >= RECV_DEDUP_CAP) {
      const oldest = recentGrants.keys().next().value
      if (oldest !== undefined) recentGrants.delete(oldest)
    }
    recentGrants.set(reqKey, nowSec() + GRANT_COOLDOWN_S)
    const [proof, domain] = await Promise.all([identity.currentProof(), identity.claimedDomain()])
    const grant = buildSigned(
      seed,
      {
        type: 'cert-grant',
        nick: wireNick(proof, domain),
        text: cert.toString('base64'),
        ts: Date.now(),
        room,
        to: env.key,
      },
      proof
    )
    await sendEnvelope(bridge, session.overlayId, grant, seed, session.cert)
    log.event('info', 'chat.membership.granted', 'chat membership granted')
    return
  }

  if (env.type === 'cert-grant' && env.to === ownKey && env.text) {
    const cert = Buffer.from(String(env.text), 'base64')
    const overlayIdBuf = Buffer.from(session.overlayId, 'base64')
    if (!verifyCertificate(cert, Buffer.from(ownKey, 'hex'), overlayIdBuf, CERT_MAX_SIZE, session.ownerKey, nowSec())) {
      return
    }
    await membership.storeCert(room, cert)
    session.cert = cert
    log.event('info', 'chat.membership.received', 'chat membership certificate received')
    await announcePresence(session, bridge, identity, membership, seed, room).catch(() => {})
  }
}

async function connectRoom(
  controller: ChatSessionController<ChatRuntimeSession>,
  recentGrants: Map<string, number>,
  bridge: MessengerBridgePort,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  resolveDomain: ResolveFn,
  room: string,
  bootstrap: string | undefined,
  markJoining: () => void
): Promise<ChatRuntimeSession> {
  let parsed: ReturnType<typeof parseRoomName>
  try {
    parsed = parseRoomName(room)
  } catch {
    ipcFailure('INVALID_ROOM', 'Invalid room name')
  }
  const overlayId = overlayIdB64ForRoom(room)
  const candidates = await resolveCandidates(bridge, room, overlayId, bootstrap)
  if (candidates.length === 0) {
    ipcFailure(
      'ROOM_UNAVAILABLE',
      `No nodes found for room "${room}". Its nodes may be offline, or the room is new and not yet ` +
        `discoverable on the network. Paste a known node id to connect directly.`,
      true
    )
  }
  markJoining()

  const seed = await identity.deviceSeed()
  const ownKey = await identity.devicePub()

  const seen = new Set<string>()
  const firstSeen = (id: string): boolean => {
    if (seen.has(id)) return false
    if (seen.size >= RECV_DEDUP_CAP) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    seen.add(id)
    return true
  }

  let lastErr: Error | null = null
  for (const cand of candidates) {
    const unsub = bridge.onOverlayMessage((data) => {
      if (data.overlay_id !== overlayId) return
      void (async () => {
        try {
          const frame = parseBroadcast(Buffer.from(data.message, 'base64'))
          if (!frame || !verifyBroadcast(frame)) return
          const receivedAt = nowSec()
          const id = broadcastId(frame.src, frame.data, frame.flags).toString('hex')
          if (!firstSeen(id)) return
          const env = parseEnvelope(frame.data)
          if (!env.key || env.key.toLowerCase() !== frame.src.toString('hex')) return
          if (env.type === 'cert-req' || env.type === 'cert-grant') {
            const verdict = classify(env, room, receivedAt)
            if (verdict.drop) {
              log.event('warn', 'chat.enrollment.dropped', 'chat enrollment message dropped', {
                reason: verdict.reason,
              })
              return
            }
            const activeSession = controller.session
            if (activeSession) {
              await handleEnrollment(activeSession, recentGrants, bridge, identity, membership, seed, room, ownKey, env)
            }
            return
          }
          const isDm = env.type === 'dm'
          if (env.type && env.type !== 'msg' && !isDm) return
          if (
            Buffer.byteLength(env.text ?? '', 'utf8') > MAX_TEXT_BYTES ||
            Buffer.byteLength(env.nick ?? '', 'utf8') > 64
          )
            return
          if (isDm && (env.to !== ownKey || !env.key)) return
          const verdict = classify(env, room, receivedAt)
          if (verdict.drop) {
            log.event('warn', 'chat.message.dropped', 'chat message dropped', { reason: verdict.reason })
            return
          }
          let msgIdentity = verdict.identity
          if (msgIdentity.tier === 'wallet' && msgIdentity.address && env.nick) {
            const claim = env.nick.trim().toLowerCase()
            if (await verifyDomainOwnership(claim, msgIdentity.address, resolveDomain, receivedAt)) {
              msgIdentity = { ...msgIdentity, tier: 'domain', name: claim, domain: claim }
            }
          }
          if (isDm) {
            let plain: Buffer
            try {
              plain = openDM(seed, Buffer.from(env.key as string, 'hex'), Buffer.from(String(env.text ?? ''), 'base64'))
            } catch {
              log.event('warn', 'chat.dm.decrypt_failed', 'chat direct message could not be decrypted')
              return
            }
            emitContractToRenderer(chatDmMessageContract, {
              room,
              id: String(env.sig ?? '').slice(0, 32),
              peerKey: env.key as string,
              text: plain.toString('utf8').slice(0, 4000),
              ts: numericTs(env.ts),
              identity: msgIdentity,
            })
            return
          }
          emitContractToRenderer(chatMessageContract, {
            room,
            id,
            nick: msgIdentity.name,
            text: String(env.text ?? '').slice(0, 4000),
            ts: numericTs(env.ts),
            self: Boolean(env.key && env.key === ownKey),
            deviceKey: env.key,
            identity: msgIdentity,
          })
        } catch (err) {
          log.warn(`chat: ignoring bad overlay payload: ${toError(err).message}`)
        }
      })()
    })
    try {
      const peerId = await bridge.overlayConnectAndJoin(cand.adnl, overlayId)

      const keepalive = setInterval(() => {
        bridge.adnlPing(peerId).catch(() => {})
      }, 10_000)

      const connectedSession: ChatRuntimeSession = {
        room,
        overlayId,
        via: cand.via,
        bootstrap,
        peerId,
        gated: parsed.gated,
        ownerKey: parsed.ownerKey,
        cert: null,
        async dispose() {
          clearInterval(keepalive)
          unsub()
          await bridge.overlayLeaveAndDisconnect(overlayId, peerId).catch(() => {})
          log.debug('chat: left room')
        },
      }

      announcePresence(connectedSession, bridge, identity, membership, seed, room).catch((err) =>
        log.warn(`chat: presence announce failed (will register on first send): ${toError(err).message}`)
      )

      log.event('info', 'chat.room.joined', 'chat room joined', { via: cand.via, candidates: candidates.length })
      return connectedSession
    } catch (err) {
      unsub()
      lastErr = toError(err)
      log.event('warn', 'chat.candidate.failed', 'chat connection candidate failed', {
        via: cand.via,
        error: lastErr,
      })
    }
  }
  ipcFailure('ROOM_UNAVAILABLE', `Could not connect to any node for room "${room}"`, true, lastErr)
}

export function registerChatHandlers(registry: ServiceRegistry): void {
  const { walletManager, chatSessionController, tonIndexerClient } = registry
  const identity = new ChatIdentityManager(walletManager)
  const membership = new ChatMembership()
  const recentGrants = new Map<string, number>()

  secureContractHandle(chatConnectContract, async (roomArg?: string, nodeArg?: string) => {
    let room: string
    let bootstrap: string | undefined
    try {
      room = normalizeRoom(roomArg)
    } catch {
      ipcFailure('INVALID_ROOM', 'Invalid room name')
    }
    try {
      bootstrap = normalizeNodeId(nodeArg)
    } catch {
      ipcFailure('INVALID_NODE_ID', 'Invalid node id')
    }

    const connected = await chatSessionController.connect(room, async ({ markJoining }) => {
      if (!getSetting('messenger').networkEnabled) {
        ipcFailure('MESSENGER_DISABLED', 'Messenger networking is disabled')
      }
      const bridge = walletManager.getMessengerBridge()
      if (!bridge) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')

      return connectRoom(
        chatSessionController,
        recentGrants,
        bridge,
        identity,
        membership,
        (d) => walletManager.resolveDomain(d),
        room,
        bootstrap,
        markJoining
      )
    })
    return { connected: true as const, room: connected.room, via: connected.via }
  })

  secureContractHandle(chatSendContract, async (text) => {
    const bridge = walletManager.getMessengerBridge()
    const session = chatSessionController.session
    if (!bridge || !session) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    if (session.gated && !session.cert) {
      return { sent: false, pendingMembership: true, identity: await ownIdentityView(identity) }
    }
    const attach = getSetting('messenger').attachWalletIdentity
    const proof = attach ? await identity.ensureProof() : null
    const domain = attach ? await identity.claimedDomain() : null
    const seed = await identity.deviceSeed()
    const env = buildSigned(
      seed,
      {
        type: 'msg',
        nick: wireNick(proof, domain),
        text: truncateUtf8(String(text), MAX_TEXT_BYTES),
        ts: Date.now(),
        room: session.room,
      },
      proof
    )
    try {
      await sendEnvelope(bridge, session.overlayId, env, seed, session.cert)
    } catch (error) {
      ipcFailure('SEND_FAILED', 'Unable to send message', true, error)
    }
    let identityView: OwnChatIdentity | undefined
    try {
      identityView = await ownIdentityView(identity)
    } catch (error) {
      log.warn(`chat: sent message but identity refresh failed: ${toError(error).message}`)
    }
    return { sent: true, identity: identityView }
  })

  secureContractHandle(chatCreateRoomContract, async (displayArg) => {
    let display: string
    try {
      display = normalizeRoom(displayArg)
    } catch {
      ipcFailure('INVALID_ROOM', 'Invalid room name')
    }
    if (display.includes('#')) ipcFailure('INVALID_ROOM', 'Room name must not contain "#"')
    try {
      parseRoomName(display)
    } catch {
      ipcFailure('INVALID_ROOM', 'Invalid room name')
    }
    try {
      const full = await membership.createGatedRoom(display)
      return { room: full }
    } catch (error) {
      ipcFailure('ROOM_CREATE_FAILED', 'Unable to create room', false, error)
    }
  })

  secureContractHandle(chatDmSendContract, async (peerKeyArg, text) => {
    const bridge = walletManager.getMessengerBridge()
    const session = chatSessionController.session
    if (!bridge || !session) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    const peerKey = String(peerKeyArg ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(peerKey)) ipcFailure('INVALID_RECIPIENT', 'Invalid recipient key')
    const ownKey = await identity.devicePub()
    if (peerKey === ownKey) ipcFailure('INVALID_RECIPIENT', 'Cannot send a direct message to yourself')
    if (session.gated && !session.cert) {
      return { sent: false, pendingMembership: true, identity: await ownIdentityView(identity) }
    }
    const attach = getSetting('messenger').attachWalletIdentity
    const proof = attach ? await identity.ensureProof() : null
    const domain = attach ? await identity.claimedDomain() : null
    const seed = await identity.deviceSeed()
    const plain = truncateUtf8(String(text), 1400)
    const box = sealDM(seed, Buffer.from(peerKey, 'hex'), Buffer.from(plain, 'utf8'))
    const env = buildSigned(
      seed,
      {
        type: 'dm',
        nick: wireNick(proof, domain),
        text: box.toString('base64'),
        ts: Date.now(),
        room: session.room,
        to: peerKey,
      },
      proof
    )
    try {
      await sendEnvelope(bridge, session.overlayId, env, seed, session.cert)
    } catch (error) {
      ipcFailure('SEND_FAILED', 'Unable to send direct message', true, error)
    }
    let identityView: OwnChatIdentity | undefined
    try {
      identityView = await ownIdentityView(identity)
    } catch (error) {
      log.warn(`chat: sent direct message but identity refresh failed: ${toError(error).message}`)
    }
    return { sent: true, id: String(env.sig ?? '').slice(0, 32), ts: env.ts, identity: identityView }
  })

  secureContractHandle(chatIdentityContract, async () => {
    try {
      return await ownIdentityView(identity)
    } catch (error) {
      ipcFailure('IDENTITY_FAILED', 'Unable to read chat identity', false, error)
    }
  })

  secureContractHandle(chatLinkIdentityContract, async () => {
    try {
      await identity.relink()
      return await ownIdentityView(identity)
    } catch (error) {
      ipcFailure('IDENTITY_FAILED', 'Unable to link chat identity', false, error)
    }
  })

  secureContractHandle(chatClaimDomainContract, async (domain) => {
    if (!isTonDomain(domain)) ipcFailure('INVALID_DOMAIN', 'Invalid .ton domain')
    try {
      const res = await identity.claimDomain(domain)
      return { ...res, identity: await ownIdentityView(identity) }
    } catch (error) {
      ipcFailure('DOMAIN_CLAIM_FAILED', 'Unable to claim domain', false, error)
    }
  })

  secureContractHandle(chatClearDomainContract, async () => {
    try {
      await identity.clearDomain()
      return await ownIdentityView(identity)
    } catch (error) {
      ipcFailure('IDENTITY_FAILED', 'Unable to clear claimed domain', false, error)
    }
  })

  secureContractHandle(chatDetectDomainsContract, async () => {
    const own = await identity.ownIdentity()
    if (!own.address) return { domains: [] }
    if (!tonIndexerClient.isEnabled()) {
      ipcFailure('DOMAIN_DETECTION_FAILED', 'Enable HTTP indexer fallback in Wallet settings to detect domains')
    }
    try {
      return { domains: await ownedDomains(tonIndexerClient, own.address) }
    } catch (err) {
      log.warn(`chat: domain detection failed: ${toError(err).message}`)
      ipcFailure('DOMAIN_DETECTION_FAILED', 'Unable to detect owned domains', true, err)
    }
  })

  secureContractHandle(chatResetIdentityContract, async () => {
    try {
      await chatSessionController.disconnect()
      await identity.resetIdentity()
      await membership.clear()
      return await ownIdentityView(identity)
    } catch (error) {
      ipcFailure('IDENTITY_FAILED', 'Unable to reset chat identity', false, error)
    }
  })

  secureContractHandle(chatDisconnectContract, async () => {
    try {
      await chatSessionController.disconnect()
      return { disconnected: true as const }
    } catch (error) {
      ipcFailure('DISCONNECT_FAILED', 'Unable to disconnect chat', true, error)
    }
  })
}
