// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSidebarGate } from '../WalletSidebarGate'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}))

describe('WalletSidebarGate', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('unlocks inline and keeps a full-page footer action', async () => {
    const onOpenFull = vi.fn()
    await act(async () => {
      root.render(
        <WalletSidebarGate
          mode="unlock"
          password=""
          pending={false}
          error={null}
          onPassword={vi.fn()}
          onSubmit={vi.fn()}
          onOpenFull={onOpenFull}
          onClose={vi.fn()}
        />
      )
    })

    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(container.textContent).toContain('Unlock')
    const fullPage = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open full wallet')
    )
    expect(fullPage).toBeDefined()
    await act(async () => fullPage?.click())
    expect(onOpenFull).toHaveBeenCalledOnce()
  })
})
