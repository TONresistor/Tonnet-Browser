// @vitest-environment happy-dom
import { Suspense, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InternalRouteContent } from '../InternalRouteContent'

const resourceState = vi.hoisted(() => ({ status: 'downloading' }))
vi.mock('@/features/zkresistor/components/ZkResistorResourceStatus', () => ({
  ZkResistorResourceStatus: () => <div>Resources loading</div>,
}))
vi.mock('@/features/zkresistor/resources-store', () => ({
  useZkResistorResources: (select: (state: { state: { status: string } }) => unknown) =>
    select({ state: resourceState }),
}))

const state = vi.hoisted(() => ({ isLoaded: false, saved: { zkResistorEnabled: false } }))
vi.mock('@/features/settings/preferences-store', () => ({
  usePreferencesStore: (select: (value: typeof state) => unknown) => select(state),
}))
vi.mock('@/components/pages/StartPage', () => ({ StartPage: () => <div>Start</div> }))
vi.mock('@/features/settings/components/SettingsPage', () => ({ SettingsPage: () => null }))
vi.mock('@/features/storage/components/StoragePage', () => ({ StoragePage: () => null }))
vi.mock('@/features/wallet/components/WalletPage', () => ({ WalletPage: () => null }))
vi.mock('@/features/themes/components/ThemePage', () => ({ ThemePage: () => null }))
vi.mock('@/features/history/components/HistoryPage', () => ({ HistoryPage: () => null }))
vi.mock('@/features/bookmarks/components/BookmarksPage', () => ({ BookmarksPage: () => null }))
vi.mock('@/features/messenger/components/ChatPage', () => ({ default: () => null }))
vi.mock('@/features/dns/components/DnsPage', () => ({ default: () => null }))
vi.mock('@/features/cocoon/components/CocoonChatPage', () => ({ default: () => null }))
vi.mock('@/features/zkresistor/components/ZkResistorPage', () => ({ default: () => <div>ZKR catalog</div> }))
vi.mock('@/features/zkresistor/components/ZkResistorPoolPage', () => ({ default: () => <div>ZKR pool</div> }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  resourceState.status = 'downloading'
  state.isLoaded = false
  state.saved.zkResistorEnabled = false
})

describe('experimental ZKResistor routes', () => {
  it.each([
    { route: { kind: 'zkresistor', view: 'zkresistor' }, content: 'ZKR catalog' },
    { route: { kind: 'zkresistor-pool', view: 'zkresistor-pool', poolAddress: 'EQ-pool' }, content: 'ZKR pool' },
  ] as const)('gates $content on the saved setting and hides it after disabling', async ({ route, content }) => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const render = () =>
      act(async () => {
        root!.render(
          <Suspense fallback="Loading">
            <InternalRouteContent route={route} loading="Loading" />
          </Suspense>
        )
      })
    await render()
    expect(container.textContent).toBe('Start')
    state.saved.zkResistorEnabled = true
    await render()
    expect(container.textContent).toBe('Start')
    state.isLoaded = true
    await render()
    expect(container.textContent).toBe('Resources loading')
    resourceState.status = 'ready'
    await render()
    expect(container.textContent).toBe(content)
    state.saved.zkResistorEnabled = false
    await render()
    expect(container.textContent).toBe('Start')
  })
})
