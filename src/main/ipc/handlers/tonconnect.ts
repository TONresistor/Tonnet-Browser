import { log } from './shared'
import type { ServiceRegistry } from '../../services'
import {
  tonConnectDisconnectSessionContract,
  tonConnectGetSessionsContract,
  tonConnectRequestContract,
} from '../../../shared/ipc-contract/tonconnect'
import { secureContractHandle, tonsiteContractHandle } from '../contract-handler'

export function registerTonConnectHandlers(registry: ServiceRegistry): void {
  const { tonConnectService } = registry

  tonsiteContractHandle(
    tonConnectRequestContract,
    (event) => registry.tabManager.resolveSenderIdentity(event.sender),
    async (domain, event, payload) => {
      return tonConnectService.handleRequest(domain, event, payload)
    }
  )

  secureContractHandle(tonConnectGetSessionsContract, () => {
    return tonConnectService.getSessions()
  })

  secureContractHandle(tonConnectDisconnectSessionContract, async (domain) => {
    await tonConnectService.disconnectSession(domain)
    return { success: true }
  })

  log.debug('TON Connect handlers registered')
}
