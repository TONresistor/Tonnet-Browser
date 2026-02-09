/**
 * Preload script - bridge between main and renderer.
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron'

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
    connect: () => ipcRenderer.invoke('proxy:connect'),
    disconnect: () => ipcRenderer.invoke('proxy:disconnect'),
    status: () => ipcRenderer.invoke('proxy:status')
  },

  // Tabs
  tabs: {
    create: (tabId: string) => ipcRenderer.invoke('tab:create', tabId),
    close: (tabId: string) => ipcRenderer.invoke('tab:close', tabId),
    switch: (tabId: string) => ipcRenderer.invoke('tab:switch', tabId)
  },

  // View (BrowserView visibility)
  view: {
    hide: () => ipcRenderer.invoke('view:hide'),
    show: () => ipcRenderer.invoke('view:show')
  },

  // Bookmark context menu
  showBookmarkMenu: (id: string, title: string, url: string) =>
    ipcRenderer.invoke('bookmark:show-menu', id, title, url),

  // Folder dropdown menu
  showFolderMenu: (
    folderId: string,
    bookmarks: Array<{ id: string; title: string; url: string }>
  ) => ipcRenderer.invoke('folder:show-menu', folderId, bookmarks),

  // Folder context menu
  showFolderContextMenu: (folderId: string, folderName: string) =>
    ipcRenderer.invoke('folder:show-context-menu', folderId, folderName),

  // Navigation
  navigate: (url: string, tabId?: string) => ipcRenderer.invoke('navigate', url, tabId),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  stop: () => ipcRenderer.invoke('stop'),
  zoomIn: () => ipcRenderer.invoke('zoom:in'),
  zoomOut: () => ipcRenderer.invoke('zoom:out'),
  zoomReset: () => ipcRenderer.invoke('zoom:reset'),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),

  // Storage
  storage: {
    addBag: (bagId: string, name?: string) => ipcRenderer.invoke('storage:add-bag', bagId, name),
    removeBag: (bagId: string) => ipcRenderer.invoke('storage:remove-bag', bagId),
    listBags: () => ipcRenderer.invoke('storage:list-bags'),
    pauseBag: (bagId: string) => ipcRenderer.invoke('storage:pause-bag', bagId),
    getBagDetails: (bagId: string) => ipcRenderer.invoke('storage:get-details', bagId),
    getDownloadPath: () => ipcRenderer.invoke('storage:get-download-path'),
    setDownloadPath: (path: string) => ipcRenderer.invoke('storage:set-download-path', path),
    selectDownloadFolder: () => ipcRenderer.invoke('storage:select-download-folder'),
    openFolder: (bagId: string) => ipcRenderer.invoke('storage:open-folder', bagId),
    showFile: (bagId: string, fileName: string) => ipcRenderer.invoke('storage:show-file', bagId, fileName)
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },

  // Immediate sidebar width update (for real-time resize)
  updateSidebarWidth: (width: number) => ipcRenderer.invoke('update-sidebar-width', width),

  // Settings
  clearBrowsingData: () => ipcRenderer.invoke('settings:clear-data'),

  // App Settings
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    get: (category: string) => ipcRenderer.invoke('settings:get', category),
    set: (category: string, values: object) => ipcRenderer.invoke('settings:set', category, values),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },

  // History
  history: {
    changeMode: (mode: string) => ipcRenderer.invoke('history:change-mode', mode),
    search: (query: string, limit?: number) => ipcRenderer.invoke('history:search', query, limit),
    getRecent: (limit?: number) => ipcRenderer.invoke('history:get-recent', limit),
    getTop: (limit?: number) => ipcRenderer.invoke('history:get-top', limit),
    getByDate: (startDate: number, endDate: number) => ipcRenderer.invoke('history:get-by-date', startDate, endDate),
    delete: (id: string) => ipcRenderer.invoke('history:delete', id),
    deletePattern: (pattern: string) => ipcRenderer.invoke('history:delete-pattern', pattern),
    clear: () => ipcRenderer.invoke('history:clear'),
    getStats: () => ipcRenderer.invoke('history:get-stats'),
    hasPersistentFile: () => ipcRenderer.invoke('history:has-persistent-file'),
  },

  // Event listeners - returns unsubscribe function for proper cleanup
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const validChannels = [
      'page:loading',
      'page:navigate',
      'page:title',
      'page:favicon',
      'proxy:status',
      'proxy:progress',
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
    if (validChannels.includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
      ipcRenderer.on(channel, listener)
      // Return unsubscribe function that removes only THIS listener
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {} // No-op for invalid channels
  },

  // Backward compatible - removes ALL listeners for a channel
  off: (channel: string) => {
    const validChannels = [
      'page:loading',
      'page:navigate',
      'page:title',
      'page:favicon',
      'proxy:status',
      'proxy:progress',
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
    // Security: Only allow removing listeners for whitelisted channels
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
}
