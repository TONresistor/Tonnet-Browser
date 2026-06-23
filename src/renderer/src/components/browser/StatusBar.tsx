/**
 * Status bar at the bottom.
 * Shows connection status and storage stats.
 */

import { useEffect, useState, memo } from 'react'
import { createLogger } from '@/logger'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const log = createLogger('status')
import { Wifi, WifiOff, LoaderCircle, ArrowDown, ArrowUp } from 'lucide-react'
import walletIcon from '@/assets/wallet.svg'
import { useBrowserStore } from '@/stores/browser'
import { useShallow } from 'zustand/react/shallow'
import { usePreferencesStore } from '@/stores/preferences'
import { useWalletStore, formatTonAmount } from '@/stores/wallet'
import { useTabsStore } from '@/stores/tabs'
import { APP_VERSION, TON_WALLET_PAGE, TUNNEL_SECTIONS } from '@shared/constants'
import { useTranslation } from 'react-i18next'
import { formatSpeed } from '@/lib/format'

function formatTime(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Separator component
function Separator() {
  return <div className="w-px h-3 bg-border" />
}

// Leaf component so the 1 Hz tick re-renders only the clock, not the whole footer.
function Clock({ locale }: { locale?: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span className="text-foreground">{formatTime(now, locale)}</span>
}

export const StatusBar = memo(function StatusBar() {
  const { t, i18n } = useTranslation('browser')
  const { proxyConnected, proxySyncing, anonymousMode, circuitRelays, storageStats, setProxyStatus, setStorageStats } =
    useBrowserStore(
      useShallow((s) => ({
        proxyConnected: s.proxyConnected,
        proxySyncing: s.proxySyncing,
        anonymousMode: s.anonymousMode,
        circuitRelays: s.circuitRelays,
        storageStats: s.storageStats,
        setProxyStatus: s.setProxyStatus,
        setStorageStats: s.setStorageStats,
      }))
    )
  const walletCreated = useWalletStore((s) => s.isCreated)
  const walletBalance = useWalletStore((s) => s.balance)
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)
  const seedingEnabled = usePreferencesStore((s) => s.saved.seedingEnabled)
  const tunnelMode = usePreferencesStore((s) => s.saved.tunnelMode)
  useEffect(() => {
    // Listen for proxy status updates from main process
    const unsubProxyStatus = window.electron.on(IPC_CHANNELS.PROXY_STATUS, (data) => {
      // Runtime validation (the payload crosses an unchecked IPC boundary)
      if (!data || typeof data !== 'object') {
        log.error('Invalid proxy:status data:', data)
        return
      }
      if (typeof data.status !== 'string') {
        log.error('Invalid status field type')
        return
      }
      setProxyStatus(
        data.status === 'connected',
        data.status === 'syncing',
        undefined,
        data.anonymousMode,
        data.circuitRelays
      )
    })

    // Listen for storage bags updates
    const unsubBagsUpdated = window.electron.on(IPC_CHANNELS.STORAGE_BAGS_UPDATED, (bags) => {
      const downloadSpeed = bags.reduce((sum, b) => sum + b.downloadSpeed, 0)
      const uploadSpeed = bags.reduce((sum, b) => sum + b.uploadSpeed, 0)
      setStorageStats({
        bagsCount: bags.length,
        downloadSpeed,
        uploadSpeed,
      })
    })

    return () => {
      unsubProxyStatus()
      unsubBagsUpdated()
    }
  }, [setProxyStatus, setStorageStats])

  const getNetworkStatus = () => {
    if (proxyConnected) {
      return (
        <>
          <Wifi className="h-3 w-3 text-success" aria-hidden="true" />
          <span className="text-success">{t('statusBar.connected')}</span>
        </>
      )
    }
    if (proxySyncing) {
      return (
        <>
          <LoaderCircle className="h-3 w-3 text-warning animate-spin" aria-hidden="true" />
          <span className="text-warning">
            {anonymousMode ? t('statusBar.syncingMultiHop') : t('statusBar.syncing')}
          </span>
        </>
      )
    }
    return (
      <>
        <WifiOff className="h-3 w-3 text-destructive" aria-hidden="true" />
        <span className="text-destructive">{t('statusBar.disconnected')}</span>
      </>
    )
  }

  const getGarlicStatus = () => {
    if (!anonymousMode) return null

    const isReady = circuitRelays.length >= 2
    const hops = TUNNEL_SECTIONS[tunnelMode]

    return (
      <span className="text-tonsite">
        {isReady ? t('statusBar.garlicRouting', { hops }) : t('statusBar.buildingCircuit')}
      </span>
    )
  }

  const statusText = proxyConnected
    ? t('statusBar.connected')
    : proxySyncing
      ? t('statusBar.syncing')
      : t('statusBar.disconnected')

  return (
    <footer
      className="flex items-center justify-between px-3 py-1 bg-[hsl(var(--elevation-0))] border-t border-border text-xs text-muted-foreground"
      role="contentinfo"
    >
      <div className="flex items-center gap-3">
        {/* Network Status */}
        <div
          className="flex items-center gap-1.5"
          role="status"
          aria-live="polite"
          aria-label={t('statusBar.networkStatus', { status: statusText })}
        >
          {getNetworkStatus()}
        </div>

        {/* Garlic Routing */}
        {anonymousMode && (
          <>
            <Separator />
            <div className="flex items-center gap-1.5">{getGarlicStatus()}</div>
          </>
        )}

        {/* Storage Bags */}
        <Separator />
        <button
          type="button"
          onClick={() => openOrSwitchToTab('ton://storage')}
          className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`${storageStats.bagsCount} ${storageStats.bagsCount === 1 ? t('statusBar.bag') : t('statusBar.bags')}`}
        >
          <span>{t('statusBar.storage')}</span>
          <span>
            {storageStats.bagsCount} {storageStats.bagsCount === 1 ? t('statusBar.bag') : t('statusBar.bags')}
          </span>
          {seedingEnabled && <span className="text-success">{t('statusBar.seeding')}</span>}
        </button>

        {/* Transfer Speeds */}
        {(storageStats.downloadSpeed > 0 || storageStats.uploadSpeed > 0) && (
          <>
            <Separator />
            <div
              className="flex items-center gap-1"
              aria-label={t('statusBar.downloadSpeedAria', { speed: formatSpeed(storageStats.downloadSpeed) })}
            >
              <ArrowDown className="h-3 w-3 text-info" aria-hidden="true" />
              <span>{formatSpeed(storageStats.downloadSpeed)}</span>
            </div>
            <div
              className="flex items-center gap-1"
              aria-label={t('statusBar.uploadSpeedAria', { speed: formatSpeed(storageStats.uploadSpeed) })}
            >
              <ArrowUp className="h-3 w-3 text-success" aria-hidden="true" />
              <span>{formatSpeed(storageStats.uploadSpeed)}</span>
            </div>
          </>
        )}
      </div>

      {/* Right side: wallet balance + version + clock */}
      <div className="flex items-center gap-3">
        {walletCreated && (
          <>
            <button
              type="button"
              onClick={() => openOrSwitchToTab(TON_WALLET_PAGE)}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
              title={t('statusBar.walletTitle')}
              aria-label={t('statusBar.walletAria')}
            >
              <img src={walletIcon} alt="" className="h-3 w-3" />
              <span>{formatTonAmount(walletBalance)} GRAM</span>
            </button>
            <Separator />
          </>
        )}
        <span aria-label={`Version ${APP_VERSION}`}>v{APP_VERSION}</span>
        <Separator />
        <Clock locale={i18n.language} />
      </div>
    </footer>
  )
})
