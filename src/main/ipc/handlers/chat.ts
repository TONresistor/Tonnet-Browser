import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { normalizeRoom, normalizeNodeId, overlayIdB64ForRoom, parseOverlayNodes, parseRoomName } from '../../chat/room'
import { broadcastId, parseBroadcast, sealBroadcast, verifyBroadcast } from '../../chat/broadcast'
import { verifyCertificate, CERT_MAX_SIZE } from '../../chat/cert'
import { ChatMembership } from '../../chat/membership'
import { signEnvelope, type WireEnvelope } from '../../chat/envelope'
import { deriveWalletAddress, shortAddress } from '../../chat/tonproof'
import { classify } from '../../chat/verify'
import { sealDM, openDM } from '../../chat/dm'
import { verifyDomainOwnership, type ResolveFn } from '../../chat/resolve'
import { ChatIdentityManager, type ChatProof } from '../../chat/identity'
import type { OwnChatIdentity } from '../../../shared/types'
import { ownedDomains } from '../../chat/detect'
import { getSetting } from '../../settings'
import { secureHandle, emitToRenderer, toError, log } from './shared'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'
import type { ServiceRegistry } from '../../services'

type Via = 'node' | 'dht'

interface ChatSession {
  room: string
  overlayId: string
  via: Via
  bootstrap?: string
  peerId: string
  gated: boolean
  ownerKey?: Buffer
  cert: Buffer | null
  unsub: () => void
  keepalive: NodeJS.Timeout
}

interface Candidate {
  adnl: string
  via: Via
}

const RECV_DEDUP_CAP = 8192

let session: ChatSession | null = null
let connectChain: Promise<unknown> = Promise.resolve()

async function teardownSession(bridge: WsBridgeClient | null): Promise<void> {
  if (!session) return
  const s = session
  session = null
  clearInterval(s.keepalive)
  s.unsub()
  if (bridge) await bridge.overlayLeaveAndDisconnect(s.overlayId, s.peerId).catch(() => {})
  log.info(`chat: left room ${s.room}`)
}

async function resolveCandidates(
  bridge: WsBridgeClient,
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
      log.warn(`chat: DHT node discovery for ${room} failed: ${toError(err).message}`)
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
  bridge: WsBridgeClient,
  overlayId: string,
  env: WireEnvelope,
  seed: Buffer,
  cert?: Buffer | null
): Promise<void> {
  const data = Buffer.from(JSON.stringify(env), 'utf-8')
  const wire = sealBroadcast(seed, data, Math.floor(Date.now() / 1000), cert ?? undefined)
  await bridge.overlaySendRaw(overlayId, wire.toString('base64'))
}

