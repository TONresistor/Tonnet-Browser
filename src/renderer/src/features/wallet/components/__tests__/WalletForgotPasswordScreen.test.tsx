// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletForgotPasswordScreen } from '../WalletForgotPasswordScreen'

describe('WalletForgotPasswordScreen', () => {
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

  it('offers recovery with the existing 24 words', async () => {
    const onRecover = vi.fn()
    await act(async () => {
      root.render(<WalletForgotPasswordScreen onRecover={onRecover} onForget={vi.fn()} onBack={vi.fn()} />)
    })

    const recover = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Recover with 24 words')
    )
    expect(recover).toBeDefined()
    await act(async () => recover?.click())
    expect(onRecover).toHaveBeenCalledOnce()
  })

  it('uses the compact wallet-gate hierarchy in the sidebar', async () => {
    await act(async () => {
      root.render(
        <WalletForgotPasswordScreen compact onRecover={vi.fn()} onForget={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />
      )
    })

    const title = Array.from(container.querySelectorAll('h2')).find((heading) =>
      heading.textContent?.includes('Forgot your wallet password?')
    )
    const content = title?.parentElement?.parentElement
    expect(title?.className).toContain('text-sm')
    expect(content?.className).toContain('max-w-xs')
    expect(content?.className).not.toContain('rounded-card')

    const actions = Array.from(container.querySelectorAll('button')).filter(
      (button) =>
        button.textContent?.includes('Recover with 24 words') || button.textContent?.includes('Remove from this device')
    )
    expect(actions).toHaveLength(2)
    expect(actions.every((button) => button.className.includes('h-11'))).toBe(true)
  })

  it('requires REMOVE before forgetting the local wallet', async () => {
    const onForget = vi.fn(() => Promise.resolve())
    await act(async () => {
      root.render(<WalletForgotPasswordScreen onRecover={vi.fn()} onForget={onForget} onBack={vi.fn()} />)
    })

    const startRemoval = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Remove from this device'
    )
    await act(async () => startRemoval?.click())

    const confirm = container.querySelector<HTMLInputElement>('#wallet-remove-confirmation')
    const remove = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Remove wallet')
    )
    expect(confirm).not.toBeNull()
    expect(remove?.disabled).toBe(true)

    await act(async () => {
      if (!confirm) throw new Error('Expected removal confirmation input')
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!nativeSetter) throw new Error('Missing native input value setter')
      nativeSetter.call(confirm, 'REMOVE')
      confirm.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(remove?.disabled).toBe(false)

    await act(async () => remove?.click())
    expect(onForget).toHaveBeenCalledOnce()
  })
})
