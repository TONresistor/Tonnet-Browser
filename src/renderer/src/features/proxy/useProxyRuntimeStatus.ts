import { useEffect } from 'react'
import { ProxyStatusSchema } from '@shared/ipc-contract/proxy'
import { useBrowserStore } from '@/stores/browser'
import { createLogger } from '@/logger'
import { proxyClient } from './client'
import { subscribeProxyRuntimeStatus } from './runtime-status'

const log = createLogger('proxy-runtime')

function applyProxyRuntimeStatus(status: unknown): void {
  const parsed = ProxyStatusSchema.safeParse(status)
  if (!parsed.success) {
    log.error('Invalid proxy status:', status)
    return
  }
  const value = parsed.data
  useBrowserStore
    .getState()
    .setProxyStatus(
      value.status === 'connected',
      value.status === 'starting' || value.status === 'syncing',
      value.port,
      value.anonymousMode,
      value.circuitRelays
    )
}

export function useProxyRuntimeStatus(): void {
  useEffect(
    () =>
      subscribeProxyRuntimeStatus(proxyClient, applyProxyRuntimeStatus, (error) =>
        log.error('Proxy status failed:', error)
      ),
    []
  )
}
