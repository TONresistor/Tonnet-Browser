import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsSchema } from '@shared/types'
import type { SettingsChangedEvent } from '@shared/ipc-events'
import type { BridgeConfig } from '@shared/bridge-config'
import type { WalletSectionHandle } from '../components/sections/WalletSection'
import type { BridgeSectionHandle } from '../components/sections/BridgeSection'
import type { Http402SectionHandle } from '../components/sections/Http402ExperimentalPanel'

const mocks = vi.hoisted(() => ({
  settingsListeners: new Set<(event: SettingsChangedEvent) => void>(),
  getWalletSettings: vi.fn(),
  updateWalletSettings: vi.fn(),
  getBridgeConfig: vi.fn(),
  setBridgeConfig: vi.fn(),
  getBridgeSettings: vi.fn(),
  updateBridgeSettings: vi.fn(),
  getBridgePermissions: vi.fn(),
  revokeBridgePermission: vi.fn(),
  restartBridge: vi.fn(),
}))

vi.mock('@/features/settings/client', () => ({
  settingsClient: {
    onChanged: vi.fn((listener: (event: SettingsChangedEvent) => void) => {
      mocks.settingsListeners.add(listener)
      return () => mocks.settingsListeners.delete(listener)
    }),
  },
}))

vi.mock('@/features/wallet/client', () => ({
  walletClient: {
    getSettings: mocks.getWalletSettings,
    updateSettings: mocks.updateWalletSettings,
    onSettingsChanged: vi.fn((listener: (event: SettingsChangedEvent) => void) => {
      mocks.settingsListeners.add(listener)
      return () => mocks.settingsListeners.delete(listener)
    }),
  },
}))

vi.mock('@/features/bridge/client', () => ({
  bridgeClient: {
    getConfig: mocks.getBridgeConfig,
    setConfig: mocks.setBridgeConfig,
    getSettings: mocks.getBridgeSettings,
    updateSettings: mocks.updateBridgeSettings,
    getPermissions: mocks.getBridgePermissions,
    revokePermission: mocks.revokeBridgePermission,
    restart: mocks.restartBridge,
  },
}))

vi.mock('@/features/settings/components/sections/WalletManagementPanel', () => ({
  WalletManagementPanel: () => null,
}))

