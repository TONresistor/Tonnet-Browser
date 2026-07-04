/**
 * Preload script - bridge between main and renderer.
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { IpcEventMap } from '../shared/ipc-events'

const VALID_EVENT_CHANNELS = [
  IPC_CHANNELS.PAGE_LOADING,
  IPC_CHANNELS.PAGE_NAVIGATE,
  IPC_CHANNELS.PAGE_TITLE,
  IPC_CHANNELS.PAGE_FAVICON,
  IPC_CHANNELS.PROXY_STATUS,
  IPC_CHANNELS.PROXY_PROGRESS,
  IPC_CHANNELS.PROXY_AUTO_CONNECT,
  IPC_CHANNELS.STORAGE_BAGS_UPDATED,
  IPC_CHANNELS.STORAGE_STATUS,
  IPC_CHANNELS.CONTEXT_OPEN_LINK,
  IPC_CHANNELS.SETTINGS_CHANGED,
  IPC_CHANNELS.TAB_HISTORY_RESET,
  IPC_CHANNELS.WALLET_BALANCE_UPDATED,
  IPC_CHANNELS.WALLET_STATE_CHANGED,
  IPC_CHANNELS.WALLET_NEW_TRANSACTION,
  IPC_CHANNELS.WALLET_PAYMENT_REQ,
  IPC_CHANNELS.WALLET_PAYMENT_MADE,
  IPC_CHANNELS.WALLET_PAYMENT_FAILED,
  IPC_CHANNELS.OVERLAY_ACTION,
  IPC_CHANNELS.COCOON_STATE_CHANGED,
  IPC_CHANNELS.COCOON_LOG,
  IPC_CHANNELS.COCOON_WITHDRAW_EVENT,
  IPC_CHANNELS.COCOON_RECOVERY_EVENT,
  IPC_CHANNELS.CHAT_MESSAGE,
]

// Custom APIs for renderer - exposed as window.electron
const electronAPI = {
  // Process versions
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // Proxy
  proxy: {
    connect: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_CONNECT),
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_DISCONNECT),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STATUS),
  },

  // Tabs
  tabs: {
    create: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, tabId),
    close: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, tabId),
    switch: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_SWITCH, tabId),
  },

  // View (WebContentsView visibility)
  view: {
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.VIEW_HIDE),
    show: () => ipcRenderer.invoke(IPC_CHANNELS.VIEW_SHOW),
  },

  // Overlay (floating UI above WebContentsView)
  overlay: {
    show: (
      id: string,
      bounds: { x: number; y: number; width: number; height: number },
      content: unknown,
      options?: { autoDismiss?: boolean }
    ) => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_SHOW, id, bounds, content, options),
    hide: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_HIDE, id),
    hideAll: () => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_HIDE_ALL),
    updateBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_UPDATE_BOUNDS, id, bounds),
  },

  // Navigation
  navigate: (url: string, tabId?: string) => ipcRenderer.invoke(IPC_CHANNELS.NAVIGATE, url, tabId),
  goBack: () => ipcRenderer.invoke(IPC_CHANNELS.GO_BACK),
  goForward: () => ipcRenderer.invoke(IPC_CHANNELS.GO_FORWARD),
  reload: () => ipcRenderer.invoke(IPC_CHANNELS.RELOAD),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.STOP),
  zoomIn: () => ipcRenderer.invoke(IPC_CHANNELS.ZOOM_IN),
  zoomOut: () => ipcRenderer.invoke(IPC_CHANNELS.ZOOM_OUT),
  zoomReset: () => ipcRenderer.invoke(IPC_CHANNELS.ZOOM_RESET),
  toggleDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_DEVTOOLS),

  // Storage
  storage: {
    addBag: (bagId: string, name?: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_ADD_BAG, bagId, name),
    removeBag: (bagId: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_REMOVE_BAG, bagId),
    listBags: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LIST_BAGS),
    pauseBag: (bagId: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_PAUSE_BAG, bagId),
    getBagDetails: (bagId: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_DETAILS, bagId),
    readFile: (bagId: string, relPath: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_READ_FILE, bagId, relPath),
    getDownloadPath: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_DOWNLOAD_PATH),
    setDownloadPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_DOWNLOAD_PATH, path),
    selectDownloadFolder: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SELECT_DOWNLOAD_FOLDER),
    openFolder: (bagId: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_OPEN_FOLDER, bagId),
    showFile: (bagId: string, fileName: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SHOW_FILE, bagId, fileName),
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  },

  // Immediate sidebar width update (for real-time resize)
  updateSidebarWidth: (width: number) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SIDEBAR_WIDTH, width),
  updateWalletSidebarWidth: (width: number) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_WALLET_SIDEBAR_WIDTH, width),

  // Settings
  clearBrowsingData: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_BROWSING_DATA),

  // App Settings
  settings: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    get: (category: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, category),
    set: (category: string, values: object) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, category, values),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RESET),
  },

  // Bookmarks persistence
  bookmarks: {
    load: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_LOAD),
    save: (data: { bookmarks: unknown[]; folders: unknown[] }) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_SAVE, data),
  },

  // History
  history: {
    changeMode: (mode: string) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CHANGE_MODE, mode),
    search: (query: string, limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_SEARCH, query, limit),
    getRecent: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_RECENT, limit),
    getTop: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_TOP, limit),
    getByDate: (startDate: number, endDate: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_BY_DATE, startDate, endDate),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE, id),
    deleteByDate: (startDate: number, endDate: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE_BY_DATE, startDate, endDate),
    deletePattern: (pattern: string) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE_PATTERN, pattern),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR),
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_STATS),
    hasPersistentFile: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_HAS_PERSISTENT_FILE),
  },

  // Wallet
  wallet: {
    create: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_CREATE),
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_GET_STATE),
    getBalance: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_GET_BALANCE),
    send: (to: string, amount: string, comment?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WALLET_SEND, to, amount, comment),
    resolveRecipient: (input: string) => ipcRenderer.invoke(IPC_CHANNELS.WALLET_RESOLVE_RECIPIENT, input),
    getHistory: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.WALLET_GET_HISTORY, limit),
    clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_CLEAR_HISTORY),
    exportKey: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_EXPORT_KEY),
    approvePayment: (paymentId: string) => ipcRenderer.invoke(IPC_CHANNELS.WALLET_APPROVE_PAYMENT, paymentId),
    rejectPayment: (paymentId: string) => ipcRenderer.invoke(IPC_CHANNELS.WALLET_REJECT_PAYMENT, paymentId),
    importWallet: (mnemonic: string[]) => ipcRenderer.invoke(IPC_CHANNELS.WALLET_IMPORT, mnemonic),
    exportMnemonic: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_EXPORT_MNEMONIC),
    deleteWallet: () => ipcRenderer.invoke(IPC_CHANNELS.WALLET_DELETE),
  },

  // Bridge
  bridge: {
    getPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_GET_PERMISSIONS),
    revokePermission: (domain: string, scope: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_REVOKE_PERMISSION, domain, scope),
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_GET_CONFIG),
    setConfig: (config: object) => ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_SET_CONFIG, config),
    restart: () => ipcRenderer.invoke(IPC_CHANNELS.BRIDGE_RESTART),
  },

  tonconnect: {
    getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.TONCONNECT_GET_SESSIONS),
    disconnectSession: (domain: string) => ipcRenderer.invoke(IPC_CHANNELS.TONCONNECT_DISCONNECT_SESSION, domain),
  },

  // DNS
  dns: {
    resolve: (domain: string) => ipcRenderer.invoke(IPC_CHANNELS.DNS_RESOLVE, domain),
  },

  // Group chat (experimental — ton://chat)
  chat: {
    connect: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_CONNECT),
    send: (nick: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, nick, text),
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_DISCONNECT),
  },

  // Cocoon AI
  cocoon: {
    availability: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_AVAILABILITY),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_STATUS),
    // No params: secrets are read from disk in the main process.
    start: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_START),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_STOP),
    // Wallet management
    walletExists: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_WALLET_EXISTS),
    walletCreate: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_WALLET_CREATE),
    walletInfo: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_WALLET_INFO),
    walletExportMnemonic: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_WALLET_EXPORT_MNEMONIC),
    walletDelete: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_WALLET_DELETE),
    walletMarkSetupComplete: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE),
    // Setup wizard
    getOwnerBalance: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE),
    getCocoonWalletBalance: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE),
    fundCocoon: (amount: string | 'max') => ipcRenderer.invoke(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON, { amount }),
    // Stake lifecycle (atomic primitives)
    stakeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_STAKE_INFO),
    unstake: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_STAKE_UNSTAKE),
    cashout: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_STAKE_CASHOUT),
    // Composite flows (single user actions). flowStake = activate: rotates
    // wallet (archives old, regens fresh) before staking, because the upstream
    // proxy worker permanently caches identity status.
    flowStake: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_FLOW_STAKE),
    flowUnstake: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_FLOW_UNSTAKE),
    flowPending: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_FLOW_PENDING),
    // Archive of consumed wallets (rotated out; kept for upstream-restart recovery)
    archiveList: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_ARCHIVE_LIST),
    archiveExportMnemonic: (archivedAt: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.COCOON_ARCHIVE_EXPORT_MNEMONIC, { archivedAt }),
    // Recovery: drain TON locked in archived-wallet client SCs back to native.
    recoveryEnqueue: (params: { archivedAt: number; clientSCAddress: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.COCOON_RECOVERY_ENQUEUE, params),
    recoveryList: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_RECOVERY_LIST),
    recoveryRemove: (archivedAt: number) => ipcRenderer.invoke(IPC_CHANNELS.COCOON_RECOVERY_REMOVE, { archivedAt }),
    recoveryAll: () => ipcRenderer.invoke(IPC_CHANNELS.COCOON_RECOVERY_ALL),
  },

  // Updater
  updater: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
    openDownloadPage: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_OPEN_DOWNLOAD_PAGE),
  },

  // Event listeners - returns unsubscribe function for proper cleanup
  on: <K extends keyof IpcEventMap>(channel: K, callback: (...args: IpcEventMap[K]) => void): (() => void) => {
    if ((VALID_EVENT_CHANNELS as readonly string[]).includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...(args as IpcEventMap[K]))
      ipcRenderer.on(channel, listener)
      // Return unsubscribe function that removes only THIS listener
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {} // No-op for invalid channels
  },
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
}
