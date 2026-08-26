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
})
