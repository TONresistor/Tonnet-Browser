// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/features/settings/ui-store'
import { WalletManagementPanel } from '../WalletManagementPanel'

const walletManagement = {
  isCreated: false,
  passwordProtected: false,
  discoverAccounts: vi.fn(),
  importWallet: vi.fn(),
  exportMnemonic: vi.fn(),
  deleteWallet: vi.fn(),
  changePassword: vi.fn(),
  setupPassword: vi.fn(),
  isLoading: false,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/wallet/public', () => ({
  useWalletManagement: () => walletManagement,
}))

vi.mock('@/features/wallet/client', () => ({
  walletClient: { setSensitiveDisplay: vi.fn(() => Promise.resolve()) },
}))

describe('WalletManagementPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    walletManagement.isCreated = false
    walletManagement.passwordProtected = false
    useUIStore.setState({ settingsActiveSection: 'wallet', walletManagementIntent: 'import' })
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

  it('shows the new password fields immediately when recovery opens import', async () => {
    await act(async () => root.render(<WalletManagementPanel />))

    expect(container.querySelector('input[placeholder="Wallet password"]')).not.toBeNull()
    expect(container.querySelector('input[placeholder="Confirm wallet password"]')).not.toBeNull()
    expect(useUIStore.getState().walletManagementIntent).toBeNull()
  })

  it('keeps recovery and password forms collapsed until their action is selected', async () => {
    walletManagement.isCreated = true
    walletManagement.passwordProtected = true
    useUIStore.setState({ walletManagementIntent: null })
    await act(async () => root.render(<WalletManagementPanel />))

    const recoveryButton = container.querySelector<HTMLButtonElement>('[aria-controls="wallet-recovery-panel"]')
    const passwordButton = container.querySelector<HTMLButtonElement>('[aria-controls="wallet-password-panel"]')
    expect(recoveryButton?.getAttribute('aria-expanded')).toBe('false')
    expect(passwordButton?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('input[placeholder="Wallet password"]')).toBeNull()

    await act(async () => recoveryButton?.click())
    expect(recoveryButton?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('input[placeholder="Wallet password"]')).not.toBeNull()

    await act(async () => passwordButton?.click())
    expect(recoveryButton?.getAttribute('aria-expanded')).toBe('false')
    expect(passwordButton?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('input[placeholder="Current password"]')).not.toBeNull()
    expect(container.querySelector('input[placeholder="New password"]')).not.toBeNull()
  })
})
