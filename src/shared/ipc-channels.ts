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
  STORAGE_READ_FILE: 'storage:read-file',
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
  BOOKMARKS_LOAD: 'bookmarks:load',
  BOOKMARKS_SAVE: 'bookmarks:save',

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

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_OPEN_DOWNLOAD_PAGE: 'updater:open-download-page',

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
  WALLET_PAY_FOR_XHR: 'wallet:pay-for-xhr' /* also hardcoded in resources/preload/tonsite.js — keep in sync */,
  WALLET_IMPORT: 'wallet:import',
  WALLET_EXPORT_MNEMONIC: 'wallet:export-mnemonic',
  WALLET_DELETE: 'wallet:delete',
  WALLET_RESOLVE_RECIPIENT: 'wallet:resolve-recipient',
  // Wallet push events (main -> renderer)
  WALLET_BALANCE_UPDATED: 'wallet:balance-updated',
  WALLET_STATE_CHANGED: 'wallet:state-changed',
  WALLET_NEW_TRANSACTION: 'wallet:new-transaction',

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

  TONCONNECT_REQUEST: 'tonconnect:request',
  TONCONNECT_EVENT: 'tonconnect:event',
  TONCONNECT_GET_SESSIONS: 'tonconnect:get-sessions',
  TONCONNECT_DISCONNECT_SESSION: 'tonconnect:disconnect-session',

  // Cocoon AI lifecycle
  COCOON_START: 'cocoon:start',
  COCOON_STOP: 'cocoon:stop',
  COCOON_STATUS: 'cocoon:status',
  COCOON_AVAILABILITY: 'cocoon:availability',
  // Cocoon wallet management
  COCOON_WALLET_EXISTS: 'cocoon:wallet:exists',
  COCOON_WALLET_CREATE: 'cocoon:wallet:create',
  COCOON_WALLET_INFO: 'cocoon:wallet:info',
  COCOON_WALLET_EXPORT_MNEMONIC: 'cocoon:wallet:export-mnemonic',
  COCOON_WALLET_DELETE: 'cocoon:wallet:delete',
  COCOON_WALLET_MARK_SETUP_COMPLETE: 'cocoon:wallet:mark-setup-complete',
  // Cocoon setup (owner-funded flow)
  COCOON_SETUP_OWNER_BALANCE: 'cocoon:setup:owner-balance',
  COCOON_SETUP_COCOON_BALANCE: 'cocoon:setup:cocoon-balance',
  COCOON_SETUP_FUND_COCOON: 'cocoon:setup:fund-cocoon',
  // Cocoon stake lifecycle (atomic primitives — kept for the wizard and debug)
  COCOON_STAKE_INFO: 'cocoon:stake:info',
  COCOON_STAKE_UNSTAKE: 'cocoon:stake:unstake',
  COCOON_STAKE_CASHOUT: 'cocoon:stake:cashout',
  // Cocoon composite flows (single-click user actions). flow:stake is the
  // ACTIVATE flow: it transparently archives any prior wallet, rotates to a
  // fresh cocoon_node identity, funds, and stakes — because the upstream
  // proxy worker permanently caches sc_status_ per identity (one cycle per
  // wallet by protocol design).
  COCOON_FLOW_STAKE: 'cocoon:flow:stake',
  COCOON_FLOW_UNSTAKE: 'cocoon:flow:unstake',
  COCOON_FLOW_PENDING: 'cocoon:flow:pending',
  // Cocoon archive (consumed wallets retained for recovery if upstream worker restarts)
  COCOON_ARCHIVE_LIST: 'cocoon:archive:list',
  COCOON_ARCHIVE_EXPORT_MNEMONIC: 'cocoon:archive:export-mnemonic',
  // Cocoon recovery (auto-progressed multi-stage drain of an archived wallet's locked client SC)
  COCOON_RECOVERY_ENQUEUE: 'cocoon:recovery:enqueue',
  COCOON_RECOVERY_LIST: 'cocoon:recovery:list',
  COCOON_RECOVERY_REMOVE: 'cocoon:recovery:remove',
  COCOON_RECOVERY_ALL: 'cocoon:recovery:all',
  // Cocoon push events (main -> renderer)
  COCOON_STATE_CHANGED: 'cocoon:state-changed',
  COCOON_LOG: 'cocoon:log',
  COCOON_WITHDRAW_EVENT: 'cocoon:withdraw:event',
  COCOON_RECOVERY_EVENT: 'cocoon:recovery:event',

  // Overlay
  OVERLAY_SHOW: 'overlay:show',
  OVERLAY_HIDE: 'overlay:hide',
  OVERLAY_HIDE_ALL: 'overlay:hide-all',
  OVERLAY_UPDATE_BOUNDS: 'overlay:update-bounds',
  OVERLAY_ACTION: 'overlay:action',

  // Push events (main -> renderer)
  PAGE_LOADING: 'page:loading',
  PAGE_NAVIGATE: 'page:navigate',
  PAGE_TITLE: 'page:title',
  PAGE_FAVICON: 'page:favicon',
  CONTEXT_OPEN_LINK: 'context:open-link',
  PROXY_AUTO_CONNECT: 'proxy:auto-connect',
  STORAGE_BAGS_UPDATED: 'storage:bags-updated',
  STORAGE_STATUS: 'storage:status',
  SETTINGS_CHANGED: 'settings:changed',
  TAB_HISTORY_RESET: 'tab:history-reset',
  WALLET_PAYMENT_REQ: 'wallet:payment-req',
  WALLET_PAYMENT_MADE: 'wallet:payment-made',
  WALLET_PAYMENT_FAILED: 'wallet:payment-failed',
} as const
