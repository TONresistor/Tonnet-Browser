// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SendForm } from '../SendForm'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/wallet/client', () => ({
  walletClient: { resolveRecipient: vi.fn() },
}))

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SendForm encrypted comment', () => {
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

  it('sends the comment as encrypted when its toggle is enabled', async () => {
    const onSend = vi.fn(async () => {})
    await act(async () => {
      root.render(<SendForm onSend={onSend} isSending={false} error={null} balance="5000000000" />)
    })

    const recipient = container.querySelector<HTMLInputElement>('#send-to')
    const amount = container.querySelector<HTMLInputElement>('#send-amount')
    const comment = container.querySelector<HTMLTextAreaElement>('#send-comment')
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')
    if (!recipient || !amount || !comment || !toggle) throw new Error('Expected send form controls')

    await act(async () => {
      setControlValue(recipient, `0:${'11'.repeat(32)}`)
      setControlValue(amount, '1')
      setControlValue(comment, 'private memo')
      toggle.click()
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('send.encryptedNote')

    const review = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'send.reviewButton'
    )
    await act(async () => review?.click())
    expect(container.textContent).toContain('send.privacy')
    expect(container.querySelector('[data-ui-icon="secure-lock"]')).not.toBeNull()

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'send.confirm'
    )
    await act(async () => confirm?.click())

    expect(onSend).toHaveBeenCalledWith(`0:${'11'.repeat(32)}`, '1000000000', 'private memo', true)
  })

  it.each([
    { recipient: 'invalid-address', amount: '1', label: 'invalid recipient' },
    { recipient: `0:${'11'.repeat(32)}`, amount: '0', label: 'zero amount' },
    { recipient: `0:${'11'.repeat(32)}`, amount: '0.0000000001', label: 'excess precision' },
    { recipient: `0:${'11'.repeat(32)}`, amount: '6', label: 'amount above balance' },
  ])('blocks review and sending for $label', async ({ recipient, amount }) => {
    const onSend = vi.fn(async () => {})
    await act(async () => root.render(<SendForm onSend={onSend} isSending={false} error={null} balance="5000000000" />))
    const to = container.querySelector<HTMLInputElement>('#send-to')
    const value = container.querySelector<HTMLInputElement>('#send-amount')
    if (!to || !value) throw new Error('Expected send controls')
    await act(async () => {
      setControlValue(to, recipient)
      setControlValue(value, amount)
    })
    const review = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'send.reviewButton'
    )
    if (!review) throw new Error('Expected review action')
    expect(review.disabled).toBe(true)
    await act(async () => review.click())
    expect(container.textContent).not.toContain('send.confirm')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation and blocks another confirmation while sending', async () => {
    let complete!: () => void
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const render = (isSending: boolean) =>
      root.render(<SendForm onSend={onSend} isSending={isSending} error={null} balance="5000000000" />)
    await act(async () => render(false))
    const recipient = container.querySelector<HTMLInputElement>('#send-to')
    const amount = container.querySelector<HTMLInputElement>('#send-amount')
    if (!recipient || !amount) throw new Error('Expected send controls')
    await act(async () => {
      setControlValue(recipient, `0:${'11'.repeat(32)}`)
      setControlValue(amount, '1')
    })
    const review = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'send.reviewButton'
    )
    if (!review) throw new Error('Expected review action')
    await act(async () => review.click())
    expect(onSend).not.toHaveBeenCalled()
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'send.confirm'
    )
    if (!confirm) throw new Error('Expected confirmation action')
    await act(async () => confirm.click())
    expect(onSend).toHaveBeenCalledOnce()
    await act(async () => render(true))
    expect(confirm.disabled).toBe(true)
    await act(async () => confirm.click())
    expect(onSend).toHaveBeenCalledOnce()
    await act(async () => complete())
  })
})
