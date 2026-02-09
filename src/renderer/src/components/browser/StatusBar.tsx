/**
 * Status bar at the bottom.
 * Shows connection status and storage stats.
 */

import { useEffect, useState, memo } from 'react'
import { Wifi, WifiOff, Loader2, ArrowDown, ArrowUp, Zap } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { APP_VERSION } from '@shared/constants'
import type { StorageBag } from '@shared/types'
import { useTranslation } from 'react-i18next'

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
  return `${(bytesPerSecond / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatTime(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Separator component
function Separator() {
  return <div className="w-px h-3 bg-border" />
}

export const StatusBar = memo(function StatusBar() {
  const { t, i18n } = useTranslation('browser')
  const { proxyConnected, proxySyncing, anonymousMode, circuitRelays, storageStats, setProxyStatus, setStorageStats } = useSettingsStore()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [bandwidth, setBandwidth] = useState({ down: 0, up: 0 })
  const [latency, setLatency] = useState<number | null>(null)

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    // Listen for proxy status updates from main process
    const unsubProxyStatus = window.electron.on('proxy:status', (...args: unknown[]) => {
      const data = args[0]
      // Runtime validation
      if (!data || typeof data !== 'object') {
        console.error('[StatusBar] Invalid proxy:status data:', data)
        return
      }
      const status = data as { status: string; anonymousMode?: boolean; circuitRelays?: string[] }
      if (typeof status.status !== 'string') {
        console.error('[StatusBar] Invalid status field type')
        return
      }
      setProxyStatus(
        status.status === 'connected',
        status.status === 'syncing',
        undefined,
        status.anonymousMode,
        status.circuitRelays
      )
    })

    // Listen for bandwidth updates
    const unsubBandwidth = window.electron.on('proxy:bandwidth', (...args: unknown[]) => {
      const data = args[0]
      // Runtime validation
      if (!data || typeof data !== 'object') {
        console.error('[StatusBar] Invalid proxy:bandwidth data:', data)
        return
      }
      const bandwidth = data as { down: number; up: number; latency?: number }
      if (typeof bandwidth.down !== 'number' || typeof bandwidth.up !== 'number') {
        console.error('[StatusBar] Invalid bandwidth field types')
        return
      }
      setBandwidth({ down: bandwidth.down, up: bandwidth.up })
      if (bandwidth.latency && typeof bandwidth.latency === 'number') {
        setLatency(bandwidth.latency)
      }
    })

    // Listen for storage bags updates
    const unsubBagsUpdated = window.electron.on('storage:bags-updated', (...args: unknown[]) => {
      const bags = args[0] as StorageBag[]
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
      unsubBandwidth()
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
          <Loader2 className="h-3 w-3 text-warning animate-spin" aria-hidden="true" />
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

    const isReady = circuitRelays.length === 3

    return (
      <span className="text-tonsite">
        {isReady ? t('statusBar.garlicRouting') : t('statusBar.buildingCircuit')}
      </span>
    )
  }

  const statusText = proxyConnected ? t('statusBar.connected') : proxySyncing ? t('statusBar.syncing') : t('statusBar.disconnected')

  return (
    <footer className="flex items-center justify-between px-3 py-1 bg-background-secondary border-t border-border text-xs text-muted-foreground" role="contentinfo">
      <div className="flex items-center gap-3">
        {/* Network Status */}
        <div className="flex items-center gap-1.5" role="status" aria-live="polite" aria-label={t('statusBar.networkStatus', { status: statusText })}>
          {getNetworkStatus()}
        </div>

        {/* Garlic Routing */}
        {anonymousMode && (
          <>
            <Separator />
            <div className="flex items-center gap-1.5">
              {getGarlicStatus()}
            </div>
          </>
        )}

        {/* Storage Bags */}
        <Separator />
        <div className="flex items-center gap-1.5 text-muted-foreground" aria-label={`${storageStats.bagsCount} ${storageStats.bagsCount === 1 ? t('statusBar.bag') : t('statusBar.bags')}`}>
          <span>{t('statusBar.storage')}</span>
          <span>{storageStats.bagsCount} {storageStats.bagsCount === 1 ? t('statusBar.bag') : t('statusBar.bags')}</span>
        </div>

        {/* Transfer Speeds */}
        {(storageStats.downloadSpeed > 0 || storageStats.uploadSpeed > 0) && (
          <>
            <Separator />
            <div className="flex items-center gap-1" aria-label={`Download speed: ${formatSpeed(storageStats.downloadSpeed)}`}>
              <ArrowDown className="h-3 w-3 text-info" aria-hidden="true" />
              <span>{formatSpeed(storageStats.downloadSpeed)}</span>
            </div>
            <div className="flex items-center gap-1" aria-label={`Upload speed: ${formatSpeed(storageStats.uploadSpeed)}`}>
              <ArrowUp className="h-3 w-3 text-success" aria-hidden="true" />
              <span>{formatSpeed(storageStats.uploadSpeed)}</span>
            </div>
          </>
        )}

        {/* Latency */}
        {latency !== null && (
          <>
            <Separator />
            <div className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-warning" aria-hidden="true" />
              <span className="text-warning">{latency}ms</span>
            </div>
          </>
        )}

        {/* Bandwidth */}
        {(bandwidth.down > 0 || bandwidth.up > 0) && (
          <>
            <Separator />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{t('statusBar.session')}</span>
              <ArrowDown className="h-3 w-3 text-info" aria-hidden="true" />
              <span>{formatBytes(bandwidth.down)}</span>
              <ArrowUp className="h-3 w-3 text-success" aria-hidden="true" />
              <span>{formatBytes(bandwidth.up)}</span>
            </div>
          </>
        )}
      </div>

      {/* Right side: version + clock */}
      <div className="flex items-center gap-3">
        <span aria-label={`Version ${APP_VERSION}`}>v{APP_VERSION}</span>
        <Separator />
        <span className="text-foreground">{formatTime(currentTime, i18n.language)}</span>
      </div>
    </footer>
  )
})
