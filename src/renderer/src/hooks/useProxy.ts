/**
 * Hook for TON proxy connection.
 * Connect, disconnect, and track status.
 */

import { useState, useCallback } from 'react'
import { useSettingsStore } from '../stores/settings'

export function useProxy() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { proxyConnected, setProxyStatus } = useSettingsStore()

  const connect = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    try {
      const result = await window.electron.proxy.connect()
      if (result.success) {
        // Proxy started successfully - consider it "connected" for UI purposes
        // StatusBar will show "Syncing..." until DHT sync completes
        const isSyncing = result.status === 'syncing'
        setProxyStatus(true, isSyncing, result.port)
      } else {
        setError(result.error ?? 'Failed to connect')
        setProxyStatus(false)
      }
    } catch (err) {
      setError((err as Error).message)
      setProxyStatus(false)
    } finally {
      setIsConnecting(false)
    }
  }, [setProxyStatus])

  const disconnect = useCallback(async () => {
    try {
      await window.electron.proxy.disconnect()
      setProxyStatus(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [setProxyStatus])

  const checkStatus = useCallback(async () => {
    try {
      const status = await window.electron.proxy.status()
      setProxyStatus(status.connected, status.port)
    } catch {
      setProxyStatus(false)
    }
  }, [setProxyStatus])

  return {
    connected: proxyConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    checkStatus,
  }
}
