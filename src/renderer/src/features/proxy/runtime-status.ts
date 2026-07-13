import type { ProxyStatusEvent } from '@shared/ipc-events'

export interface ProxyRuntimeClient {
  onStatus(listener: (status: ProxyStatusEvent) => void): () => void
  status(): Promise<unknown>
}

export function subscribeProxyRuntimeStatus(
  client: ProxyRuntimeClient,
  apply: (status: unknown) => void,
  onError: (error: unknown) => void
): () => void {
  let disposed = false
  let eventReceived = false
  const unsubscribe = client.onStatus((status) => {
    if (disposed) return
    eventReceived = true
    apply(status)
  })

  void client
    .status()
    .then((status) => {
      if (!disposed && !eventReceived) apply(status)
    })
    .catch((error) => {
      if (!disposed) onError(error)
    })

  return () => {
    disposed = true
    unsubscribe()
  }
}
