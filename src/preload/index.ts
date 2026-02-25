/**
 * Preload script - bridge between main and renderer.
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'

const VALID_EVENT_CHANNELS = [
  'page:loading',
  'page:navigate',
  'page:title',
  'page:favicon',
  'proxy:status',
  'proxy:progress',
  'proxy:auto-connect',
  'proxy:bandwidth',
  'storage:bags-updated',
  'storage:status',
  'context:open-link',
  'settings:changed',
  'bookmark:open-new-tab',
  'bookmark:edit',
  'bookmark:delete',
  'folder:rename',
  'folder:delete',
  'folder:open-all',
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

  // View (BrowserView visibility)
  view: {
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.VIEW_HIDE),
    show: () => ipcRenderer.invoke(IPC_CHANNELS.VIEW_SHOW),
  },

  // Bookmark context menu
  showBookmarkMenu: (id: string, title: string, url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_SHOW_MENU, id, title, url),

  // Folder dropdown menu
  showFolderMenu: (folderId: string, bookmarks: Array<{ id: string; title: string; url: string }>) =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDER_SHOW_MENU, folderId, bookmarks),

  // Folder context menu
  showFolderContextMenu: (folderId: string, folderName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDER_SHOW_CONTEXT_MENU, folderId, folderName),

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

  // Settings
  clearBrowsingData: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_BROWSING_DATA),

  // App Settings
  settings: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    get: (category: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, category),
    set: (category: string, values: object) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, category, values),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RESET),
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
    deletePattern: (pattern: string) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE_PATTERN, pattern),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR),
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_STATS),
    hasPersistentFile: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_HAS_PERSISTENT_FILE),
  },

  // Event listeners - returns unsubscribe function for proper cleanup
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (VALID_EVENT_CHANNELS.includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
      ipcRenderer.on(channel, listener)
      // Return unsubscribe function that removes only THIS listener
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {} // No-op for invalid channels
  },

  // Backward compatible - removes ALL listeners for a channel
  off: (channel: string) => {
    // Security: Only allow removing listeners for whitelisted channels
    if (VALID_EVENT_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel)
    }
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
