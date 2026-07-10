import type { BridgeSettings } from '@shared/types'

export const bridgeClient = {
  getConfig: () => window.electron.bridge.getConfig(),
  setConfig: (config: Record<string, unknown>) => window.electron.bridge.setConfig(config),
  getPermissions: () => window.electron.bridge.getPermissions(),
  revokePermission: (domain: string, scope: 'blockchain' | 'p2p' | 'write') =>
    window.electron.bridge.revokePermission(domain, scope),
  restart: () => window.electron.bridge.restart(),
  getSettings: () => window.electron.settings.get('bridge'),
  updateSettings: (values: Partial<BridgeSettings>) => window.electron.settings.set('bridge', { ...values }),
}
