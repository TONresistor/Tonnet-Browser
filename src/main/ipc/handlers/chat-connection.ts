import { chatDmMessageContract, chatMessageContract } from '../../../shared/ipc-contract/chat'
import { broadcastId, parseBroadcast, sealBroadcast, verifyBroadcast } from '../../chat/broadcast'
import { verifyCertificate, CERT_MAX_SIZE } from '../../chat/cert'
import { ChatMembership } from '../../chat/membership'
import { marshalEnvelope, parseEnvelope, signEnvelope, MAX_TEXT_BYTES, type WireEnvelope } from '../../chat/envelope'
import { deriveWalletAddress, shortAddress } from '../../chat/tonproof'
import { classify } from '../../chat/verify'
import { openDM } from '../../chat/dm'
import { verifyDomainOwnership, type ResolveFn } from '../../chat/resolve'
import { ChatIdentityManager, type ChatProof } from '../../chat/identity'
import { getSetting } from '../../settings'
import { emitContractToRenderer } from '../../events/renderer-events'
import type { MessengerBridgePort } from '../../ports/ton-bridge'
import type { ChatRuntimeSession, ChatSessionController } from '../../chat/session-controller'
import { isAcceptableFrameDate, measureClockOffset } from '../../chat/time'
import { requestBindingChallenge } from '../../chat/binding'
import { overlayIdB64ForRoom, parseRoomName } from '../../chat/room'
import {
  CHAT_RECEIVE_CONCURRENCY,
  CHAT_RECEIVE_MAX_PENDING,
  OrderedReceiveQueue,
} from '../../chat/ordered-receive-queue'
import type { ChatIdentityInfo } from '../../../shared/types'
import { ipcFailure } from '../contract-handler'
import { log, toError } from './shared'

type Via = 'node' | 'dht'

interface Candidate {
  adnl: string
  via: Via
}

type PreparedReceive =
  | { kind: 'ignore' }
  | { kind: 'enrollment'; env: WireEnvelope }
  | {
      kind: 'dm'
      id: string
      peerKey: string
      text: string
      ts: number
      identity: ChatIdentityInfo
    }
  | {
      kind: 'message'
      id: string
      nick: string
      text: string
      ts: number
      self: boolean
      deviceKey: string
      identity: ChatIdentityInfo
    }

const RECV_DEDUP_CAP = 8192
const GRANT_COOLDOWN_S = 60

async function* resolveCandidates(
  bridge: MessengerBridgePort,
  room: string,
  bootstrap?: string
): AsyncGenerator<Candidate> {
  const seen = new Set<string>()
  let count = 0
  const add = (adnl: string, via: Via): Candidate | null => {
    if (adnl && !seen.has(adnl)) {
      seen.add(adnl)
      count++
      return { adnl, via }
    }
    return null
  }

  if (bootstrap) {
    const candidate = add(bootstrap, 'node')
    if (candidate) yield candidate
  }

  try {
    const discovered = await bridge.dhtFindOverlayNodes(Buffer.from(room, 'utf8').toString('base64'))
    const nodes = [...discovered.nodes]
    for (let i = nodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
    }
    for (const node of nodes) {
      if (count >= 8) break
      const candidate = add(node.adnl_id, 'dht')
      if (candidate) yield candidate
    }
  } catch (err) {
    log.event('warn', 'chat.discovery.failed', 'chat node discovery failed', { error: toError(err) })
  }
}

export function experimentalGatedRoomsEnabled(): boolean {
  return process.env.TONNET_EXPERIMENTAL_GATED_ROOMS === '1'
}

function displayTimestamp(value: unknown, receivedAtSec: number): number {
  const receivedAtMs = receivedAtSec * 1_000
  const n = Number(value)
  const min = receivedAtMs - (6 * 60 * 60 + 5 * 60) * 1_000
  const max = receivedAtMs + 5 * 60 * 1_000
  return Number.isFinite(n) && n >= min && n <= max ? n : receivedAtMs
}

export function wireNick(proof: ChatProof | null, domain: string | null): string {
  if (!proof) return ''
  if (domain) return domain
  const address = deriveWalletAddress(proof.wkey)
  return address ? shortAddress(address) : ''
}

export function buildSigned(
  seed: Buffer,
  base: Omit<WireEnvelope, 'key' | 'sig'>,
  proof: ChatProof | null
): WireEnvelope {
  const env: WireEnvelope = { ...base }
  if (proof) {
    env.wkey = proof.wkey
    env.wsig = proof.wsig
    env.wts = proof.wts
    env.wexp = proof.wexp
  }
  return signEnvelope(env, seed)
}

