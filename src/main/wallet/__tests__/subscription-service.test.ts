import { describe, expect, it, vi } from 'vitest'
import { WalletSubscriptionService } from '../subscription-service'

function setup() {
  let accountCallback: ((state: never) => void) | undefined
  let transactionCallback: ((transaction: never) => void) | undefined
  const disposeAccount = vi.fn()
  const disposeTransactions = vi.fn()
  const bridge = {
    subscribeAccountState: vi.fn((_address, callback) => {
      accountCallback = callback
      return disposeAccount
    }),
    subscribeTransactions: vi.fn((_address, callback) => {
      transactionCallback = callback
      return disposeTransactions
    }),
  }
  const callbacks = {
    currentBalance: vi.fn(() => '10'),
    balanceChanged: vi.fn(),
    convertTransaction: vi.fn((transaction) => ({ ...transaction, id: 'formatted' })),
    transactionReceived: vi.fn(),
    refreshBalance: vi.fn(async () => {}),
    refreshFailed: vi.fn(),
  }
  return { accountCallback, bridge, callbacks, disposeAccount, disposeTransactions, transactionCallback }
}

describe('WalletSubscriptionService', () => {
  it('emits only changed balances and refreshes after a converted transaction', async () => {
    const service = new WalletSubscriptionService()
    const setupResult = setup()
    service.start(setupResult.bridge, 'address', setupResult.callbacks)
    const accountCallback = setupResult.bridge.subscribeAccountState.mock.calls[0][1]
    const transactionCallback = setupResult.bridge.subscribeTransactions.mock.calls[0][1]
    accountCallback({ balance: '10', last_transaction_lt: '', last_transaction_hash: '', seqno: 0 })
    accountCallback({ balance: '11', last_transaction_lt: '', last_transaction_hash: '', seqno: 0 })
    transactionCallback({ hash: 'hash', lt: '1', now: 1 })
    expect(setupResult.callbacks.balanceChanged).toHaveBeenCalledOnce()
    expect(setupResult.callbacks.balanceChanged).toHaveBeenCalledWith('11')
    expect(setupResult.callbacks.transactionReceived).toHaveBeenCalledWith(expect.objectContaining({ id: 'formatted' }))
    await vi.waitFor(() => expect(setupResult.callbacks.refreshBalance).toHaveBeenCalledOnce())
  })

  it('disposes the previous pair before reinitialization and on stop', () => {
    const service = new WalletSubscriptionService()
    const first = setup()
    const second = setup()
    service.start(first.bridge, 'first', first.callbacks)
    service.start(second.bridge, 'second', second.callbacks)
    expect(first.disposeAccount).toHaveBeenCalledOnce()
    expect(first.disposeTransactions).toHaveBeenCalledOnce()
    service.stop()
    expect(second.disposeAccount).toHaveBeenCalledOnce()
    expect(second.disposeTransactions).toHaveBeenCalledOnce()
  })
})
