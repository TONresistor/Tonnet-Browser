import { z } from 'zod'
import { BROWSING_CHANNELS } from './channels'
import { defineEvent, defineRequest } from './definition'

export const TabIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
export const BrowserUrlSchema = z.string().min(1).max(16_384)
const SuccessSchema = z.object({ success: z.boolean() })
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'public' as const,
}
const command = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({ ...base, channel, input: z.tuple([]), output: SuccessSchema, errors: ['BROWSING_COMMAND_FAILED'] })
const tabCommand = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...base,
    channel,
    input: z.tuple([TabIdSchema]),
    output: SuccessSchema,
    errors: ['INVALID_TAB_ID', 'TAB_COMMAND_FAILED'],
  })

export const tabCreateContract = defineRequest({
  ...base,
  channel: BROWSING_CHANNELS.tabCreate,
  input: z.tuple([TabIdSchema, BrowserUrlSchema]),
  output: SuccessSchema,
  errors: ['INVALID_TAB_ID', 'INVALID_URL', 'TAB_COMMAND_FAILED'],
})
export const tabCloseContract = tabCommand(BROWSING_CHANNELS.tabClose)
export const tabSwitchContract = tabCommand(BROWSING_CHANNELS.tabSwitch)
export const viewHideContract = command(BROWSING_CHANNELS.viewHide)
export const viewShowContract = command(BROWSING_CHANNELS.viewShow)
export const navigateContract = defineRequest({
  ...base,
  channel: BROWSING_CHANNELS.navigate,
  rateLimit: { kind: 'fixed-window', maxRequests: 30, windowMs: 1_000, key: 'sender' },
  input: z.tuple([BrowserUrlSchema, TabIdSchema.optional()]),
  output: SuccessSchema.extend({ internal: z.boolean().optional() }),
  errors: ['RATE_LIMITED', 'INVALID_URL', 'INVALID_FILE_PATH', 'TAB_NOT_FOUND', 'NAVIGATION_FAILED'],
})
export const goBackContract = command(BROWSING_CHANNELS.goBack)
export const goForwardContract = command(BROWSING_CHANNELS.goForward)
export const reloadContract = command(BROWSING_CHANNELS.reload)
export const stopContract = command(BROWSING_CHANNELS.stop)
export const zoomInContract = command(BROWSING_CHANNELS.zoomIn)
export const zoomOutContract = command(BROWSING_CHANNELS.zoomOut)
export const zoomResetContract = command(BROWSING_CHANNELS.zoomReset)
export const toggleDevtoolsContract = command(BROWSING_CHANNELS.toggleDevtools)
export const pageLoadingContract = defineEvent({
  channel: BROWSING_CHANNELS.pageLoading,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([z.boolean(), TabIdSchema]),
  redaction: 'public',
})
export const pageNavigateContract = defineEvent({
  channel: BROWSING_CHANNELS.pageNavigate,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([
    z.object({ tabId: TabIdSchema, url: BrowserUrlSchema, canGoBack: z.boolean(), canGoForward: z.boolean() }),
  ]),
  redaction: 'sensitive',
})
const pageStringEvent = <const TChannel extends string>(
  channel: TChannel,
  max: number,
  redaction: 'public' | 'sensitive'
) =>
  defineEvent({
    channel,
    direction: 'event',
    recipient: 'main-renderer',
    payload: z.tuple([z.string().max(max), TabIdSchema]),
    redaction,
  })
export const pageTitleContract = pageStringEvent(BROWSING_CHANNELS.pageTitle, 16_384, 'sensitive')
export const pageFaviconContract = pageStringEvent(BROWSING_CHANNELS.pageFavicon, 4_194_304, 'sensitive')
export const contextOpenLinkContract = defineEvent({
  channel: BROWSING_CHANNELS.contextOpenLink,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([BrowserUrlSchema]),
  redaction: 'sensitive',
})
export const tabHistoryResetContract = defineEvent({
  channel: BROWSING_CHANNELS.tabHistoryReset,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([TabIdSchema, BrowserUrlSchema]),
  redaction: 'sensitive',
})

export const BROWSING_REQUEST_CONTRACTS = [
  tabCreateContract,
  tabCloseContract,
  tabSwitchContract,
  viewHideContract,
  viewShowContract,
  navigateContract,
  goBackContract,
  goForwardContract,
  reloadContract,
  stopContract,
  zoomInContract,
  zoomOutContract,
  zoomResetContract,
  toggleDevtoolsContract,
] as const
export const BROWSING_EVENT_CONTRACTS = [
  pageLoadingContract,
  pageNavigateContract,
  pageTitleContract,
  pageFaviconContract,
  contextOpenLinkContract,
  tabHistoryResetContract,
] as const
