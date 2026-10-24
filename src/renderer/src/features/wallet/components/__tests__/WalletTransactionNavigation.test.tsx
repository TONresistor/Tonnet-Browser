// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletTransaction } from '@shared/types'

const walletMock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}))

vi.mock('@/features/wallet/store', () => ({
  useWalletStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(walletMock.state), {
    getState: () => walletMock.state,
  }),
}))

vi.mock('@/features/wallet/client', () => ({
  walletClient: {
    resolveRecipient: vi.fn(),
    setSensitiveDisplay: vi.fn(),
  },
}))

vi.mock('@/features/browser/navigation', () => ({
  useNavigateActiveBrowserTab: () => vi.fn(),
  useOpenOrSwitchBrowserTab: () => vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('lottie-react', () => ({ default: () => null }))

vi.mock('electron-log/renderer', () => ({
  default: {
    scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}))

const transaction: WalletTransaction = {
  id: 'tx-navigation',
  type: 'send',
  amount: '2500000000',
  address: `0:${'11'.repeat(32)}`,
  timestamp: 1_750_000_000_000,
  status: 'confirmed',
  hash: 'navigation-hash',
}

function storeState(): Record<string, unknown> {
  return {
    isCreated: true,
    address: `0:${'22'.repeat(32)}`,
    balance: '5000000000',
    transactions: [transaction],
    isLoading: false,
    isSending: false,
    error: null,
    decryptFailed: false,
    weakEncryption: false,
    isLocked: false,
    needsPasswordSetup: false,
    passwordProtected: false,
    backupVerified: true,
    init: vi.fn(),
    create: vi.fn(),
    importWallet: vi.fn(),
    discoverAccounts: vi.fn(),
    send: vi.fn(),
    loadHistory: vi.fn(),
    refreshBalance: vi.fn(),
    unlock: vi.fn(),
    setupPassword: vi.fn(),
    markBackupVerified: vi.fn(),
    createBackupChallenge: vi.fn(),
    exportMnemonic: vi.fn(),
    lock: vi.fn(),
    forgetWallet: vi.fn(),
  }
}

describe('wallet transaction navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    walletMock.state = storeState()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('drills into transaction details inside the sidebar and returns to its overview', async () => {
    const { WalletSidebar } = await import('../WalletSidebar')
    await act(async () => root.render(<WalletSidebar onClose={vi.fn()} />))

    const transactionRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('history.types.send')
    )
    await act(async () => transactionRow?.click())

    expect(container.querySelector('section[aria-label="history.types.send"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Open full wallet')
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="send.back"]')
    await act(async () => back?.click())

    expect(container.textContent).toContain('Open full wallet')
    expect(container.querySelector('section[aria-label="history.types.send"]')).toBeNull()
  })

  it('drills into transaction details inside the full wallet page and returns to its overview', async () => {
    const { WalletPage } = await import('../WalletPage')
    await act(async () => root.render(<WalletPage />))

    const transactionRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('history.types.send')
    )
    await act(async () => transactionRow?.click())

    expect(container.querySelector('section[aria-label="history.types.send"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    const back = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'send.back'
    )
    await act(async () => back?.click())

    expect(container.textContent).toContain('overview.recent')
    expect(container.querySelector('section[aria-label="history.types.send"]')).toBeNull()
  })

  it('returns to the sidebar overview when the selected transaction disappears', async () => {
    const { WalletSidebar } = await import('../WalletSidebar')
    const onClose = vi.fn()
    await act(async () => root.render(<WalletSidebar onClose={onClose} />))

    const transactionRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('history.types.send')
    )
    await act(async () => transactionRow?.click())
    expect(container.querySelector('section[aria-label="history.types.send"]')).not.toBeNull()

    walletMock.state = { ...walletMock.state, transactions: [] }
    await act(async () => root.render(<WalletSidebar onClose={onClose} />))

    expect(container.textContent).toContain('Open full wallet')
    expect(container.querySelector('section[aria-label="history.types.send"]')).toBeNull()
  })
  it('locks through the page action and replaces the overview with the unlock gate', async () => {
    const lock = vi.fn(async () => {
      walletMock.state = { ...walletMock.state, isLocked: true }
    })
    walletMock.state = { ...walletMock.state, passwordProtected: true, lock }
    const { WalletPage } = await import('../WalletPage')
    await act(async () => root.render(<WalletPage />))
    const lockButton = container.querySelector<HTMLButtonElement>('button[aria-label="Lock wallet"]')
    if (!lockButton) throw new Error('Expected wallet lock action')
    await act(async () => lockButton.click())
    expect(lock).toHaveBeenCalledOnce()
    await act(async () => root.render(<WalletPage />))
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Lock wallet"]')).toBeNull()
    expect(container.textContent).not.toContain('overview.recent')
  })

  it('removes displayed recovery words when the full wallet advances to its backup challenge', async () => {
    const words = Array.from({ length: 24 }, (_, index) => `recovery-secret-${index}`)
    const createBackupChallenge = vi.fn(async () => ({ challengeId: 'test-challenge', indexes: [0, 4, 9] }))
    walletMock.state = {
      ...walletMock.state,
      backupVerified: false,
      exportMnemonic: vi.fn(async () => words),
      createBackupChallenge,
    }
    const { WalletPage } = await import('../WalletPage')
    await act(async () => root.render(<WalletPage />))
    const form = container.querySelector('form')
    if (!form) throw new Error('Expected wallet backup gate')
    await act(async () => form.requestSubmit())
    const reveal = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('export.showButton')
    )
    if (!reveal) throw new Error('Expected recovery phrase reveal action')
    await act(async () => reveal.click())
    expect(container.textContent).toContain(words[0])
    const acknowledgement = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const proceed = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('I saved it')
    )
    if (!acknowledgement || !proceed) throw new Error('Expected recovery phrase acknowledgement')
    expect(proceed.disabled).toBe(true)
    expect(createBackupChallenge).not.toHaveBeenCalled()
    await act(async () => acknowledgement.click())
    await act(async () => proceed.click())
    expect(createBackupChallenge).toHaveBeenCalledWith(undefined)
    expect(container.querySelectorAll('input')).toHaveLength(3)
    for (const word of words) expect(container.textContent).not.toContain(word)
  })
})
