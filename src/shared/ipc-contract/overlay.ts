import { z } from 'zod'
import { defineEvent, defineRequest } from './definition'
import { OVERLAY_CHANNELS } from './channels'

const OverlayIdSchema = z.string().min(1).max(256)
const OverlayBoundsSchema = z.object({
  x: z.number().int().finite(),
  y: z.number().int().finite(),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
})
const OverlayContentSchema = z.object({ type: z.string().min(1).max(64) }).passthrough()
const SuccessSchema = z.object({ success: z.literal(true) })
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}

export const overlayShowContract = defineRequest({
  ...base,
  channel: OVERLAY_CHANNELS.show,
  input: z.tuple([
    OverlayIdSchema,
    OverlayBoundsSchema,
    OverlayContentSchema,
    z.object({ autoDismiss: z.boolean().optional() }).optional(),
  ]),
  output: SuccessSchema,
  errors: ['INVALID_OVERLAY', 'OVERLAY_SHOW_FAILED'],
})
export const overlayHideContract = defineRequest({
  ...base,
  channel: OVERLAY_CHANNELS.hide,
  input: z.tuple([OverlayIdSchema]),
  output: SuccessSchema,
  errors: ['INVALID_OVERLAY', 'OVERLAY_HIDE_FAILED'],
})
export const overlayHideAllContract = defineRequest({
  ...base,
  channel: OVERLAY_CHANNELS.hideAll,
  input: z.tuple([]),
  output: SuccessSchema,
  errors: ['OVERLAY_HIDE_FAILED'],
})
export const overlayUpdateBoundsContract = defineRequest({
  ...base,
  channel: OVERLAY_CHANNELS.updateBounds,
  input: z.tuple([OverlayIdSchema, OverlayBoundsSchema]),
  output: SuccessSchema,
  errors: ['INVALID_OVERLAY', 'OVERLAY_UPDATE_FAILED'],
})
export const overlayActionRequestContract = defineRequest({
  direction: 'request',
  channel: OVERLAY_CHANNELS.action,
  caller: 'overlay',
  authorization: 'overlay-window',
  rateLimit: { kind: 'fixed-window', maxRequests: 30, windowMs: 1_000, key: 'sender' },
  input: z.tuple([z.string().min(1).max(128), z.unknown()]),
  output: z.void(),
  errors: ['RATE_LIMITED', 'UNAUTHORIZED_OVERLAY', 'INVALID_ACTION'],
  redaction: 'sensitive',
})
export const overlayActionEventContract = defineEvent({
  direction: 'event',
  channel: OVERLAY_CHANNELS.action,
  recipient: 'main-renderer',
  payload: z.tuple([OverlayIdSchema, z.string().min(1).max(128), z.unknown()]),
  redaction: 'sensitive',
})
export const overlayContentEventContract = defineEvent({
  direction: 'event',
  channel: OVERLAY_CHANNELS.content,
  recipient: 'overlay',
  payload: z.tuple([OverlayContentSchema.nullable()]),
  redaction: 'sensitive',
})
export const overlayThemeEventContract = defineEvent({
  direction: 'event',
  channel: OVERLAY_CHANNELS.theme,
  recipient: 'overlay',
  payload: z.tuple([z.record(z.string(), z.string())]),
  redaction: 'public',
})

export const OVERLAY_REQUEST_CONTRACTS = [
  overlayShowContract,
  overlayHideContract,
  overlayHideAllContract,
  overlayUpdateBoundsContract,
  overlayActionRequestContract,
] as const
export const OVERLAY_EVENT_CONTRACTS = [
  overlayActionEventContract,
  overlayContentEventContract,
  overlayThemeEventContract,
] as const