async function announcePresence(
  bridge: WsBridgeClient,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  seed: Buffer,
  room: string
): Promise<void> {
  if (!session || session.room !== room) return
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
    log.info(`chat: requested membership for gated room ${room}`)
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

async function ownIdentityView(identity: ChatIdentityManager): Promise<OwnChatIdentity> {
  const id = await identity.ownIdentity()
  if (getSetting('messenger').attachWalletIdentity) return id
  return { deviceKey: id.deviceKey, linked: false, declined: false, walletReady: id.walletReady }
}

async function handleEnrollment(
  bridge: WsBridgeClient,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  seed: Buffer,
  room: string,
  ownKey: string,
  env: WireEnvelope
): Promise<void> {
  if (!session || session.room !== room || !session.ownerKey) return

  if (env.type === 'cert-req' && env.key) {
    const ownerHex = session.ownerKey.toString('hex')
    if (!(await membership.isOwner(ownerHex))) return
    const cert = await membership.issue(room, ownerHex, Buffer.from(env.key, 'hex'), nowSec())
    if (!cert) return
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
    log.info(`chat: granted membership to ${env.key.slice(0, 12)}… in ${room}`)
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
    log.info(`chat: received membership certificate for ${room}`)
    await announcePresence(bridge, identity, membership, seed, room).catch(() => {})
  }
}

async function connectRoom(
  bridge: WsBridgeClient,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  resolveDomain: ResolveFn,
  room: string,
  bootstrap?: string
): Promise<{ room: string; via: Via }> {
  const parsed = parseRoomName(room)
  const overlayId = overlayIdB64ForRoom(room)
  const candidates = await resolveCandidates(bridge, room, overlayId, bootstrap)
  if (candidates.length === 0) {
    throw new Error(
      `No nodes found for room "${room}". Its nodes may be offline, or the room is new and not yet ` +
        `discoverable on the network. Paste a known node id to connect directly.`
    )
  }

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
          if (!firstSeen(broadcastId(frame.src, frame.data, frame.flags).toString('hex'))) return
          const env = JSON.parse(frame.data.toString('utf-8')) as WireEnvelope
          if (!env.key || env.key.toLowerCase() !== frame.src.toString('hex')) return
          if (env.type === 'cert-req' || env.type === 'cert-grant') {
            await handleEnrollment(bridge, identity, membership, seed, room, ownKey, env)
            return
          }
          const isDm = env.type === 'dm'
          if (env.type && env.type !== 'msg' && !isDm) return
          if ((env.text?.length ?? 0) > (isDm ? 24000 : 8000) || (env.nick?.length ?? 0) > 256) return
          if (isDm && (env.to !== ownKey || !env.key)) return
          const nowSec = Math.floor(Date.now() / 1000)
          const verdict = classify(env, room, nowSec)
          if (verdict.drop) {
            log.warn(`chat: dropped message in ${room}: ${verdict.reason}`)
            return
          }
          let msgIdentity = verdict.identity
          if (msgIdentity.tier === 'wallet' && msgIdentity.address && env.nick) {
            const claim = env.nick.trim().toLowerCase()
            if (await verifyDomainOwnership(claim, msgIdentity.address, resolveDomain, nowSec)) {
              msgIdentity = { ...msgIdentity, tier: 'domain', name: claim, domain: claim }
            }
          }
          if (isDm) {
            let plain: Buffer
            try {
              plain = openDM(seed, Buffer.from(env.key as string, 'hex'), Buffer.from(String(env.text ?? ''), 'base64'))
            } catch {
              log.warn(`chat: undecryptable dm from ${msgIdentity.addressShort}`)
              return
            }
            emitToRenderer(IPC_CHANNELS.CHAT_DM_MESSAGE, {
              room,
              id: String(env.sig ?? '').slice(0, 32),
              peerKey: env.key as string,
              text: plain.toString('utf8').slice(0, 4000),
              ts: Number(env.ts ?? Date.now()),
              identity: msgIdentity,
            })
            return
          }
          emitToRenderer(IPC_CHANNELS.CHAT_MESSAGE, {
            room,
            nick: msgIdentity.name,
            text: String(env.text ?? '').slice(0, 4000),
            ts: Number(env.ts ?? Date.now()),
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

      session = {
        room,
        overlayId,
        via: cand.via,
        bootstrap,
        peerId,
        gated: parsed.gated,
        ownerKey: parsed.ownerKey,
        cert: null,
        unsub,
        keepalive,
      }

      announcePresence(bridge, identity, membership, seed, room).catch((err) =>
        log.warn(`chat: presence announce failed (will register on first send): ${toError(err).message}`)
      )

      log.info(`chat: joined room ${room} via ${cand.via} (${candidates.length} candidate node(s))`)
      return { room, via: cand.via }
    } catch (err) {
      unsub()
      lastErr = toError(err)
      log.warn(`chat: candidate ${cand.adnl.slice(0, 12)}… (${cand.via}) failed: ${lastErr.message}`)
    }
  }
  throw lastErr ?? new Error(`Could not connect to any node for room "${room}"`)
}

export function registerChatHandlers(registry: ServiceRegistry): void {
  const { walletManager } = registry
  const identity = new ChatIdentityManager(walletManager)
  const membership = new ChatMembership()

  secureHandle(IPC_CHANNELS.CHAT_CONNECT, async (roomArg?: string, nodeArg?: string) => {
    const room = normalizeRoom(roomArg)
    const bootstrap = normalizeNodeId(nodeArg)

    const run = connectChain
      .catch(() => {})
      .then(async () => {
        const bridge = walletManager.getBridgeClient()
        if (!bridge) throw new Error('Bridge not connected. Connect the proxy first')

        if (session) await teardownSession(bridge)

        const { via } = await connectRoom(
          bridge,
          identity,
          membership,
          (d) => walletManager.resolveDomain(d),
          room,
          bootstrap
        )
        return { connected: true, room, via }
      })
    connectChain = run
    return run
  })

  secureHandle(IPC_CHANNELS.CHAT_SEND, async (text: string) => {
    const bridge = walletManager.getBridgeClient()
    if (!bridge || !session) throw new Error('Chat not connected')
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
        text: String(text).slice(0, 4000),
        ts: Date.now(),
        room: session.room,
      },
      proof
    )
    await sendEnvelope(bridge, session.overlayId, env, seed, session.cert)
    return { sent: true, identity: await ownIdentityView(identity) }
  })

  secureHandle(IPC_CHANNELS.CHAT_CREATE_ROOM, async (displayArg: string) => {
    const display = normalizeRoom(displayArg)
    if (display.includes('#')) throw new Error('room name must not contain "#"')
    const full = await membership.createGatedRoom(display)
    return { room: full }
  })

  secureHandle(IPC_CHANNELS.CHAT_DM_SEND, async (peerKeyArg: string, text: string) => {
    const bridge = walletManager.getBridgeClient()
    if (!bridge || !session) throw new Error('Chat not connected')
    const peerKey = String(peerKeyArg ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(peerKey)) throw new Error('Bad recipient key')
    const ownKey = await identity.devicePub()
    if (peerKey === ownKey) throw new Error('Cannot DM yourself')
    if (session.gated && !session.cert) {
      return { sent: false, pendingMembership: true, identity: await ownIdentityView(identity) }
    }
    const attach = getSetting('messenger').attachWalletIdentity
    const proof = attach ? await identity.ensureProof() : null
    const domain = attach ? await identity.claimedDomain() : null
    const seed = await identity.deviceSeed()
    const plain = String(text).slice(0, 4000)
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
    await sendEnvelope(bridge, session.overlayId, env, seed, session.cert)
    return { sent: true, id: String(env.sig ?? '').slice(0, 32), ts: env.ts, identity: await ownIdentityView(identity) }
  })

  secureHandle(IPC_CHANNELS.CHAT_IDENTITY, async () => {
    return ownIdentityView(identity)
  })

  secureHandle(IPC_CHANNELS.CHAT_IDENTITY_LINK, async () => {
    await identity.relink()
    return ownIdentityView(identity)
  })

  secureHandle(IPC_CHANNELS.CHAT_CLAIM_DOMAIN, async (domain: string) => {
    const res = await identity.claimDomain(String(domain ?? ''))
    return { ...res, identity: await ownIdentityView(identity) }
  })

  secureHandle(IPC_CHANNELS.CHAT_CLEAR_DOMAIN, async () => {
    await identity.clearDomain()
    return ownIdentityView(identity)
  })

  secureHandle(IPC_CHANNELS.CHAT_DETECT_DOMAINS, async () => {
    const own = await identity.ownIdentity()
    if (!own.address) return { domains: [] }
    const wallet = getSetting('wallet')
    try {
      return { domains: await ownedDomains(own.address, wallet.indexerEndpoint, wallet.indexerApiKey || undefined) }
    } catch (err) {
      log.warn(`chat: domain detection failed: ${toError(err).message}`)
      return { domains: [] }
    }
  })

  secureHandle(IPC_CHANNELS.CHAT_RESET_IDENTITY, async () => {
    await teardownSession(walletManager.getBridgeClient())
    await identity.resetIdentity()
    await membership.clear()
    return ownIdentityView(identity)
  })

  secureHandle(IPC_CHANNELS.CHAT_DISCONNECT, async () => {
    await teardownSession(walletManager.getBridgeClient())
    return { disconnected: true }
  })
}
