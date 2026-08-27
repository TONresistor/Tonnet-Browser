// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSystemStorageGate } from '../WalletSystemStorageGate'

const { retrySystemStorage } = vi.hoisted(() => ({
  retrySystemStorage: vi.fn(() => Promise.resolve({ success: true as const })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}))

vi.mock('@/features/wallet/client', () => ({
  walletClient: { retrySystemStorage },
}))

describe('WalletSystemStorageGate', () => {
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
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the existing wallet safe and offers a retry', async () => {
    const onDismiss = vi.fn()
    await act(async () => root.render(<WalletSystemStorageGate onDismiss={onDismiss} />))

    expect(container.textContent).toContain('Wallet access blocked')
    expect(container.textContent).toContain('Your wallet is still on this device.')
    expect(container.textContent).not.toContain('Create wallet')
    expect(container.textContent).not.toContain('Import')
    expect(container.textContent).not.toContain('Delete')

    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try again')
    const dismiss = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Not now')

    await act(async () => retry?.click())
    expect(retrySystemStorage).toHaveBeenCalledOnce()

    await act(async () => dismiss?.click())
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
