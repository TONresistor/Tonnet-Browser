// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { InternalRouteContent } from '../InternalRouteContent'

const state = vi.hoisted(() => ({ isLoaded: false, saved: { cocoonEnabled: true } }))
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
vi.mock('@/features/cocoon/components/CocoonChatPage', () => ({ default: () => <div>Cocoon chat</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  state.isLoaded = false
  state.saved.cocoonEnabled = true
})

it('hides an open Cocoon page after disabling the saved setting and restores it when enabled', async () => {
  state.isLoaded = true
  container = document.createElement('div')
  root = createRoot(container)
  const render = () =>
    act(async () => root!.render(<InternalRouteContent route={{ kind: 'cocoon', view: 'cocoon' }} loading="Loading" />))
  await render()
  expect(container.textContent).toBe('Cocoon chat')
  state.saved.cocoonEnabled = false
  await render()
  expect(container.textContent).toBe('Start')
  state.saved.cocoonEnabled = true
  await render()
  expect(container.textContent).toBe('Cocoon chat')
})
