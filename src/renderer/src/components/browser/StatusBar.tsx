/**
 * Status bar at the bottom.
 * Shows connection status and storage stats.
 */

import { useEffect, useState } from 'react'
import { Wifi, WifiOff, Loader2, ArrowDown, ArrowUp, Zap } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { APP_VERSION } from '@shared/constants'
import type { StorageBag } from '@shared/types'

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

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Separator component
function Separator() {
  return <div className="w-px h-3 bg-border" />
}

export function StatusBar() {
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
      const data = args[0] as { status: string; anonymousMode?: boolean; circuitRelays?: string[] }
      setProxyStatus(
        data.status === 'connected',
        data.status === 'syncing',
        undefined,
        data.anonymousMode,
        data.circuitRelays
      )
    })

    // Listen for bandwidth updates
    const unsubBandwidth = window.electron.on('proxy:bandwidth', (...args: unknown[]) => {
      const data = args[0] as { down: number; up: number; latency?: number }
      setBandwidth({ down: data.down, up: data.up })
      if (data.latency) setLatency(data.latency)
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
          <span className="text-success">Connected to TON Network</span>
        </>
      )
    }
    if (proxySyncing) {
      return (
        <>
          <Loader2 className="h-3 w-3 text-warning animate-spin" aria-hidden="true" />
          <span className="text-warning">
            {anonymousMode ? 'Syncing with multi-hop circuit...' : 'Syncing...'}
          </span>
        </>
      )
    }
    return (
      <>
        <WifiOff className="h-3 w-3 text-destructive" aria-hidden="true" />
        <span className="text-destructive">Disconnected</span>
      </>
    )
  }

  const getGarlicStatus = () => {
    if (!anonymousMode) return null

    const isReady = circuitRelays.length === 3

    return (
      <span className="text-primary">
        {isReady ? 'Garlic Routing (3-hop)' : 'Building circuit...'}
      </span>
    )
  }

  const statusText = proxyConnected ? 'Connected' : proxySyncing ? 'Syncing' : 'Disconnected'

  return (
    <footer className="flex items-center justify-between px-3 py-1 bg-background-secondary border-t border-border text-xs text-muted-foreground" role="contentinfo">
      <div className="flex items-center gap-3">
        {/* Network Status */}
        <div className="flex items-center gap-1.5" role="status" aria-live="polite" aria-label={`Network status: ${statusText}`}>
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
        <div className="flex items-center gap-1.5 text-muted-foreground" aria-label={`${storageStats.bagsCount} storage bags`}>
          <span>Storage:</span>
          <span>{storageStats.bagsCount} bag{storageStats.bagsCount !== 1 ? 's' : ''}</span>
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
              <span className="text-muted-foreground">Session:</span>
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
        <span>{formatTime(currentTime)}</span>
      </div>
    </footer>
  )
}
