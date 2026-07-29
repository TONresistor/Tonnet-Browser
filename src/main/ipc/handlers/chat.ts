import {
  chatClaimDomainContract,
  chatClearDomainContract,
  chatConnectionContract,
  chatConnectContract,
  chatCreateRoomContract,
  chatDetectDomainsContract,
  chatDisconnectContract,
  chatDmSendContract,
  chatIdentityContract,
  chatLinkIdentityContract,
  chatResetIdentityContract,
  chatSendContract,
} from '../../../shared/ipc-contract/chat'
import { normalizeRoom, normalizeNodeId, parseRoomName } from '../../chat/room'
import { ChatMembership } from '../../chat/membership'
import { MAX_TEXT_BYTES } from '../../chat/envelope'
import { sealDM } from '../../chat/dm'
import { ChatIdentityManager } from '../../chat/identity'
import type { OwnChatIdentity } from '../../../shared/types'
import { ownedDomains } from '../../chat/detect'
import { getSetting } from '../../settings'
import { isTonDomain } from '../../../shared/utils/ton'
import { toError, log } from './shared'
import { ipcFailure, secureContractHandle } from '../contract-handler'
import { emitContractToRenderer } from '../../events/renderer-events'
import type { ServiceRegistry } from '../../services'
import type { ChatRuntimeSession } from '../../chat/session-controller'
import { buildSigned, connectRoom, experimentalGatedRoomsEnabled, sendEnvelope, wireNick } from './chat-connection'

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

export function registerChatHandlers(registry: ServiceRegistry): void {
  const { walletManager, tonBridgeProviders, chatSessionController, tonIndexerClient } = registry
  const identity = new ChatIdentityManager(walletManager)
  const membership = new ChatMembership()
  const recentGrants = new Map<string, number>()
  let connectionGeneration = 0

  const establish = (
    room: string,
    bootstrap: string | undefined,
    markJoining: () => void
  ): Promise<ChatRuntimeSession> => {
    if (!getSetting('messenger').networkEnabled) {
      ipcFailure('MESSENGER_DISABLED', 'Messenger networking is disabled')
    }
    const bridge = tonBridgeProviders.messenger.getBridge()
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
      markJoining,
      beginReconnect
    )
  }

  function beginReconnect(deadSession: ChatRuntimeSession): void {
    if (chatSessionController.session !== deadSession) return
    const generation = connectionGeneration
    const delays = [1_000, 2_000, 4_000, 8_000, 15_000]
    void (async () => {
      let attempt = 0
      while (generation === connectionGeneration && getSetting('messenger').networkEnabled) {
        attempt++
        emitContractToRenderer(chatConnectionContract, {
          room: deadSession.room,
          status: 'reconnecting',
          attempt,
        })
        const baseDelay = delays[Math.min(attempt - 1, delays.length - 1)]
        await new Promise((resolve) => setTimeout(resolve, baseDelay + Math.floor(Math.random() * 500)))
        if (generation !== connectionGeneration) return
        try {
          await chatSessionController.connect(deadSession.room, ({ markJoining }) =>
            establish(deadSession.room, deadSession.bootstrap, markJoining)
          )
          if (generation !== connectionGeneration) return
          emitContractToRenderer(chatConnectionContract, { room: deadSession.room, status: 'connected' })
          return
        } catch (error) {
          log.event('warn', 'chat.reconnect.failed', 'chat reconnect attempt failed', {
            attempt,
            error: toError(error),
          })
        }
      }
      if (generation === connectionGeneration) {
        emitContractToRenderer(chatConnectionContract, { room: deadSession.room, status: 'error' })
      }
    })()
  }

  secureContractHandle(chatConnectContract, async (roomArg?: string, nodeArg?: string) => {
    connectionGeneration++
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

    const connected = await chatSessionController.connect(room, ({ markJoining }) =>
      establish(room, bootstrap, markJoining)
    )
    return { connected: true as const, room: connected.room, via: connected.via }
  })

  secureContractHandle(chatSendContract, async (text) => {
    const bridge = tonBridgeProviders.messenger.getBridge()
    const session = chatSessionController.session
    if (!bridge || !session) ipcFailure('CHAT_DISCONNECTED', 'Chat not connected')
    if (session.gated && !session.cert) {
      return { sent: false as const, pendingMembership: true, identity: await ownIdentityView(identity) }
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
    let id: string
    try {
      id = await sendEnvelope(bridge, session.overlayId, env, seed, session.cert, session.clockOffsetSec)
    } catch (error) {
      ipcFailure('SEND_FAILED', 'Unable to send message', true, error)
    }
    let identityView: OwnChatIdentity | undefined
    try {
      identityView = await ownIdentityView(identity)
    } catch (error) {
      log.warn(`chat: sent message but identity refresh failed: ${toError(error).message}`)
    }
    return { sent: true as const, id, ts: env.ts, identity: identityView }
  })

  secureContractHandle(chatCreateRoomContract, async (displayArg) => {
    if (!experimentalGatedRoomsEnabled()) {
      ipcFailure('EXPERIMENTAL_FEATURE_DISABLED', 'Gated rooms require TONNET_EXPERIMENTAL_GATED_ROOMS=1')
    }
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
    const bridge = tonBridgeProviders.messenger.getBridge()
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
      await sendEnvelope(bridge, session.overlayId, env, seed, session.cert, session.clockOffsetSec)
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
      connectionGeneration++
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
      connectionGeneration++
      await chatSessionController.disconnect()
      return { disconnected: true as const }
    } catch (error) {
      ipcFailure('DISCONNECT_FAILED', 'Unable to disconnect chat', true, error)
    }
  })
}
