import { z } from 'zod'
import { WINDOW_CHANNELS } from './channels'
import { defineRequest } from './definition'

const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'public' as const,
}
const windowCommand = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...base,
    channel,
    input: z.tuple([]),
    output: z.undefined(),
    errors: ['WINDOW_COMMAND_FAILED'],
  })
const widthCommand = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...base,
    channel,
    input: z.tuple([z.number().finite().min(0).max(3_000)]),
    output: z.object({ success: z.literal(true) }),
    errors: ['INVALID_WIDTH', 'WINDOW_LAYOUT_FAILED'],
  })
export const windowMinimizeContract = windowCommand(WINDOW_CHANNELS.minimize)
export const windowMaximizeContract = windowCommand(WINDOW_CHANNELS.maximize)
export const windowCloseContract = windowCommand(WINDOW_CHANNELS.close)
export const sidebarWidthContract = widthCommand(WINDOW_CHANNELS.sidebarWidth)
export const walletSidebarWidthContract = widthCommand(WINDOW_CHANNELS.walletSidebarWidth)
export const WINDOW_REQUEST_CONTRACTS = [
  windowMinimizeContract,
  windowMaximizeContract,
  windowCloseContract,
  sidebarWidthContract,
  walletSidebarWidthContract,
] as const
