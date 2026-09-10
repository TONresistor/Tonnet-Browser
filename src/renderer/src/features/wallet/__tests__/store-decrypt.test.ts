// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletTransaction } from '@shared/types'

const clientMock = vi.hoisted(() => ({
  isAvailable: vi.fn(() => false),
  decryptComment: vi.fn(),
  clearHistory: vi.fn(() => Promise.resolve()),
  lock: vi.fn(() => Promise.resolve({ isLocked: true })),
  onBalanceUpdated: vi.fn(() => () => {}),
  onNewTransaction: vi.fn(() => () => {}),
  onStateChanged: vi.fn(() => () => {}),
}))

vi.mock('@/features/wallet/client', () => ({ walletClient: clientMock }))

const { useWalletStore } = await import('@/features/wallet/store')

const OWN_ADDRESS = `0:${'11'.repeat(32)}`
const COUNTERPARTY = `0:${'22'.repeat(32)}`

function transaction(overrides: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    id: 'tx-1',
    type: 'receive',
    amount: '1',
    address: COUNTERPARTY,
    timestamp: 1,
    status: 'confirmed',
    commentEncrypted: true,
    encryptedBody: 'ciphertext-boc',
    ...overrides,
  }
}

describe('wallet store memo decryption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.decryptComment.mockResolvedValue({ comment: 'lunch money' })
    useWalletStore.setState({
      address: OWN_ADDRESS,
      transactions: [],
      decryptedComments: {},
      decryptingCommentId: null,
      error: null,
      isLocked: false,
    })
  })

  it('salts a received memo with the counterparty address', async () => {
    await useWalletStore.getState().decryptComment(transaction())

    expect(clientMock.decryptComment).toHaveBeenCalledWith('ciphertext-boc', COUNTERPARTY)
    expect(useWalletStore.getState().decryptedComments['tx-1']).toBe('lunch money')
  })

  it('salts a sent memo with our own address, not the recipient', async () => {
    await useWalletStore.getState().decryptComment(transaction({ type: 'send' }))

    expect(clientMock.decryptComment).toHaveBeenCalledWith('ciphertext-boc', OWN_ADDRESS)
  })

  it('skips transactions that carry no ciphertext', async () => {
    await useWalletStore.getState().decryptComment(transaction({ encryptedBody: undefined }))

    expect(clientMock.decryptComment).not.toHaveBeenCalled()
  })

  it('does not decrypt the same memo twice', async () => {
    await useWalletStore.getState().decryptComment(transaction())
    await useWalletStore.getState().decryptComment(transaction())

    expect(clientMock.decryptComment).toHaveBeenCalledOnce()
  })

  it('surfaces a failure as an error and clears the in-flight marker', async () => {
    clientMock.decryptComment.mockRejectedValueOnce(new Error('Unable to decrypt this memo'))

    await useWalletStore.getState().decryptComment(transaction())

    expect(useWalletStore.getState().error).toBe('Unable to decrypt this memo')
    expect(useWalletStore.getState().decryptingCommentId).toBeNull()
    expect(useWalletStore.getState().decryptedComments).toEqual({})
  })

  it('forgets recovered plaintext when the wallet locks', async () => {
    await useWalletStore.getState().decryptComment(transaction())
    expect(useWalletStore.getState().decryptedComments).not.toEqual({})

    await useWalletStore.getState().lock()

    expect(useWalletStore.getState().decryptedComments).toEqual({})
  })

  it('forgets recovered plaintext when history is cleared', async () => {
    await useWalletStore.getState().decryptComment(transaction())

    await useWalletStore.getState().clearHistory()

    expect(useWalletStore.getState().decryptedComments).toEqual({})
  })
})
