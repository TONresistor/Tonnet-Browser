// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletBackupChallenge } from '../WalletBackupChallenge'
import { WalletBackupPhraseScreen } from '../WalletBackupPhraseScreen'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}))

describe('wallet backup flow separation', () => {
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

  it('requires explicit backup acknowledgement without showing word confirmation inputs', async () => {
    const onContinue = vi.fn()
    await act(async () => {
      root.render(
        <WalletBackupPhraseScreen
          words={['secret-one', 'secret-two']}
          revealed
          copied={false}
          pending={false}
          onReveal={vi.fn()}
          onCopy={vi.fn()}
          onContinue={onContinue}
        />
      )
    })

    expect(container.textContent).toContain('secret-one')
    expect(container.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(0)
    const acknowledgement = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const continueButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('I saved it')
    )
    expect(acknowledgement).not.toBeNull()
    expect(continueButton?.disabled).toBe(true)

    await act(async () => acknowledgement?.click())
    expect(continueButton?.disabled).toBe(false)
    await act(async () => continueButton?.click())
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('shows confirmation inputs without recovery words or password fields', async () => {
    const onBack = vi.fn()
    await act(async () => {
      root.render(
        <WalletBackupChallenge
          indexes={[0, 4, 9]}
          answers={{}}
          error={null}
          pending={false}
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onBack={onBack}
        />
      )
    })

    expect(container.textContent).not.toContain('secret-one')
    expect(container.querySelectorAll('input')).toHaveLength(3)
    expect(container.querySelector('input[type="password"]')).toBeNull()
    const backButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'send.back'
    )
    await act(async () => backButton?.click())
    expect(onBack).toHaveBeenCalledOnce()
  })
})
