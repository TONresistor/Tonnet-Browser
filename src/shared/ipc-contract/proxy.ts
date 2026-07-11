import { z } from 'zod'
import { PROXY_CHANNELS } from './channels'
import { defineEvent, defineRequest } from './definition'

export const ProxyStatusSchema = z.object({
  status: z.enum(['stopped', 'starting', 'syncing', 'connected', 'error']),
  connected: z.boolean().optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  wsPort: z.number().int().min(1).max(65_535).optional(),
  anonymousMode: z.boolean().optional(),
  circuitRelays: z.array(z.string()).optional(),
  error: z.string().optional(),
})
const FullProxyStatusSchema = ProxyStatusSchema.extend({
  connected: z.boolean(),
  port: z.number().int().min(1).max(65_535),
})
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  input: z.tuple([]),
  redaction: 'public' as const,
}
export const proxyConnectContract = defineRequest({
  ...base,
  channel: PROXY_CHANNELS.connect,
  output: FullProxyStatusSchema.extend({ success: z.literal(true) }),
  errors: ['PROXY_START_FAILED', 'PROXY_READINESS_TIMEOUT'],
})
export const proxyDisconnectContract = defineRequest({
  ...base,
  channel: PROXY_CHANNELS.disconnect,
  output: z.object({ success: z.literal(true) }),
  errors: ['PROXY_STOP_FAILED'],
})
export const proxyStatusContract = defineRequest({
  ...base,
  channel: PROXY_CHANNELS.status,
  output: FullProxyStatusSchema,
  errors: ['PROXY_STATUS_FAILED'],
})
export const proxyStatusEventContract = defineEvent({
  channel: PROXY_CHANNELS.status,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([ProxyStatusSchema]),
  redaction: 'public',
})
export const proxyProgressEventContract = defineEvent({
  channel: PROXY_CHANNELS.progress,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([z.object({ step: z.number().int().nonnegative(), message: z.string().max(1_024) })]),
  redaction: 'public',
})
export const proxyAutoConnectEventContract = defineEvent({
  channel: PROXY_CHANNELS.autoConnect,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([]),
  redaction: 'public',
})
export const PROXY_REQUEST_CONTRACTS = [proxyConnectContract, proxyDisconnectContract, proxyStatusContract] as const
export const PROXY_EVENT_CONTRACTS = [
  proxyStatusEventContract,
  proxyProgressEventContract,
  proxyAutoConnectEventContract,
] as const
