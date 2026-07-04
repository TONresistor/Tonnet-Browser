import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { normalizeRoom, normalizeNodeId, overlayIdB64ForRoom, parseOverlayNodes } from '../../chat/room'
import { signEnvelope, type WireEnvelope } from '../../chat/envelope'
import { deriveWalletAddress, shortAddress } from '../../chat/tonproof'
import { classify } from '../../chat/verify'
import { verifyDomainOwnership, type ResolveFn } from '../../chat/resolve'
import { ChatIdentityManager, type ChatProof } from '../../chat/identity'
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
  unsub: () => void
  keepalive: NodeJS.Timeout
}

interface Candidate {
  adnl: string
  via: Via
}

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

async function sendEnvelope(bridge: WsBridgeClient, overlayId: string, env: WireEnvelope): Promise<void> {
  await bridge.overlaySend(overlayId, Buffer.from(JSON.stringify(env), 'utf-8').toString('base64'))
}

async function connectRoom(
  bridge: WsBridgeClient,
  identity: ChatIdentityManager,
  resolveDomain: ResolveFn,
  room: string,
  bootstrap?: string
): Promise<{ room: string; via: Via }> {
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

  let lastErr: Error | null = null
  for (const cand of candidates) {
    const unsub = bridge.onOverlayMessage((data) => {
      if (data.overlay_id !== overlayId) return
      void (async () => {
        try {
          const env = JSON.parse(Buffer.from(data.message, 'base64').toString('utf-8')) as WireEnvelope
          if (env.type && env.type !== 'msg') return
          if ((env.text?.length ?? 0) > 8000 || (env.nick?.length ?? 0) > 256) return
          const nowSec = Math.floor(Date.now() / 1000)
          const verdict = classify(env, room, nowSec)
          if (verdict.drop) {
            log.warn(`chat: dropped message in ${room}: ${verdict.reason}`)
            return
          }
          let identity = verdict.identity
          if (identity.tier === 'wallet' && identity.address && env.nick) {
            const claim = env.nick.trim().toLowerCase()
            if (await verifyDomainOwnership(claim, identity.address, resolveDomain, nowSec)) {
              identity = { ...identity, tier: 'domain', name: claim, domain: claim }
            }
          }
          emitToRenderer(IPC_CHANNELS.CHAT_MESSAGE, {
            room,
            nick: identity.name,
            text: String(env.text ?? '').slice(0, 4000),
            ts: Number(env.ts ?? Date.now()),
            self: Boolean(env.key && env.key === ownKey),
            identity,
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

      session = { room, overlayId, via: cand.via, bootstrap, peerId, unsub, keepalive }

      Promise.all([identity.currentProof(), identity.claimedDomain()])
        .then(([proof, domain]) => {
          const hello = buildSigned(
            seed,
            { type: 'hello', nick: wireNick(proof, domain), text: '', ts: Date.now(), room },
            proof
          )
          return sendEnvelope(bridge, overlayId, hello)
        })
        .catch((err) => log.warn(`chat: hello failed (will register on first send): ${toError(err).message}`))

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
  const { walletManager, overlayManager } = registry
  const identity = new ChatIdentityManager(walletManager, overlayManager)

  secureHandle(IPC_CHANNELS.CHAT_CONNECT, async (roomArg?: string, nodeArg?: string) => {
    const room = normalizeRoom(roomArg)
    const bootstrap = normalizeNodeId(nodeArg)

    const run = connectChain
      .catch(() => {})
      .then(async () => {
        const bridge = walletManager.getBridgeClient()
        if (!bridge) throw new Error('Bridge not connected. Connect the proxy first')

        if (session) await teardownSession(bridge)

        const { via } = await connectRoom(bridge, identity, (d) => walletManager.resolveDomain(d), room, bootstrap)
        return { connected: true, room, via }
      })
    connectChain = run
    return run
  })

  secureHandle(IPC_CHANNELS.CHAT_SEND, async (text: string) => {
    const bridge = walletManager.getBridgeClient()
    if (!bridge || !session) throw new Error('Chat not connected')
    const proof = await identity.ensureProof()
    if (!proof) return { sent: false, needsLink: true, identity: await identity.ownIdentity() }
    const domain = await identity.claimedDomain()
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
    await sendEnvelope(bridge, session.overlayId, env)
    return { sent: true }
  })

  secureHandle(IPC_CHANNELS.CHAT_IDENTITY, async () => identity.ownIdentity())

  secureHandle(IPC_CHANNELS.CHAT_IDENTITY_LINK, async () => {
    await identity.relink()
    return identity.ownIdentity()
  })

  secureHandle(IPC_CHANNELS.CHAT_CLAIM_DOMAIN, async (domain: string) => {
    const res = await identity.claimDomain(String(domain ?? ''))
    return { ...res, identity: await identity.ownIdentity() }
  })

  secureHandle(IPC_CHANNELS.CHAT_CLEAR_DOMAIN, async () => {
    await identity.clearDomain()
    return identity.ownIdentity()
  })

  secureHandle(IPC_CHANNELS.CHAT_DISCONNECT, async () => {
    await teardownSession(walletManager.getBridgeClient())
    return { disconnected: true }
  })
}
