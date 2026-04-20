import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandle, tonsiteHandle, bridgeRestartLimiter, log } from './shared'
import { REQUIRED_NAMESPACES } from '../../../shared/bridge-config'
import { writeSecureJsonAtomic } from '../../utils/secure-fs'
import type { BridgeScope } from '../../../shared/types'
import type { BridgeConfig } from '../../../shared/bridge-config'
import type { ServiceRegistry } from '../../services'

function getBridgeConfigPath(): string {
  return path.join(app.getPath('userData'), 'bridge', 'config.json')
}

export function registerBridgeHandlers(registry: ServiceRegistry): void {
  const { bridgeInterceptor, bridgePermissionStore, proxyManager } = registry

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

  // Bridge config: read
  secureHandle(IPC_CHANNELS.BRIDGE_GET_CONFIG, () => {
    const configPath = getBridgeConfigPath()
    try {
      if (!fs.existsSync(configPath)) return null
      const data = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(data)
    } catch (err) {
      log.error('Failed to read bridge config:', err)
      return null
    }
  })

  // Bridge config: write (deep-merge, enforce required namespaces)
  secureHandle(IPC_CHANNELS.BRIDGE_SET_CONFIG, (partial: Partial<BridgeConfig>) => {
    const configPath = getBridgeConfigPath()
    try {
      let existing: Record<string, unknown> = {}
      if (fs.existsSync(configPath)) {
        existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      }

      // Destructure to avoid mutating the caller's object
      const { namespaces: partialNs, websocket: partialWs, ...topLevel } = partial

      // Deep-merge namespaces
      if (partialNs) {
        const existingNs = (existing.namespaces as Record<string, unknown>) || {}
        for (const [key, value] of Object.entries(partialNs)) {
          existingNs[key] = {
            ...((existingNs[key] as Record<string, unknown>) || {}),
            ...(value as Record<string, unknown>),
          }
        }
        existing.namespaces = existingNs
      }

      // Deep-merge websocket
      if (partialWs) {
        existing.websocket = { ...((existing.websocket as Record<string, unknown>) || {}), ...partialWs }
      }

      // Merge top-level fields
      Object.assign(existing, topLevel)

      // Enforce required namespaces are always enabled
      const ns = (existing.namespaces as Record<string, Record<string, unknown>>) || {}
      for (const required of REQUIRED_NAMESPACES) {
        if (!ns[required]) ns[required] = {}
        ns[required].enabled = true
      }
      existing.namespaces = ns

      writeSecureJsonAtomic(configPath, existing)

      return { success: true }
    } catch (err) {
      log.error('Failed to write bridge config:', err)
      return { success: false, error: String(err) }
    }
  })

  // Bridge restart (bridge process only; proxy stays up)
  secureHandle(IPC_CHANNELS.BRIDGE_RESTART, async () => {
    if (!bridgeRestartLimiter.check()) {
      return { success: false, error: 'Bridge restart rate limit exceeded' }
    }
    try {
      await proxyManager.restartBridge()
      return { success: true }
    } catch (err) {
      log.error('Failed to restart bridge:', err)
      return { success: false, error: String(err) }
    }
  })

  log.info('Bridge handlers registered')
}
