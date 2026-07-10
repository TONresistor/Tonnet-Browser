import { z } from 'zod'
import { defineRequest } from './definition'
import { UPDATER_CHANNELS } from './channels'

const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'fixed-window' as const, maxRequests: 3, windowMs: 10_000, key: 'sender' as const },
  redaction: 'public' as const,
}
export const updaterCheckContract = defineRequest({
  ...base,
  channel: UPDATER_CHANNELS.check,
  input: z.tuple([]),
  output: z.object({
    updateAvailable: z.boolean(),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:[-+].*)?$/)
      .optional(),
    releaseDate: z.string().max(128).optional(),
    reason: z.literal('dev-mode').optional(),
  }),
  errors: ['RATE_LIMITED', 'UPDATE_CHECK_FAILED'],
})
export const updaterOpenDownloadPageContract = defineRequest({
  ...base,
  channel: UPDATER_CHANNELS.openDownloadPage,
  input: z.tuple([]),
  output: z.object({ success: z.literal(true) }),
  errors: ['RATE_LIMITED', 'OPEN_DOWNLOAD_PAGE_FAILED'],
})
export const UPDATER_REQUEST_CONTRACTS = [updaterCheckContract, updaterOpenDownloadPageContract] as const
export type UpdateCheckResult = z.infer<typeof updaterCheckContract.output>
