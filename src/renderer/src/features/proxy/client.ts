import type { ProxyStatusEvent } from '@shared/ipc-events'

export const proxyClient = {
  connect: () => window.electron.proxy.connect(),
  status: () => window.electron.proxy.status(),
  onStatus: (listener: (status: ProxyStatusEvent) => void) => window.electron.on('proxy:status', listener),
  onProgress: (listener: (progress: { step: number; message: string }) => void) =>
    window.electron.on('proxy:progress', listener),
  onAutoConnect: (listener: () => void) => window.electron.on('proxy:auto-connect', listener),
}
