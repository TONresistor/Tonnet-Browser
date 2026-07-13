import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyBridgeDefaults, syncMessengerBridgeNamespaces, writeProxyConfig } from '../config-writer'

const tmpRoots: string[] = []

function makeWorkDir(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tonnet-bridge-config-'))
  tmpRoots.push(dir)
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
  return dir
}

function makeEmptyWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tonnet-proxy-config-'))
  tmpRoots.push(dir)
  return dir
}

function readConfig(dir: string): Record<string, any> {
  return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as Record<string, any>
}

function baseConfig(): Record<string, unknown> {
  return {
    namespaces: {
      lite: { enabled: false },
      wallet: { enabled: false },
      subscribe: { enabled: false },
      dns: { enabled: false },
      adnl: { enabled: true },
      overlay: { enabled: true },
      dht: { enabled: true },
    },
  }
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('bridge config writer messenger namespaces', () => {
  it('defaults chat namespaces off and required namespaces on', async () => {
    const dir = makeWorkDir(baseConfig())

    await applyBridgeDefaults(dir)

    const config = readConfig(dir)
    expect(config._browserDefaults).toBe(true)
    expect(config._messengerNamespacesManaged).toBe(false)
    expect(config.namespaces.lite.enabled).toBe(true)
    expect(config.namespaces.wallet.enabled).toBe(true)
    expect(config.namespaces.subscribe.enabled).toBe(true)
    expect(config.namespaces.dns.enabled).toBe(true)
    expect(config.namespaces.adnl.enabled).toBe(false)
    expect(config.namespaces.overlay.enabled).toBe(false)
    expect(config.namespaces.dht.enabled).toBe(false)
  })

  it('enables and disables chat namespaces when Messenger manages them', async () => {
    const dir = makeWorkDir(baseConfig())
    await applyBridgeDefaults(dir)

    await expect(syncMessengerBridgeNamespaces(dir, true)).resolves.toBe(true)
    let config = readConfig(dir)
    expect(config._messengerNamespacesManaged).toBe(true)
    expect(config.namespaces.adnl.enabled).toBe(true)
    expect(config.namespaces.overlay.enabled).toBe(true)
    expect(config.namespaces.dht.enabled).toBe(true)

    await expect(syncMessengerBridgeNamespaces(dir, false)).resolves.toBe(true)
    config = readConfig(dir)
    expect(config._messengerNamespacesManaged).toBe(false)
    expect(config.namespaces.adnl.enabled).toBe(false)
    expect(config.namespaces.overlay.enabled).toBe(false)
    expect(config.namespaces.dht.enabled).toBe(false)
  })

  it('does not disable manually enabled chat namespaces when Messenger did not manage them', async () => {
    const dir = makeWorkDir({
      ...baseConfig(),
      _browserDefaults: true,
      _messengerNamespacesManaged: false,
    })

    await applyBridgeDefaults(dir)

    const config = readConfig(dir)
    expect(config.namespaces.adnl.enabled).toBe(true)
    expect(config.namespaces.overlay.enabled).toBe(true)
    expect(config.namespaces.dht.enabled).toBe(true)
  })
})

describe('proxy config writer', () => {
  it('does not encode HTTP blocking in generated configs', async () => {
    const dir = makeEmptyWorkDir()

    await writeProxyConfig(dir, 2)

    expect(readConfig(dir)).not.toHaveProperty('BlockHTTP')
  })

  it('removes the unsupported BlockHTTP field from existing configs', async () => {
    const dir = makeWorkDir({
      BlockHTTP: true,
      TunnelConfig: { NodesPoolConfigPath: 'stale', TunnelSectionsNum: 0 },
    })

    await writeProxyConfig(dir, 2)

    const config = readConfig(dir)
    expect(config).not.toHaveProperty('BlockHTTP')
    expect(config.TunnelConfig.NodesPoolConfigPath).toBe('')
    expect(config.TunnelConfig.TunnelSectionsNum).toBe(2)
  })
})
