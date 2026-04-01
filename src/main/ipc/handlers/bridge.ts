import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandle, tonsiteHandle, log } from './shared'
import { bridgeInterceptor } from '../../bridge/permission-interceptor'
import { bridgePermissionStore } from '../../bridge/permission-store'
import type { BridgeScope } from '../../../shared/types'

export function registerBridgeHandlers(): void {
  tonsiteHandle(IPC_CHANNELS.BRIDGE_SEND, async (domain, event, data: string) => {
    return new Promise<void>((resolve) => {
      bridgeInterceptor.handleRequest(
        domain,
        data,
        (response: string) => {
          event.sender.send(IPC_CHANNELS.BRIDGE_MESSAGE, response)
          resolve()
        },
        event.sender
      )
    })
  })

  secureHandle(IPC_CHANNELS.BRIDGE_GET_PERMISSIONS, () => {
    return bridgePermissionStore.getAllPermissions()
  })

  secureHandle(IPC_CHANNELS.BRIDGE_REVOKE_PERMISSION, (domain: string, scope: BridgeScope) => {
    bridgePermissionStore.revokePermission(domain, scope)
    return { success: true }
  })

  log.info('Bridge permission handlers registered')
}
