// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TransactionDetailView } from '../components/TransactionDetailView'
import { useWalletStore } from '../store'
import type { WalletTransaction } from '@shared/types'

const mocks = vi.hoisted(() => ({ decryptComment: vi.fn() }))
vi.mock('../client', () => ({ walletClient: mocks }))
vi.mock('../store', async () => {
  const { create } = await import('zustand')
  return { useWalletStore: create(() => ({ isLocked: false, sessionRevision: 1 })) }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}))

let container: HTMLDivElement
let root: Root
const transaction: WalletTransaction = {
  id: 'encrypted',
  type: 'receive',
  amount: '1',
  address: 'sender',
  timestamp: 1,
  status: 'confirmed',
  commentEncrypted: true,
  encryptedComment: { sender: 'sender', body: 'encrypted-body' },
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useWalletStore.setState({ isLocked: false, sessionRevision: 1 })
  mocks.decryptComment.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(value = transaction) {
  await act(async () => root.render(<TransactionDetailView transaction={value} selfAddress="self" onBack={() => {}} />))
}
async function decrypt() {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'detail.decryptComment')!
      .click()
  )
}

it('clears a decrypted comment when the wallet locks', async () => {
  mocks.decryptComment.mockResolvedValue('private text')
  await render()
  await decrypt()
  expect(container.textContent).toContain('private text')
  expect(JSON.stringify(useWalletStore.getState())).not.toContain('private text')
  await act(async () => useWalletStore.setState({ isLocked: true, sessionRevision: 2 }))
  expect(container.textContent).not.toContain('private text')
  expect(
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'detail.unlockToDecrypt')!
      .disabled
  ).toBe(true)
})

it('discards a decryption response that arrives after lock', async () => {
  let finish!: (value: string) => void
  mocks.decryptComment.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await render()
  await decrypt()
  await act(async () => useWalletStore.setState({ isLocked: true, sessionRevision: 2 }))
  await act(async () => finish('late private text'))
  expect(container.textContent).not.toContain('late private text')
})

it('discards a decryption response for a transaction that is no longer displayed', async () => {
  let finish!: (value: string) => void
  mocks.decryptComment.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await render()
  await decrypt()
  await render({ ...transaction, id: 'another' })
  await act(async () => finish('previous private text'))
  expect(container.textContent).not.toContain('previous private text')
})
