import { z } from 'zod'
import { BridgeConfigPartialSchema } from '../bridge-config'
import { BRIDGE_CHANNELS } from './channels'
import { defineEvent, defineRequest } from './definition'

export const BridgeScopeSchema = z.enum(['blockchain', 'p2p', 'write'])
export const BridgePermissionSchema = z.object({
  domain: z.string().min(1).max(253),
  scope: BridgeScopeSchema,
  decision: z.enum(['granted', 'denied', 'session']),
  grantedAt: z.number().finite().nonnegative(),
})
const JsonRpcStringSchema = z
  .string()
  .min(2)
  .max(1_048_576)
  .refine(
    (value) => {
      try {
        return typeof JSON.parse(value) === 'object' && JSON.parse(value) !== null
      } catch {
        return false
      }
    },
    { message: 'Expected a JSON object' }
  )
const MutationSchema = z.object({ success: z.literal(true) })
const mainBase = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
export const bridgeSendContract = defineRequest({
  direction: 'request',
  channel: BRIDGE_CHANNELS.send,
  caller: 'tonsite',
  authorization: 'owning-tonsite-session',
  rateLimit: { kind: 'none' },
  input: z.tuple([JsonRpcStringSchema]),
  output: z.undefined(),
  errors: ['INVALID_JSON_RPC', 'UNAUTHORIZED_METHOD', 'BRIDGE_REQUEST_FAILED'],
  redaction: 'secret',
})
export const bridgeGetPermissionsContract = defineRequest({
  ...mainBase,
  channel: BRIDGE_CHANNELS.getPermissions,
  input: z.tuple([]),
  output: z.array(BridgePermissionSchema),
  errors: ['BRIDGE_PERMISSION_READ_FAILED'],
})
export const bridgeRevokePermissionContract = defineRequest({
  ...mainBase,
  channel: BRIDGE_CHANNELS.revokePermission,
  input: z.tuple([z.string().min(1).max(253), BridgeScopeSchema]),
  output: z.object({ success: z.literal(true) }),
  errors: ['INVALID_DOMAIN', 'INVALID_SCOPE', 'BRIDGE_PERMISSION_REVOKE_FAILED'],
})
export const bridgeGetConfigContract = defineRequest({
  ...mainBase,
  channel: BRIDGE_CHANNELS.getConfig,
  input: z.tuple([]),
  output: z.record(z.string(), z.unknown()).nullable(),
  errors: ['BRIDGE_CONFIG_READ_FAILED'],
})
export const bridgeSetConfigContract = defineRequest({
  ...mainBase,
  channel: BRIDGE_CHANNELS.setConfig,
  input: z.tuple([BridgeConfigPartialSchema]),
  output: MutationSchema,
  errors: ['INVALID_BRIDGE_CONFIG', 'BRIDGE_CONFIG_WRITE_FAILED'],
})
export const bridgeRestartContract = defineRequest({
  ...mainBase,
  channel: BRIDGE_CHANNELS.restart,
  rateLimit: { kind: 'fixed-window', maxRequests: 1, windowMs: 30_000, key: 'sender' },
  input: z.tuple([]),
  output: MutationSchema,
  errors: ['RATE_LIMITED', 'BRIDGE_RESTART_FAILED'],
})
export const bridgeMessageEventContract = defineEvent({
  channel: BRIDGE_CHANNELS.message,
  direction: 'event',
  recipient: 'tonsite',
  payload: z.tuple([z.string().min(2).max(1_048_576)]),
  redaction: 'secret',
})
export const BRIDGE_REQUEST_CONTRACTS = [
  bridgeSendContract,
  bridgeGetPermissionsContract,
  bridgeRevokePermissionContract,
  bridgeGetConfigContract,
  bridgeSetConfigContract,
  bridgeRestartContract,
] as const
export const BRIDGE_EVENT_CONTRACTS = [bridgeMessageEventContract] as const
