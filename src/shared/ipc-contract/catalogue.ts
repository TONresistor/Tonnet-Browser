import { BOOKMARKS_IPC_CONTRACTS } from './bookmarks'
import {
  tonConnectDisconnectSessionContract,
  tonConnectEventContract,
  tonConnectGetSessionsContract,
  tonConnectRequestContract,
} from './tonconnect'
import { WALLET_EVENT_CONTRACTS, WALLET_REQUEST_CONTRACTS } from './wallet'
import { SETTINGS_REQUEST_CONTRACTS, settingsChangedContract } from './settings'
import { HISTORY_REQUEST_CONTRACTS } from './history'
import { PROXY_EVENT_CONTRACTS, PROXY_REQUEST_CONTRACTS } from './proxy'
import { BROWSING_EVENT_CONTRACTS, BROWSING_REQUEST_CONTRACTS } from './browsing'
import { STORAGE_EVENT_CONTRACTS, STORAGE_REQUEST_CONTRACTS } from './storage'
import { BRIDGE_EVENT_CONTRACTS, BRIDGE_REQUEST_CONTRACTS } from './bridge'
import { WINDOW_REQUEST_CONTRACTS } from './window'
import { CHAT_EVENT_CONTRACTS, CHAT_REQUEST_CONTRACTS } from './chat'
import { OVERLAY_EVENT_CONTRACTS, OVERLAY_REQUEST_CONTRACTS } from './overlay'
import { COCOON_EVENT_CONTRACTS, COCOON_REQUEST_CONTRACTS } from './cocoon'
import { UPDATER_REQUEST_CONTRACTS } from './updater'

export const IPC_REQUEST_CONTRACTS = [
  ...BOOKMARKS_IPC_CONTRACTS,
  ...WALLET_REQUEST_CONTRACTS,
  tonConnectRequestContract,
  tonConnectGetSessionsContract,
  tonConnectDisconnectSessionContract,
  ...SETTINGS_REQUEST_CONTRACTS,
  ...HISTORY_REQUEST_CONTRACTS,
  ...PROXY_REQUEST_CONTRACTS,
  ...BROWSING_REQUEST_CONTRACTS,
  ...STORAGE_REQUEST_CONTRACTS,
  ...BRIDGE_REQUEST_CONTRACTS,
  ...WINDOW_REQUEST_CONTRACTS,
  ...CHAT_REQUEST_CONTRACTS,
  ...OVERLAY_REQUEST_CONTRACTS,
  ...COCOON_REQUEST_CONTRACTS,
  ...UPDATER_REQUEST_CONTRACTS,
] as const

export const IPC_EVENT_CONTRACTS = [
  ...WALLET_EVENT_CONTRACTS,
  tonConnectEventContract,
  settingsChangedContract,
  ...PROXY_EVENT_CONTRACTS,
  ...STORAGE_EVENT_CONTRACTS,
  ...BRIDGE_EVENT_CONTRACTS,
  ...CHAT_EVENT_CONTRACTS,
  ...COCOON_EVENT_CONTRACTS,
  ...OVERLAY_EVENT_CONTRACTS,
  ...BROWSING_EVENT_CONTRACTS,
] as const

export const IPC_CONTRACTS = [...IPC_REQUEST_CONTRACTS, ...IPC_EVENT_CONTRACTS] as const