export async function sendEnvelope(
  bridge: MessengerBridgePort,
  overlayId: string,
  env: WireEnvelope,
  seed: Buffer,
  cert?: Buffer | null,
  clockOffsetSec = 0
): Promise<string> {
  const data = marshalEnvelope(env)
  const wire = sealBroadcast(seed, data, Math.floor(Date.now() / 1000) + clockOffsetSec, cert ?? undefined)
  const frame = parseBroadcast(wire)
  if (!frame) throw new Error('failed to parse locally sealed broadcast')
  const id = broadcastId(frame.src, frame.data, frame.flags).toString('hex')
  await bridge.overlaySendRaw(overlayId, wire.toString('base64'))
  return id
}

export async function announcePresence(
  session: ChatRuntimeSession,
  bridge: MessengerBridgePort,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  seed: Buffer,
  room: string,
  isActive: () => boolean = () => true
): Promise<void> {
  if (!isActive() || session.room !== room) return
  const attach = getSetting('messenger').attachWalletIdentity
  const [proof, domain] = attach ? await Promise.all([identity.currentProof(), identity.claimedDomain()]) : [null, null]
  if (!isActive()) return
  if (session.gated && session.ownerKey && !session.cert) {
    const ownHex = await identity.devicePub()
    const ownBuf = Buffer.from(ownHex, 'hex')
    const ownerHex = session.ownerKey.toString('hex')
    session.cert = (await membership.isOwner(ownerHex))
      ? await membership.issue(room, ownerHex, ownBuf, nowSec())
      : await membership.validCert(room, ownBuf, session.ownerKey, nowSec())
    if (!isActive()) return
  }
  if (session.gated && !session.cert) {
    const req = buildSigned(
      seed,
      { type: 'cert-req', nick: '', text: session.bindingChallenge, ts: Date.now(), room },
      proof
    )
    await sendEnvelope(bridge, session.overlayId, req, seed, null, session.clockOffsetSec)
    log.event('info', 'chat.membership.requested', 'chat membership requested')
    return
  }
  const hello = buildSigned(
    seed,
    { type: 'hello', nick: wireNick(proof, domain), text: session.bindingChallenge, ts: Date.now(), room },
    proof
  )
  await sendEnvelope(bridge, session.overlayId, hello, seed, session.cert, session.clockOffsetSec)
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
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
  env: WireEnvelope,
  isActive: () => boolean
): Promise<void> {
  if (!isActive() || session.room !== room || !session.ownerKey) return

  if (env.type === 'cert-req' && env.key) {
    const ownerHex = session.ownerKey.toString('hex')
    if (!(await membership.isOwner(ownerHex))) return
    const reqKey = `${room}:${env.key.toLowerCase()}`
    if ((recentGrants.get(reqKey) ?? 0) > nowSec()) return
    const cert = await membership.issue(room, ownerHex, Buffer.from(env.key, 'hex'), nowSec())
    if (!isActive() || !cert) return
    if (recentGrants.size >= RECV_DEDUP_CAP) {
      const oldest = recentGrants.keys().next().value
      if (oldest !== undefined) recentGrants.delete(oldest)
    }
    recentGrants.set(reqKey, nowSec() + GRANT_COOLDOWN_S)
    const [proof, domain] = await Promise.all([identity.currentProof(), identity.claimedDomain()])
    if (!isActive()) return
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
    await sendEnvelope(bridge, session.overlayId, grant, seed, session.cert, session.clockOffsetSec)
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
    if (!isActive()) return
    session.cert = cert
    log.event('info', 'chat.membership.received', 'chat membership certificate received')
    await announcePresence(session, bridge, identity, membership, seed, room, isActive).catch(() => {})
  }
}

