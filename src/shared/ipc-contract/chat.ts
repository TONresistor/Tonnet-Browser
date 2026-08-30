import { z } from 'zod'
import { defineEvent, defineRequest } from './definition'
import { CHAT_CHANNELS } from './channels'

export const ChatIdentityInfoSchema = z.object({
  tier: z.enum(['domain', 'wallet', 'device']),
  name: z.string(),
  address: z.string().optional(),
  addressShort: z.string().optional(),
  domain: z.string().optional(),
  fingerprint: z.string().optional(),
})

export const OwnChatIdentitySchema = z.object({
  deviceKey: z.string().regex(/^[0-9a-f]{64}$/i),
  linked: z.boolean(),
  declined: z.boolean(),
  walletReady: z.boolean(),
  address: z.string().optional(),
  addressShort: z.string().optional(),
  domain: z.string().optional(),
})

const mainBase = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
const optionalInput = z.string().min(1).max(4_096).optional()
const sendResult = z.object({
  sent: z.boolean(),
  needsLink: z.boolean().optional(),
  pendingMembership: z.boolean().optional(),
  identity: OwnChatIdentitySchema.optional(),
})
const publicSendResult = z.discriminatedUnion('sent', [
  z.object({
    sent: z.literal(true),
    id: z.string().regex(/^[0-9a-f]{64}$/),
    ts: z.number().finite(),
    identity: OwnChatIdentitySchema.optional(),
  }),
  z.object({
    sent: z.literal(false),
    needsLink: z.boolean().optional(),
    pendingMembership: z.boolean().optional(),
    identity: OwnChatIdentitySchema.optional(),
  }),
])

export const chatConnectContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.connect,
  input: z.tuple([optionalInput, optionalInput]),
  output: z.object({ connected: z.literal(true), room: z.string().min(1), via: z.enum(['node', 'dht']) }),
  errors: [
    'INVALID_ROOM',
    'INVALID_NODE_ID',
    'MESSENGER_DISABLED',
    'BRIDGE_DISCONNECTED',
    'ROOM_UNAVAILABLE',
    'EXPERIMENTAL_FEATURE_DISABLED',
  ],
})
export const chatSendContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.send,
  input: z.tuple([z.string().max(16_384)]),
  output: publicSendResult,
  errors: ['CHAT_DISCONNECTED', 'SEND_FAILED'],
  redaction: 'secret',
})
export const chatDmSendContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.dmSend,
  input: z.tuple([z.string().regex(/^[0-9a-f]{64}$/i), z.string().max(16_384)]),
  output: sendResult.extend({ id: z.string().optional(), ts: z.number().finite().optional() }),
  errors: ['CHAT_DISCONNECTED', 'INVALID_RECIPIENT', 'SEND_FAILED'],
  redaction: 'secret',
})
export const chatCreateRoomContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.createRoom,
  input: z.tuple([z.string().min(1).max(512)]),
  output: z.object({ room: z.string().min(1) }),
  errors: ['INVALID_ROOM', 'ROOM_CREATE_FAILED', 'EXPERIMENTAL_FEATURE_DISABLED'],
})
export const chatDisconnectContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.disconnect,
  input: z.tuple([]),
  output: z.object({ disconnected: z.literal(true) }),
  errors: ['DISCONNECT_FAILED'],
})
const identityRequest = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...mainBase,
    channel,
    input: z.tuple([]),
    output: OwnChatIdentitySchema,
    errors: ['IDENTITY_FAILED'],
  })
export const chatIdentityContract = identityRequest(CHAT_CHANNELS.identity)
export const chatLinkIdentityContract = identityRequest(CHAT_CHANNELS.linkIdentity)
export const chatClearDomainContract = identityRequest(CHAT_CHANNELS.clearDomain)
export const chatResetIdentityContract = identityRequest(CHAT_CHANNELS.resetIdentity)
export const chatClaimDomainContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.claimDomain,
  input: z.tuple([z.string().min(1).max(253)]),
  output: z.object({ ok: z.boolean(), reason: z.string().optional(), identity: OwnChatIdentitySchema }),
  errors: ['INVALID_DOMAIN', 'DOMAIN_CLAIM_FAILED'],
})
export const chatDetectDomainsContract = defineRequest({
  ...mainBase,
  channel: CHAT_CHANNELS.detectDomains,
  input: z.tuple([]),
  output: z.object({ domains: z.array(z.string().min(1).max(253)).max(10_000) }),
  errors: ['DOMAIN_DETECTION_FAILED'],
})

export const ChatMessageSchema = z.object({
  room: z.string().optional(),
  id: z.string().min(1),
  nick: z.string(),
  text: z.string().max(4_000),
  ts: z.number().finite(),
  self: z.boolean().optional(),
  deviceKey: z.string().optional(),
  identity: ChatIdentityInfoSchema,
})
export const ChatDmMessageSchema = z.object({
  room: z.string().optional(),
  id: z.string().min(1),
  peerKey: z.string().regex(/^[0-9a-f]{64}$/i),
  text: z.string().max(4_000),
  ts: z.number().finite(),
  identity: ChatIdentityInfoSchema,
})
export const chatMessageContract = defineEvent({
  channel: CHAT_CHANNELS.message,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatMessageSchema]),
  redaction: 'secret',
})
export const chatDmMessageContract = defineEvent({
  channel: CHAT_CHANNELS.dmMessage,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ChatDmMessageSchema]),
  redaction: 'secret',
})
export const chatConnectionContract = defineEvent({
  channel: CHAT_CHANNELS.connection,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([
    z.object({
      room: z.string().min(1),
      status: z.enum(['reconnecting', 'connected', 'error']),
      attempt: z.number().int().positive().optional(),
    }),
  ]),
  redaction: 'public',
})

export const CHAT_REQUEST_CONTRACTS = [
  chatConnectContract,
  chatSendContract,
  chatDmSendContract,
  chatCreateRoomContract,
  chatDisconnectContract,
  chatIdentityContract,
  chatLinkIdentityContract,
  chatClaimDomainContract,
  chatClearDomainContract,
  chatDetectDomainsContract,
  chatResetIdentityContract,
] as const
export const CHAT_EVENT_CONTRACTS = [chatMessageContract, chatDmMessageContract, chatConnectionContract] as const
