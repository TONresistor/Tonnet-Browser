/**
 * Type definitions for the preload API.
 * Defines window.electron interface for TypeScript.
 */

import type { AppSettings, StorageBag, BagDetails, WalletState, WalletTransaction } from '../shared/types'
import type { IpcEventMap } from '../shared/ipc-events'
import type {
  CocoonState,
  CocoonAvailability,
  CocoonPendingWithdraw,
  CocoonStakeInfo,
  CocoonCashoutResult,
  CocoonRecoveryAllResult,
} from '../shared/cocoon-types'

type IpcError = { success: false; error?: string }

declare global {
  interface Window {
    electron: {
      versions: {
        electron: string
        chrome: string
        node: string
      }
      proxy: {
        connect: () => Promise<{
          success: boolean
          status?: string
          connected?: boolean
          port?: number
          wsPort?: number
          anonymousMode?: boolean
          circuitRelays?: string[]
          error?: string
        }>
        disconnect: () => Promise<{
          success: boolean
        }>
        status: () => Promise<{
          status: string
          connected: boolean
          port: number
          wsPort: number
          anonymousMode: boolean
          circuitRelays: string[]
        }>
      }
      tabs: {
        create: (tabId: string) => Promise<{ success: boolean }>
        close: (tabId: string) => Promise<{ success: boolean }>
        switch: (tabId: string) => Promise<{ success: boolean }>
      }
      navigate: (
        url: string,
        tabId?: string
      ) => Promise<{
        success: boolean
        error?: string
      }>
      goBack: () => Promise<{
        success: boolean
      }>
      goForward: () => Promise<{
        success: boolean
      }>
      reload: () => Promise<{
        success: boolean
      }>
      stop: () => Promise<{
        success: boolean
      }>
      zoomIn: () => Promise<{
        success: boolean
      }>
      zoomOut: () => Promise<{
        success: boolean
      }>
      zoomReset: () => Promise<{
        success: boolean
      }>
      toggleDevTools: () => Promise<{
        success: boolean
      }>
      storage: {
        addBag: (
          bagId: string,
          name?: string
        ) => Promise<{
          success: boolean
          bag?: StorageBag
          error?: string
        }>
        removeBag: (bagId: string) => Promise<{
          success: boolean
        }>
        listBags: () => Promise<{
          success: boolean
          bags: StorageBag[]
        }>
        pauseBag: (bagId: string) => Promise<{
          success: boolean
        }>
        getDownloadPath: () => Promise<{
          success: boolean
          path: string
        }>
        setDownloadPath: (path: string) => Promise<{
          success: boolean
          error?: string
        }>
        selectDownloadFolder: () => Promise<{
          success: boolean
          path?: string
          canceled?: boolean
          error?: string
        }>
        getBagDetails: (bagId: string) => Promise<{
          success: boolean
          details?: BagDetails
          error?: string
        }>
        readFile: (
          bagId: string,
          relPath: string
        ) => Promise<{
          success: boolean
          content?: string
          truncated?: boolean
          size?: number
          error?: string
        }>
        openFolder: (bagId: string) => Promise<{ success: boolean; error?: string }>
        showFile: (bagId: string, fileName: string) => Promise<{ success: boolean; error?: string }>
      }
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
      }
      updateSidebarWidth: (width: number) => Promise<{ success: boolean }>
      updateWalletSidebarWidth: (width: number) => Promise<{ success: boolean }>
      view: {
        hide: () => Promise<{ success: boolean }>
        show: () => Promise<{ success: boolean }>
      }
      overlay: {
        show: (
          id: string,
          bounds: { x: number; y: number; width: number; height: number },
          content: unknown,
          options?: { autoDismiss?: boolean }
        ) => Promise<{ success: boolean }>
        hide: (id: string) => Promise<{ success: boolean }>
        hideAll: () => Promise<{ success: boolean }>
        updateBounds: (
          id: string,
          bounds: { x: number; y: number; width: number; height: number }
        ) => Promise<{ success: boolean }>
      }
      settings: {
        getAll: () => Promise<AppSettings>
        get: <K extends keyof AppSettings>(category: K) => Promise<AppSettings[K]>
        set: (category: string, values: object) => Promise<{ success: boolean; error?: string }>
        reset: () => Promise<{ success: boolean; error?: string }>
      }
      bookmarks: {
        load: () => Promise<{
          bookmarks: Array<{
            id: string
            url: string
            title: string
            favicon?: string
            folderId: string | null
            createdAt: number
            order: number
          }>
          folders: Array<{
            id: string
            name: string
            parentId: string | null
            createdAt: number
            order: number
          }>
        }>
        save: (data: { bookmarks: unknown[]; folders: unknown[] }) => Promise<{ success: boolean }>
      }
      clearBrowsingData: () => Promise<{
        success: boolean
        error?: string
      }>
      history: {
        changeMode: (mode: string) => Promise<{ success: boolean; error?: string }>
        search: (
          query: string,
          limit?: number
        ) => Promise<
          Array<{
            id: string
            url: string
            title: string
            visitedAt: number
            visitCount: number
            favicon?: string
          }>
        >
        getRecent: (limit?: number) => Promise<
          Array<{
            id: string
            url: string
            title: string
            visitedAt: number
            visitCount: number
            favicon?: string
          }>
        >
        getTop: (limit?: number) => Promise<
          Array<{
            id: string
            url: string
            title: string
            visitedAt: number
            visitCount: number
            favicon?: string
          }>
        >
        getByDate: (
          startDate: number,
          endDate: number
        ) => Promise<
          Array<{
            id: string
            url: string
            title: string
            visitedAt: number
            visitCount: number
            favicon?: string
          }>
        >
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        deleteByDate: (
          startDate: number,
          endDate: number
        ) => Promise<{ success: boolean; count: number; error?: string }>
        deletePattern: (pattern: string) => Promise<{ success: boolean; count: number; error?: string }>
        clear: () => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<{
          total: number
          mode: string
          oldestEntry?: number
          newestEntry?: number
          isLocked: boolean
        }>
        hasPersistentFile: () => Promise<boolean>
      }
      updater: {
        check: () => Promise<{
          updateAvailable: boolean
          version?: string
          releaseDate?: string
          reason?: 'dev-mode'
        }>
        openDownloadPage: () => Promise<{ success: boolean }>
      }
      wallet: {
        create: () => Promise<WalletState & { mnemonic: string[] }>
        getState: () => Promise<WalletState>
        getBalance: () => Promise<string | IpcError>
        send: (to: string, amount: string, comment?: string) => Promise<WalletTransaction>
        resolveRecipient: (input: string) => Promise<{ address: string; domain?: string }>
        getHistory: (limit?: number) => Promise<WalletTransaction[]>
        clearHistory: () => Promise<{ success: boolean }>
        exportKey: () => Promise<{ publicKey: string; address: string; addressRaw: string }>
        approvePayment: (id: string) => Promise<{ success: boolean; error?: string }>
        rejectPayment: (id: string) => Promise<{ success: boolean }>
        importWallet: (mnemonic: string[]) => Promise<WalletState>
        exportMnemonic: () => Promise<{ mnemonic: string[] }>
        deleteWallet: () => Promise<WalletState>
      }
      bridge: {
        getPermissions: () => Promise<
          Array<{
            domain: string
            scope: 'blockchain' | 'p2p' | 'write'
            decision: 'granted' | 'denied' | 'session'
            grantedAt: number
          }>
        >
        revokePermission: (domain: string, scope: string) => Promise<{ success: boolean }>
        getConfig: () => Promise<import('../shared/bridge-config').BridgeConfig | null>
        setConfig: (config: object) => Promise<{ success: boolean; error?: string }>
        restart: () => Promise<{ success: boolean; error?: string }>
      }
      tonconnect: {
        getSessions: () => Promise<import('../shared/types').TonConnectSession[]>
        disconnectSession: (domain: string) => Promise<{ success: boolean }>
      }
      dns: {
        resolve(domain: string): Promise<import('../shared/types').DnsResolveResult>
      }
      chat: {
        connect: (room?: string, node?: string) => Promise<{ connected: boolean; room: string; via: 'node' | 'dht' }>
        send: (text: string) => Promise<{
          sent: boolean
          needsLink?: boolean
          pendingMembership?: boolean
          identity?: import('../shared/types').OwnChatIdentity
        }>
        dmSend: (
          peerKey: string,
          text: string
        ) => Promise<{
          sent: boolean
          needsLink?: boolean
          pendingMembership?: boolean
          id?: string
          ts?: number
          identity?: import('../shared/types').OwnChatIdentity
        }>
        createRoom: (display: string) => Promise<{ room: string }>
        disconnect: () => Promise<{ disconnected: boolean }>
        identity: () => Promise<import('../shared/types').OwnChatIdentity>
        linkIdentity: () => Promise<import('../shared/types').OwnChatIdentity>
        claimDomain: (
          domain: string
        ) => Promise<{ ok: boolean; reason?: string; identity: import('../shared/types').OwnChatIdentity }>
        clearDomain: () => Promise<import('../shared/types').OwnChatIdentity>
        detectDomains: () => Promise<{ domains: string[] }>
      }
      cocoon: {
        availability: () => Promise<CocoonAvailability>
        status: () => Promise<CocoonState>
        /** Reads secrets from disk; takes no params. */
        start: () => Promise<{ success: boolean; httpPort?: number; error?: string }>
        stop: () => Promise<{ success: boolean; error?: string }>
        // Wallet management
        walletExists: () => Promise<boolean>
        walletCreate: () => Promise<{
          ownerAddress: string
          nodeAddress: string
          /** One-time mnemonic display: caller must back it up immediately. */
          mnemonic: string[]
        }>
        walletInfo: () => Promise<
          | {
              ownerAddress: string
              nodeAddress: string
              nodePublicKeyHex: string
              createdAt: number
              /** Timestamp when the setup wizard finished. null while wizard is still in progress. */
              setupCompletedAt: number | null
            }
          | null
          | IpcError
        >
        walletExportMnemonic: () => Promise<string[] | IpcError>
        walletDelete: () => Promise<void | IpcError>
        /** Mark setup wizard as complete (called after Step 4 succeeds). */
        walletMarkSetupComplete: () => Promise<void | IpcError>
        // Setup wizard
        /** Returns the owner wallet balance as a decimal nano-TON string. */
        getOwnerBalance: () => Promise<string | IpcError>
        /** Returns the cocoon node wallet balance as a decimal nano-TON string. */
        getCocoonWalletBalance: () => Promise<string | IpcError>
        /** Fund the cocoon node wallet from the owner wallet. amount is decimal nano-TON or 'max'. */
        fundCocoon: (amount: string | 'max') => Promise<{
          bocHash: string
          seqno: number
          /** Actual sent amount as decimal nano-TON string. */
          sentAmount: string
        }>
        // Stake lifecycle
        /** Combined stake snapshot. Returns null when the runner has not yet registered with a proxy. */
        stakeInfo: () => Promise<CocoonStakeInfo | null | IpcError>
        /** Trigger on-chain unstake step. Behavior depends on current stake state. */
        unstake: () => Promise<{ success: boolean; error?: string }>
        /** Stop the runner and drain the cocoon node wallet residual back to the owner wallet. */
        cashout: () => Promise<CocoonCashoutResult | IpcError>
        /**
         * Composite ACTIVATE flow: drains any prior cocoon residual, archives
         * the prior wallet (mnemonic kept for recovery), generates a fresh
         * cocoon_node identity, funds it from native, and starts the runner.
         * Idempotent on already-active stakes — returns immediately.
         *
         * Why rotate: the upstream proxy worker permanently caches sc_status_
         * per cocoon_node identity (see cocoon-v2 ProxyClientInfo).
         */
        flowStake: () => Promise<{ success: boolean; httpPort?: number; error?: string }>
        /**
         * Composite full-withdraw flow: arms the persistent pending-withdraw
         * intent and sends the on-chain refund request. The driver auto-
         * progresses through cooldown → claim → cashout.
         */
        flowUnstake: () => Promise<{ success: boolean; error?: string }>
        /** Snapshot the persistent pending-withdraw intent (null if none). */
        flowPending: () => Promise<CocoonPendingWithdraw | null | IpcError>
        /** List archived cocoon identities (rotated out, kept for recovery). */
        archiveList: () => Promise<
          | Array<{
              archivedAt: number
              ownerAddress: string
              nodeAddress: string
              lastClientSCAddress: string | null
            }>
          | IpcError
        >
        /** Export the mnemonic of an archived identity (24 words). */
        archiveExportMnemonic: (archivedAt: number) => Promise<{ mnemonic: string[] } | IpcError>
        /**
         * Enqueue an automatic recovery for an archived wallet's locked client
         * SC. Sends the initial request_refund using the archived owner
         * mnemonic, then the RecoveryDriver autonomously progresses through
         * cooldown → claim → drain → done across app restarts.
         */
        recoveryEnqueue: (params: {
          archivedAt: number
          clientSCAddress: string
        }) => Promise<{ success: true; refundBocHash: string } | IpcError>
        /** List recovery queue entries (oldest first). */
        recoveryList: () => Promise<
          | Array<{
              archivedAt: number
              clientSCAddress: string
              phase: 'refund-pending' | 'cooldown' | 'claim-pending' | 'drain-pending' | 'done' | 'failed'
              addedAt: number
              lastError?: string
              unlockTs?: number
              refundBocHash?: string
              claimBocHash?: string
              drainBocHash?: string
              sentToMain?: string
            }>
          | IpcError
        >
        /** Remove a recovery queue entry (manual cleanup for stuck or completed entries). */
        recoveryRemove: (archivedAt: number) => Promise<{ success: true } | IpcError>
        /** Recover every immediately actionable Cocoon-controlled balance to the main wallet. */
        recoveryAll: () => Promise<CocoonRecoveryAllResult | IpcError>
      }
      on: <K extends keyof IpcEventMap>(channel: K, callback: (...args: IpcEventMap[K]) => void) => () => void
    }
  }
}
export {}
//# sourceMappingURL=index.d.ts.map