export async function connectRoom(
  controller: ChatSessionController<ChatRuntimeSession>,
  recentGrants: Map<string, number>,
  bridge: MessengerBridgePort,
  identity: ChatIdentityManager,
  membership: ChatMembership,
  resolveDomain: ResolveFn,
  room: string,
  bootstrap: string | undefined,
  markJoining: () => void,
  onLivenessLost: (session: ChatRuntimeSession) => void
): Promise<ChatRuntimeSession> {
  let parsed: ReturnType<typeof parseRoomName>
  try {
    parsed = parseRoomName(room)
  } catch {
    ipcFailure('INVALID_ROOM', 'Invalid room name')
  }
  if (parsed.gated && !experimentalGatedRoomsEnabled()) {
    ipcFailure('EXPERIMENTAL_FEATURE_DISABLED', 'Gated rooms require TONNET_EXPERIMENTAL_GATED_ROOMS=1')
  }
  const overlayId = overlayIdB64ForRoom(room)
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
  let candidateCount = 0
  for await (const cand of resolveCandidates(bridge, room, bootstrap)) {
    candidateCount++
    let active = false
    let clockOffsetSec: number | null = null
    const receiveQueue = new OrderedReceiveQueue<string, PreparedReceive>({
      maxPending: CHAT_RECEIVE_MAX_PENDING,
      concurrency: CHAT_RECEIVE_CONCURRENCY,
      process: async (message) => {
        if (!active) return { kind: 'ignore' }
        const frame = parseBroadcast(Buffer.from(message, 'base64'))
        if (!frame || !verifyBroadcast(frame)) return { kind: 'ignore' }
        const receivedAt = nowSec()
        if (!isAcceptableFrameDate(frame.date, receivedAt, clockOffsetSec ?? 0)) return { kind: 'ignore' }
        const id = broadcastId(frame.src, frame.data, frame.flags).toString('hex')
        if (!firstSeen(id)) return { kind: 'ignore' }
        const env = parseEnvelope(frame.data)
        const deviceKey = env.key?.toLowerCase()
        if (!deviceKey || deviceKey !== frame.src.toString('hex')) return { kind: 'ignore' }

        if (env.type === 'cert-req' || env.type === 'cert-grant') {
          const verdict = classify(env, room, receivedAt)
          if (verdict.drop) {
            log.event('warn', 'chat.enrollment.dropped', 'chat enrollment message dropped', {
              reason: verdict.reason,
            })
            return { kind: 'ignore' }
          }
          return { kind: 'enrollment', env }
        }

        const isDm = env.type === 'dm'
        if (env.type && env.type !== 'msg' && !isDm) return { kind: 'ignore' }
        if (
          Buffer.byteLength(env.text ?? '', 'utf8') > MAX_TEXT_BYTES ||
          Buffer.byteLength(env.nick ?? '', 'utf8') > 64
        ) {
          return { kind: 'ignore' }
        }
        if (isDm && env.to !== ownKey) return { kind: 'ignore' }
        const verdict = classify(env, room, receivedAt)
        if (verdict.drop) {
          log.event('warn', 'chat.message.dropped', 'chat message dropped', { reason: verdict.reason })
          return { kind: 'ignore' }
        }

        let msgIdentity = verdict.identity
        if (msgIdentity.tier === 'wallet' && msgIdentity.address && env.nick) {
          const claim = env.nick.trim().toLowerCase()
          if (await verifyDomainOwnership(claim, msgIdentity.address, resolveDomain, receivedAt)) {
            msgIdentity = { ...msgIdentity, tier: 'domain', name: claim, domain: claim }
          }
        }
        if (!active) return { kind: 'ignore' }

        if (isDm) {
          let plain: Buffer
          try {
            plain = openDM(seed, Buffer.from(deviceKey, 'hex'), Buffer.from(String(env.text ?? ''), 'base64'))
          } catch {
            log.event('warn', 'chat.dm.decrypt_failed', 'chat direct message could not be decrypted')
            return { kind: 'ignore' }
          }
          return {
            kind: 'dm',
            id: String(env.sig ?? '').slice(0, 32),
            peerKey: deviceKey,
            text: plain.toString('utf8').slice(0, 4000),
            ts: displayTimestamp(env.ts, receivedAt),
            identity: msgIdentity,
          }
        }

        return {
          kind: 'message',
          id,
          nick: msgIdentity.name,
          text: String(env.text ?? '').slice(0, 4000),
          ts: displayTimestamp(env.ts, receivedAt),
          self: deviceKey === ownKey,
          deviceKey,
          identity: msgIdentity,
        }
      },
      commit: async (prepared) => {
        if (!active || prepared.kind === 'ignore') return
        if (prepared.kind === 'enrollment') {
          const activeSession = controller.session
          if (!activeSession) return
          await handleEnrollment(
            activeSession,
            recentGrants,
            bridge,
            identity,
            membership,
            seed,
            room,
            ownKey,
            prepared.env,
            () => active
          )
          return
        }
        if (prepared.kind === 'dm') {
          emitContractToRenderer(chatDmMessageContract, {
            room,
            id: prepared.id,
            peerKey: prepared.peerKey,
            text: prepared.text,
            ts: prepared.ts,
            identity: prepared.identity,
          })
          return
        }
        emitContractToRenderer(chatMessageContract, {
          room,
          id: prepared.id,
          nick: prepared.nick,
          text: prepared.text,
          ts: prepared.ts,
          self: prepared.self,
          deviceKey: prepared.deviceKey,
          identity: prepared.identity,
        })
      },
      onError: (error) => {
        log.warn(`chat: ignoring bad overlay payload: ${toError(error).message}`)
      },
      onOverflow: (pending) => {
        log.event('warn', 'chat.receive_queue.saturated', 'chat receive queue saturated', {
          pending,
          maxPending: CHAT_RECEIVE_MAX_PENDING,
        })
      },
      onRecovered: (dropped) => {
        log.event('info', 'chat.receive_queue.recovered', 'chat receive queue recovered', { dropped })
      },
    })
    const unsub = bridge.onOverlayMessage((data) => {
      if (!active || data.overlay_id !== overlayId) return
      receiveQueue.enqueue(data.message)
    })
    let peerId: string | null = null
    try {
      peerId = await bridge.overlayConnectAndJoin(cand.adnl, overlayId)
      const connectedPeerId = peerId
      clockOffsetSec = await measureClockOffset(bridge, overlayId)
      const bindingChallenge = await requestBindingChallenge(bridge, overlayId, nowSec() + clockOffsetSec)
      let disposed = false
      let pinging = false
      let announcing = false
      let consecutiveFailures = 0
      let keepalive: ReturnType<typeof setInterval> | null = null
      let presence: ReturnType<typeof setInterval> | null = null
      const connectedSession: ChatRuntimeSession = {
        room,
        overlayId,
        via: cand.via,
        bootstrap,
        peerId: connectedPeerId,
        clockOffsetSec,
        bindingChallenge: bindingChallenge.nonceHex,
        gated: parsed.gated,
        ownerKey: parsed.ownerKey,
        cert: null,
        async dispose() {
          if (disposed) return
          disposed = true
          active = false
          receiveQueue.close()
          if (keepalive) clearInterval(keepalive)
          if (presence) clearInterval(presence)
          unsub()
          await bridge.overlayLeaveAndDisconnect(overlayId, connectedPeerId).catch(() => {})
          log.debug('chat: left room')
        },
      }
      active = true
      await announcePresence(connectedSession, bridge, identity, membership, seed, room, () => active)

      keepalive = setInterval(() => {
        if (disposed || pinging) return
        pinging = true
        bridge
          .adnlPing(connectedPeerId)
          .then(() => {
            consecutiveFailures = 0
          })
          .catch(() => {
            consecutiveFailures++
            if (consecutiveFailures >= 3 && !disposed) {
              if (keepalive) clearInterval(keepalive)
              onLivenessLost(connectedSession)
            }
          })
          .finally(() => {
            pinging = false
          })
      }, 10_000)
      presence = setInterval(() => {
        if (!active || disposed || announcing) return
        announcing = true
        void (async () => {
          try {
            const challenge = await requestBindingChallenge(
              bridge,
              overlayId,
              nowSec() + connectedSession.clockOffsetSec
            )
            if (!active || disposed) return
            connectedSession.bindingChallenge = challenge.nonceHex
            await announcePresence(connectedSession, bridge, identity, membership, seed, room, () => active)
          } catch (err) {
            log.warn(`chat: periodic presence failed: ${toError(err).message}`)
          } finally {
            announcing = false
          }
        })()
      }, 60_000)

      log.event('info', 'chat.room.joined', 'chat room joined', { via: cand.via, candidates: candidateCount })
      return connectedSession
    } catch (err) {
      active = false
      receiveQueue.close()
      unsub()
      if (peerId) await bridge.overlayLeaveAndDisconnect(overlayId, peerId).catch(() => {})
      lastErr = toError(err)
      log.event('warn', 'chat.candidate.failed', 'chat connection candidate failed', {
        via: cand.via,
        error: lastErr,
      })
    }
  }
  if (candidateCount === 0) {
    ipcFailure(
      'ROOM_UNAVAILABLE',
      `No nodes found for room "${room}". Its nodes may be offline, or the room is new and not yet ` +
        `discoverable on the network. Paste a known node id to connect directly.`,
      true
    )
  }
  ipcFailure('ROOM_UNAVAILABLE', `Could not connect to any node for room "${room}"`, true, lastErr)
}
