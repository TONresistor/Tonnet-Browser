// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CocoonSection } from '../CocoonSection'
import { defaultPreferences } from '@/features/settings/preferences-store'

vi.mock('@/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/features/cocoon/client', () => ({ cocoonClient: { walletExists: async () => false } }))
vi.mock('@/features/cocoon/components/RecoveryPanel', () => ({ RecoveryPanel: () => null }))
vi.mock('@/features/browser/navigation', () => ({ useOpenOrSwitchBrowserTab: () => vi.fn() }))

it('offers an independent Cocoon toggle and disables autostart controls while Cocoon is off', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const setDraft = vi.fn()
  try {
    await act(async () => root.render(<CocoonSection draft={defaultPreferences} setDraft={setDraft} />))
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="cocoon.enabled"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle.click())
    expect(setDraft).toHaveBeenCalledWith('cocoonEnabled', false)
    await act(async () =>
      root.render(<CocoonSection draft={{ ...defaultPreferences, cocoonEnabled: false }} setDraft={setDraft} />)
    )
    expect(container.querySelector('[aria-label="cocoon.enabled"]')?.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector<HTMLButtonElement>('[aria-label="cocoon.autostart"]')?.disabled).toBe(true)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
