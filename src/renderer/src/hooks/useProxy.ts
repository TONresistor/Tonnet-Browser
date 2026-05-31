/**
 * Hook for starting the TON proxy connection from the landing screen.
 */

import { errorMessage } from '@shared/errors'
import { useState, useCallback } from 'react'
import { useBrowserStore } from '../stores/browser'

export function useProxy() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setProxyStatus = useBrowserStore((s) => s.setProxyStatus)

  const connect = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    try {
      const result = await window.electron.proxy.connect()
      if (result.success) {
        // Proxy started successfully - consider it "connected" for UI purposes
        // StatusBar will show "Syncing..." until DHT sync completes
        setProxyStatus(true, false, result.port)
      } else {
        setError(result.error ?? 'Failed to connect')
        setProxyStatus(false)
      }
    } catch (err) {
      setError(errorMessage(err))
      setProxyStatus(false)
    } finally {
      setIsConnecting(false)
    }
  }, [setProxyStatus])

  return {
    isConnecting,
    error,
    connect,
  }
}
