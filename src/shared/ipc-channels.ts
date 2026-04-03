// IPC Channel names
export const IPC_CHANNELS = {
  // Proxy
  PROXY_CONNECT: 'proxy:connect',
  PROXY_DISCONNECT: 'proxy:disconnect',
  PROXY_STATUS: 'proxy:status',
  PROXY_PROGRESS: 'proxy:progress',

  // Tabs
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',

  // View
  VIEW_HIDE: 'view:hide',
  VIEW_SHOW: 'view:show',

  // Navigation
  NAVIGATE: 'navigate',
  GO_BACK: 'go-back',
  GO_FORWARD: 'go-forward',
  RELOAD: 'reload',
  STOP: 'stop',
  ZOOM_IN: 'zoom:in',
  ZOOM_OUT: 'zoom:out',
  ZOOM_RESET: 'zoom:reset',
  TOGGLE_DEVTOOLS: 'devtools:toggle',

  // Storage
  STORAGE_ADD_BAG: 'storage:add-bag',
  STORAGE_REMOVE_BAG: 'storage:remove-bag',
  STORAGE_LIST_BAGS: 'storage:list-bags',
  STORAGE_PAUSE_BAG: 'storage:pause-bag',
  STORAGE_GET_DETAILS: 'storage:get-details',
  STORAGE_OPEN_FOLDER: 'storage:open-folder',
  STORAGE_SHOW_FILE: 'storage:show-file',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Settings
  CLEAR_BROWSING_DATA: 'settings:clear-data',
  STORAGE_GET_DOWNLOAD_PATH: 'storage:get-download-path',
  STORAGE_SET_DOWNLOAD_PATH: 'storage:set-download-path',
  STORAGE_SELECT_DOWNLOAD_FOLDER: 'storage:select-download-folder',

  // App Settings
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',

  // Sidebar
  UPDATE_SIDEBAR_WIDTH: 'update-sidebar-width',
  UPDATE_WALLET_SIDEBAR_WIDTH: 'update-wallet-sidebar-width',

  // Bookmarks
  BOOKMARK_SHOW_MENU: 'bookmark:show-menu',
  BOOKMARKS_LOAD: 'bookmarks:load',
  BOOKMARKS_SAVE: 'bookmarks:save',

  // Folders
  FOLDER_SHOW_MENU: 'folder:show-menu',
  FOLDER_SHOW_CONTEXT_MENU: 'folder:show-context-menu',

  // History
  HISTORY_CHANGE_MODE: 'history:change-mode',
  HISTORY_SEARCH: 'history:search',
  HISTORY_GET_RECENT: 'history:get-recent',
  HISTORY_GET_TOP: 'history:get-top',
  HISTORY_GET_BY_DATE: 'history:get-by-date',
  HISTORY_DELETE: 'history:delete',
  HISTORY_DELETE_PATTERN: 'history:delete-pattern',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_GET_STATS: 'history:get-stats',
  HISTORY_HAS_PERSISTENT_FILE: 'history:has-persistent-file',

  // Errors
  ERRORS_GET_RECENT: 'errors:get-recent',
  ERRORS_CLEAR: 'errors:clear',

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',

  // Wallet
  WALLET_CREATE: 'wallet:create',
  WALLET_GET_STATE: 'wallet:get-state',
  WALLET_GET_BALANCE: 'wallet:get-balance',
  WALLET_SEND: 'wallet:send',
  WALLET_GET_HISTORY: 'wallet:get-history',
  WALLET_CLEAR_HISTORY: 'wallet:clear-history',
  WALLET_EXPORT_KEY: 'wallet:export-key',
  WALLET_APPROVE_PAYMENT: 'wallet:approve-payment',
  WALLET_REJECT_PAYMENT: 'wallet:reject-payment',
  WALLET_IMPORT: 'wallet:import',
  WALLET_EXPORT_MNEMONIC: 'wallet:export-mnemonic',
  WALLET_DELETE: 'wallet:delete',

  // DNS
  DNS_RESOLVE: 'dns:resolve',

  // Bridge permissions
  BRIDGE_SEND: 'bridge:send',
  BRIDGE_MESSAGE: 'bridge:message',
  BRIDGE_GET_PERMISSIONS: 'bridge:get-permissions',
  BRIDGE_REVOKE_PERMISSION: 'bridge:revoke-permission',

  // Bridge config
  BRIDGE_GET_CONFIG: 'bridge:get-config',
  BRIDGE_SET_CONFIG: 'bridge:set-config',
  BRIDGE_RESTART: 'bridge:restart',

  // Overlay
  OVERLAY_SHOW: 'overlay:show',
  OVERLAY_HIDE: 'overlay:hide',
  OVERLAY_HIDE_ALL: 'overlay:hide-all',
  OVERLAY_UPDATE_BOUNDS: 'overlay:update-bounds',
  OVERLAY_ACTION: 'overlay:action',
} as const