vi.mock('@/features/settings/components/sections/ConnectedAppsPanel', () => ({
  ConnectedAppsPanel: () => null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

const bridgeConfig: BridgeConfig = {
  version: 1,
  websocket: {},
  namespaces: {
    lite: {},
    wallet: {},
    subscribe: {},
    dns: {},
    subscribe_trace: { enabled: false },
    adnl: { enabled: false },
    overlay: { enabled: false },
    dht: { enabled: false },
    jetton: { enabled: false },
    nft: { enabled: false },
    sbt: { enabled: false },
    payment: { enabled: false },
    network: { enabled: false },
  },
}

let cleanup: (() => Promise<void>) | null = null

function installDom(): void {
  const browser = new Window({ url: 'http://localhost' })
  const globals: Record<string, unknown> = {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    Node: browser.Node,
    Element: browser.Element,
    HTMLElement: browser.HTMLElement,
    HTMLButtonElement: browser.HTMLButtonElement,
    HTMLInputElement: browser.HTMLInputElement,
    HTMLIFrameElement: browser.HTMLIFrameElement,
    SVGElement: browser.SVGElement,
    Event: browser.Event,
    MouseEvent: browser.MouseEvent,
    CustomEvent: browser.CustomEvent,
    MutationObserver: browser.MutationObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
}

async function renderSection(
  component: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>
): Promise<HTMLDivElement> {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(component, props))
  })
  cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return container
}

async function emitSettings(event: SettingsChangedEvent): Promise<void> {
  const { act } = await import('react')
  await act(async () => {
    for (const listener of mocks.settingsListeners) listener(event)
  })
}

function option(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === label)
  if (!button) throw new Error(`Missing option ${label}`)
  return button
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('canonical settings sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.settingsListeners.clear()
    installDom()
    mocks.updateWalletSettings.mockResolvedValue({ success: true })
    mocks.setBridgeConfig.mockResolvedValue({ success: true })
    mocks.updateBridgeSettings.mockResolvedValue({ success: true })
    mocks.getBridgePermissions.mockResolvedValue([])
    mocks.revokeBridgePermission.mockResolvedValue({ success: true })
    mocks.restartBridge.mockResolvedValue({ success: true })
  })

  afterEach(async () => {
    await cleanup?.()
    cleanup = null
    vi.unstubAllGlobals()
  })

  it('converges the wallet draft and UI on a canonical wallet update', async () => {
    const initial = AppSettingsSchema.parse({
      wallet: {
        indexerEnabled: true,
        indexerEndpoint: 'https://initial.example',
        indexerApiKey: 'initial',
      },
    })
    mocks.getWalletSettings.mockResolvedValue(initial.wallet)
    const React = await import('react')
    const sectionRef = React.createRef<WalletSectionHandle | null>()
    const { WalletSection } = await import('../components/sections/WalletSection')
    const container = await renderSection(WalletSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const indexer = container.querySelector('[role="switch"][aria-label="wallet.indexerEnabled"]') as HTMLButtonElement

    await React.act(async () => indexer.click())
    expect(sectionRef.current?.hasChanges).toBe(true)

    const canonical = AppSettingsSchema.parse({
      wallet: {
        indexerEnabled: true,
        indexerEndpoint: 'https://canonical.example',
        indexerApiKey: 'canonical',
      },
    })
    await emitSettings({ category: 'wallet', values: canonical.wallet, settings: canonical })

    const updatedIndexer = container.querySelector('[role="switch"][aria-label="wallet.indexerEnabled"]')
    const endpoint = container.querySelector('[aria-label="wallet.indexerEndpoint"]') as HTMLInputElement
    expect(updatedIndexer?.getAttribute('aria-checked')).toBe('true')
    expect(endpoint.value).toBe('https://canonical.example')
    expect(sectionRef.current?.hasChanges).toBe(false)
  })

  it('converges the wallet state after Reset All', async () => {
    const initial = AppSettingsSchema.parse({ wallet: { indexerEnabled: true } })
    mocks.getWalletSettings.mockResolvedValue(initial.wallet)
    const React = await import('react')
    const sectionRef = React.createRef<WalletSectionHandle | null>()
    const { WalletSection } = await import('../components/sections/WalletSection')
    const container = await renderSection(WalletSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const reset = AppSettingsSchema.parse({})

    await emitSettings({ reset: true, settings: reset })

    const indexer = container.querySelector('[role="switch"][aria-label="wallet.indexerEnabled"]')
    expect(indexer?.getAttribute('aria-checked')).toBe('false')
    expect(sectionRef.current?.hasChanges).toBe(false)
  })

  it('preserves an indexer draft across unrelated wallet updates', async () => {
    const initial = AppSettingsSchema.parse({ wallet: { indexerEnabled: false } })
    mocks.getWalletSettings.mockResolvedValue(initial.wallet)
    const React = await import('react')
    const sectionRef = React.createRef<WalletSectionHandle | null>()
    const { WalletSection } = await import('../components/sections/WalletSection')
    const container = await renderSection(WalletSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const indexer = container.querySelector('[role="switch"][aria-label="wallet.indexerEnabled"]') as HTMLButtonElement

    await React.act(async () => indexer.click())
    const canonical = AppSettingsSchema.parse({ wallet: { paymentMode: 'manual', indexerEnabled: false } })
    await emitSettings({ category: 'wallet', values: { paymentMode: 'manual' }, settings: canonical })

    expect(indexer.getAttribute('aria-checked')).toBe('true')
    expect(sectionRef.current?.hasChanges).toBe(true)
  })

  it('keeps Reset All authoritative over a late HTTP 402 load', async () => {
    const pending = deferred<ReturnType<typeof AppSettingsSchema.parse>['wallet']>()
    mocks.getWalletSettings.mockReturnValue(pending.promise)
    const React = await import('react')
    const sectionRef = React.createRef<Http402SectionHandle | null>()
    const { Http402ExperimentalPanel } = await import('../components/sections/Http402ExperimentalPanel')
    const container = await renderSection(Http402ExperimentalPanel as React.ComponentType<Record<string, unknown>>, {
      sectionRef,
    })
    const reset = AppSettingsSchema.parse({})

    await emitSettings({ reset: true, settings: reset })
    await React.act(async () => {
      pending.resolve(AppSettingsSchema.parse({ wallet: { paymentMode: 'auto' } }).wallet)
    })

    const enabled = container.querySelector('[role="switch"][aria-label="advanced.experimental.http402"]')
    expect(enabled?.getAttribute('aria-checked')).toBe('false')
    expect(sectionRef.current?.hasChanges).toBe(false)
  })

  it('preserves an HTTP 402 draft across an indexer update', async () => {
    const initial = AppSettingsSchema.parse({ wallet: { paymentMode: 'off' } })
    mocks.getWalletSettings.mockResolvedValue(initial.wallet)
    const React = await import('react')
    const sectionRef = React.createRef<Http402SectionHandle | null>()
    const { Http402ExperimentalPanel } = await import('../components/sections/Http402ExperimentalPanel')
    const container = await renderSection(Http402ExperimentalPanel as React.ComponentType<Record<string, unknown>>, {
      sectionRef,
    })
    const enabled = container.querySelector(
      '[role="switch"][aria-label="advanced.experimental.http402"]'
    ) as HTMLButtonElement

    await React.act(async () => enabled.click())
    const canonical = AppSettingsSchema.parse({ wallet: { paymentMode: 'off', indexerEnabled: true } })
    await emitSettings({ category: 'wallet', values: { indexerEnabled: true }, settings: canonical })

    expect(enabled.getAttribute('aria-checked')).toBe('true')
    expect(sectionRef.current?.hasChanges).toBe(true)
  })

  it('converges bridge settings without replacing the independent bridge config draft', async () => {
    const initial = AppSettingsSchema.parse({ bridge: { defaultPolicy: 'ask' } })
    mocks.getBridgeConfig.mockResolvedValue(bridgeConfig)
    mocks.getBridgeSettings.mockResolvedValue(initial.bridge)
    const React = await import('react')
    const sectionRef = React.createRef<BridgeSectionHandle | null>()
    const { BridgeSection } = await import('../components/sections/BridgeSection')
    const container = await renderSection(BridgeSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const jetton = container.querySelector(
      '[role="switch"][aria-label="bridge.namespaces.labels.jetton"]'
    ) as HTMLButtonElement

    await React.act(async () => jetton.click())
    const canonical = AppSettingsSchema.parse({ bridge: { defaultPolicy: 'deny' } })
    await emitSettings({ category: 'bridge', values: canonical.bridge, settings: canonical })

    expect(option(container, 'bridge.policyDeny').className).toContain('bg-elevation-4')
    expect(jetton.getAttribute('aria-checked')).toBe('true')
    expect(sectionRef.current?.hasChanges).toBe(true)

    await React.act(async () => sectionRef.current?.discard())
    expect(option(container, 'bridge.policyDeny').className).toContain('bg-elevation-4')
    expect(jetton.getAttribute('aria-checked')).toBe('false')
    expect(sectionRef.current?.hasChanges).toBe(false)
  })

  it('converges bridge policy and permissions after Reset All', async () => {
    const initial = AppSettingsSchema.parse({
      bridge: {
        defaultPolicy: 'deny',
        permissions: [
          {
            domain: 'persisted.example',
            scope: 'blockchain',
            decision: 'granted',
            grantedAt: 1,
          },
        ],
      },
    })
    mocks.getBridgeConfig.mockResolvedValue(bridgeConfig)
    mocks.getBridgeSettings.mockResolvedValue(initial.bridge)
    mocks.getBridgePermissions.mockResolvedValue(initial.bridge.permissions)
    const React = await import('react')
    const sectionRef = React.createRef<BridgeSectionHandle | null>()
    const { BridgeSection } = await import('../components/sections/BridgeSection')
    const container = await renderSection(BridgeSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const reset = AppSettingsSchema.parse({})

    expect(container.textContent).toContain('persisted.example')
    await emitSettings({ reset: true, settings: reset })

    expect(option(container, 'bridge.policyAsk').className).toContain('bg-elevation-4')
    expect(container.textContent).not.toContain('persisted.example')
    expect(sectionRef.current?.hasChanges).toBe(false)
  })

  it('preserves a policy draft across permission updates', async () => {
    const initial = AppSettingsSchema.parse({ bridge: { defaultPolicy: 'ask' } })
    mocks.getBridgeConfig.mockResolvedValue(bridgeConfig)
    mocks.getBridgeSettings.mockResolvedValue(initial.bridge)
    const React = await import('react')
    const sectionRef = React.createRef<BridgeSectionHandle | null>()
    const { BridgeSection } = await import('../components/sections/BridgeSection')
    const container = await renderSection(BridgeSection as React.ComponentType<Record<string, unknown>>, { sectionRef })

    await React.act(async () => option(container, 'bridge.policyDeny').click())
    const permission = {
      domain: 'canonical.example',
      scope: 'blockchain' as const,
      decision: 'granted' as const,
      grantedAt: 2,
    }
    const canonical = AppSettingsSchema.parse({ bridge: { defaultPolicy: 'ask', permissions: [permission] } })
    await emitSettings({ category: 'bridge', values: { permissions: [permission] }, settings: canonical })

    expect(option(container, 'bridge.policyDeny').className).toContain('bg-elevation-4')
    expect(container.textContent).toContain('canonical.example')
    expect(sectionRef.current?.hasChanges).toBe(true)
  })

  it('preserves session permissions when a canonical update wins the initial load race', async () => {
    const initial = AppSettingsSchema.parse({ bridge: { defaultPolicy: 'ask' } })
    const pendingPermissions = deferred<ReturnType<typeof AppSettingsSchema.parse>['bridge']['permissions']>()
    mocks.getBridgeConfig.mockResolvedValue(bridgeConfig)
    mocks.getBridgeSettings.mockResolvedValue(initial.bridge)
    mocks.getBridgePermissions.mockReturnValue(pendingPermissions.promise)
    const React = await import('react')
    const sectionRef = React.createRef<BridgeSectionHandle | null>()
    const { BridgeSection } = await import('../components/sections/BridgeSection')
    const container = await renderSection(BridgeSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const canonical = AppSettingsSchema.parse({
      bridge: {
        defaultPolicy: 'deny',
        permissions: [
          {
            domain: 'canonical.example',
            scope: 'blockchain',
            decision: 'granted',
            grantedAt: 2,
          },
        ],
      },
    })

    await emitSettings({ category: 'bridge', values: canonical.bridge, settings: canonical })
    await React.act(async () => {
      pendingPermissions.resolve([
        {
          domain: 'stale.example',
          scope: 'blockchain',
          decision: 'granted',
          grantedAt: 1,
        },
        {
          domain: 'session.example',
          scope: 'p2p',
          decision: 'session',
          grantedAt: 3,
        },
      ])
    })

    expect(container.textContent).toContain('canonical.example')
    expect(container.textContent).toContain('session.example')
    expect(container.textContent).not.toContain('stale.example')
    expect(option(container, 'bridge.policyDeny').className).toContain('bg-elevation-4')
  })

  it('does not restore stale session permissions after a reset during initial load', async () => {
    const initial = AppSettingsSchema.parse({ bridge: { defaultPolicy: 'deny' } })
    const pendingPermissions = deferred<ReturnType<typeof AppSettingsSchema.parse>['bridge']['permissions']>()
    mocks.getBridgeConfig.mockResolvedValue(bridgeConfig)
    mocks.getBridgeSettings.mockResolvedValue(initial.bridge)
    mocks.getBridgePermissions.mockReturnValue(pendingPermissions.promise)
    const React = await import('react')
    const sectionRef = React.createRef<BridgeSectionHandle | null>()
    const { BridgeSection } = await import('../components/sections/BridgeSection')
    const container = await renderSection(BridgeSection as React.ComponentType<Record<string, unknown>>, { sectionRef })
    const reset = AppSettingsSchema.parse({})

    await emitSettings({ reset: true, settings: reset })
    await React.act(async () => {
      pendingPermissions.resolve([
        {
          domain: 'stale-session.example',
          scope: 'p2p',
          decision: 'session',
          grantedAt: 3,
        },
      ])
    })

    expect(container.textContent).not.toContain('stale-session.example')
    expect(option(container, 'bridge.policyAsk').className).toContain('bg-elevation-4')
  })
})
