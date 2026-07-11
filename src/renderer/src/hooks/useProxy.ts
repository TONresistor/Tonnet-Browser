/**
 * Hook for starting the TON proxy connection from the landing screen.
 */

import { errorMessage } from '@shared/errors'
import { useState, useCallback } from 'react'
import { useBrowserStore } from '../stores/browser'
import { proxyClient } from '@/features/proxy/client'

export function useProxy() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setProxyStatus = useBrowserStore((s) => s.setProxyStatus)

  const connect = useCallback(async () => {
    setIsConnecting(true)
    // Warm the StartPage chunk during the proxy bootstrap so it is already loaded
    // by the time proxyConnected flips true, avoiding the Suspense fallback flash.
    void import('@/components/pages/StartPage')
    setError(null)

    try {
      const result = await proxyClient.connect()
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
