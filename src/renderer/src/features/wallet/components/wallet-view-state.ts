import { useCallback, useEffect, useState } from 'react'
import type { WalletTransaction } from '@shared/types'

export type WalletContentView =
  | { kind: 'overview' }
  | { kind: 'send' }
  | { kind: 'receive' }
  | { kind: 'transaction'; transactionId: string }

export function useWalletContentView(transactions: WalletTransaction[], available: boolean) {
  const [view, setView] = useState<WalletContentView>({ kind: 'overview' })
  const transactionId = view.kind === 'transaction' ? view.transactionId : null
  const selectedTransaction = transactionId
    ? (transactions.find((transaction) => transaction.id === transactionId) ?? null)
    : null

  const showOverview = useCallback(() => setView({ kind: 'overview' }), [])
  const showSend = useCallback(() => setView({ kind: 'send' }), [])
  const showReceive = useCallback(() => setView({ kind: 'receive' }), [])
  const showTransaction = useCallback(
    (transaction: WalletTransaction) => setView({ kind: 'transaction', transactionId: transaction.id }),
    []
  )

  useEffect(() => {
    const transactionMissing = Boolean(transactionId && !selectedTransaction)
    if ((!available || transactionMissing) && view.kind !== 'overview') showOverview()
  }, [available, selectedTransaction, showOverview, transactionId, view.kind])

  return { view, selectedTransaction, showOverview, showSend, showReceive, showTransaction }
}
