import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { secureHandle, tonsiteHandle, log } from './shared'
import type { ServiceRegistry } from '../../services'

export function registerTonConnectHandlers(registry: ServiceRegistry): void {
  const { tonConnectService } = registry

  tonsiteHandle(IPC_CHANNELS.TONCONNECT_REQUEST, async (domain, event, payload: unknown) => {
    return tonConnectService.handleRequest(
      domain,
      event,
      payload as Parameters<typeof tonConnectService.handleRequest>[2]
    )
  })

  secureHandle(IPC_CHANNELS.TONCONNECT_GET_SESSIONS, () => {
    return tonConnectService.getSessions()
  })

  secureHandle(IPC_CHANNELS.TONCONNECT_DISCONNECT_SESSION, (domain: string) => {
    tonConnectService.disconnectSession(domain)
    return { success: true }
  })

  log.info('TON Connect handlers registered')
}
