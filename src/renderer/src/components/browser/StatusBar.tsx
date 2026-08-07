/**
 * Status bar at the bottom.
 * Shows connection status and storage stats.
 */

import { useEffect, useRef, useState, memo } from 'react'
import { Wifi, WifiOff, LoaderCircle, ArrowDown, ArrowUp } from 'lucide-react'
import { AppIcon } from '@/components/ui/AppIcon'
import { SliderInput } from '@/components/ui/ios/SliderInput'
import { useBrowserStore } from '@/stores/browser'
import { useShallow } from 'zustand/react/shallow'
import { usePreferencesStore } from '@/features/settings/preferences-store'
import { useWalletStore } from '@/features/wallet/store'
import { formatTonAmount } from '@/lib/ton-utils'
import { useTabsStore } from '@/stores/tabs'
import { storageClient } from '@/features/storage/client'
import { browserClient } from '@/features/browser/client'
import { isInternalUrl } from '@/app-shell/internal-routes'
import { APP_VERSION, PAGE_ZOOM, TON_WALLET_PAGE, TUNNEL_SECTIONS } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc-channels'
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
  return <span className="text-chrome-foreground opacity-60">{formatTime(now, locale)}</span>
}

export const StatusBar = memo(function StatusBar() {
  const { t, i18n } = useTranslation('browser')
  const { proxyConnected, proxySyncing, anonymousMode, circuitRelays, storageStats, setStorageStats } = useBrowserStore(
    useShallow((s) => ({
      proxyConnected: s.proxyConnected,
      proxySyncing: s.proxySyncing,
      anonymousMode: s.anonymousMode,
      circuitRelays: s.circuitRelays,
      storageStats: s.storageStats,
      setStorageStats: s.setStorageStats,
    }))
  )
  const walletCreated = useWalletStore((s) => s.isCreated)
  const walletBalance = useWalletStore((s) => s.balance)
  const { openOrSwitchToTab, activeTabId, activeTabUrl } = useTabsStore(
    useShallow((s) => ({
      openOrSwitchToTab: s.openOrSwitchToTab,
      activeTabId: s.activeTabId,
      activeTabUrl: s.tabs.find((tab) => tab.id === s.activeTabId)?.url ?? null,
    }))
  )
  const { seedingEnabled, tunnelMode, defaultZoom } = usePreferencesStore(
    useShallow((s) => ({
      seedingEnabled: s.saved.seedingEnabled,
      tunnelMode: s.saved.tunnelMode,
      defaultZoom: s.saved.defaultZoom,
    }))
  )
  const [zoom, setZoom] = useState(defaultZoom)
  const zoomRequest = useRef(0)
  const isZoomable = Boolean(activeTabId && activeTabUrl && !isInternalUrl(activeTabUrl))

  useEffect(() => {
    const request = ++zoomRequest.current
    if (!isZoomable || !activeTabId) {
      setZoom(defaultZoom)
      return
    }

    void browserClient
      .getZoom()
      .then((result) => {
        if (zoomRequest.current === request && result.success && result.zoom !== null) setZoom(result.zoom)
      })
      .catch(() => undefined)

    const unsubscribe = browserClient.on(IPC_CHANNELS.PAGE_ZOOM, (nextZoom, tabId) => {
      if (tabId !== activeTabId) return
      zoomRequest.current += 1
      setZoom(nextZoom)
    })

    return () => {
      zoomRequest.current += 1
      unsubscribe()
    }
  }, [activeTabId, defaultZoom, isZoomable])

  const setActiveZoom = (nextZoom: number): void => {
    const request = ++zoomRequest.current
    setZoom(nextZoom)
    void browserClient
      .setZoom(nextZoom)
      .then((result) => {
        if (zoomRequest.current === request && result.zoom !== null) setZoom(result.zoom)
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    // Listen for storage bags updates
    const unsubBagsUpdated = storageClient.onBagsUpdated((bags) => {
      const downloadSpeed = bags.reduce((sum, b) => sum + b.downloadSpeed, 0)
      const uploadSpeed = bags.reduce((sum, b) => sum + b.uploadSpeed, 0)
      setStorageStats({
        bagsCount: bags.length,
        downloadSpeed,
        uploadSpeed,
      })
    })

    return () => {
      unsubBagsUpdated()
    }
  }, [setStorageStats])

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
      <span className="text-primary">
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
      className="flex items-center justify-between px-3 py-1 bg-[hsl(var(--elevation-0))] border-t border-border text-xs text-chrome-foreground"
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
          className="flex items-center gap-1.5 text-chrome-foreground transition-colors"
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
        {isZoomable && (
          <>
            <SliderInput
              value={zoom}
              onChange={setActiveZoom}
              min={PAGE_ZOOM.MIN_PERCENT}
              max={PAGE_ZOOM.MAX_PERCENT}
              step={PAGE_ZOOM.STEP_PERCENT}
              suffix="%"
              ariaLabel={t('statusBar.zoom')}
              compact
              className="opacity-70"
            />
            <Separator />
          </>
        )}
        {walletCreated && (
          <>
            <button
              type="button"
              onClick={() => openOrSwitchToTab(TON_WALLET_PAGE)}
              className="flex items-center gap-1 text-tonsite transition-colors"
              title={t('statusBar.walletTitle')}
              aria-label={t('statusBar.walletAria')}
            >
              <AppIcon name="wallet" className="h-3 w-3" />
              <span>{formatTonAmount(walletBalance)} GRAM</span>
            </button>
            <Separator />
          </>
        )}
        <span className="text-chrome-foreground opacity-60" aria-label={`Version ${APP_VERSION}`}>
          v{APP_VERSION}
        </span>
        <Separator />
        <Clock locale={i18n.language} />
      </div>
    </footer>
  )
})
