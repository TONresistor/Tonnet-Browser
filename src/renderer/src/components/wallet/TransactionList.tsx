/**
 * Transaction history list.
 */

import { memo } from 'react'
import { ArrowUpRight, ArrowDownLeft, Globe, Clock, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { truncateAddress } from '@/lib/format'
import { formatTonAmount } from '@/stores/wallet'
import { useTranslation } from 'react-i18next'
import type { WalletTransaction } from '@shared/types'

interface TransactionListProps {
  transactions: WalletTransaction[]
}

function formatDate(ts: number, locale?: string): string {
  return new Date(ts).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const TransactionList = memo(function TransactionList({ transactions }: TransactionListProps) {
  const { t, i18n } = useTranslation('wallet')

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
        <Clock className="h-5 w-5 opacity-40" />
        <p className="text-sm">{t('history.empty')}</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {transactions.map((tx) => {
        const isSend = tx.type === 'send'
        const isReceive = tx.type === 'receive'
        const isX402 = tx.type === 'x402'

        const TypeIcon = isX402 ? Globe : isSend ? ArrowUpRight : ArrowDownLeft

        const StatusIcon = tx.status === 'failed' ? XCircle : tx.status === 'pending' ? Clock : null

        const statusColor = tx.status === 'failed' ? 'text-destructive' : 'text-warning'

        const amountColor = isSend || isX402 ? 'text-destructive' : 'text-success'
        const amountPrefix = isSend || isX402 ? '-' : '+'

        return (
          <div key={tx.id} className="flex items-center gap-3 py-2 px-1">
            <div
              className={cn(
                'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
                isReceive ? 'bg-success/10' : 'bg-destructive/10'
              )}
            >
              <TypeIcon className={cn('h-4 w-4', isReceive ? 'text-success' : 'text-destructive')} aria-hidden="true" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground">
                  {isX402
                    ? (tx.x402Domain?.slice(0, 50) ?? t('history.x402Payment'))
                    : truncateAddress(tx.address, 6, 6)}
                </span>
                {StatusIcon && <StatusIcon className={cn('h-3 w-3 flex-shrink-0', statusColor)} aria-hidden="true" />}
              </div>
              <div className="text-xs text-muted-foreground">{formatDate(tx.timestamp, i18n.language)}</div>
            </div>

            <div className={cn('text-sm font-medium flex-shrink-0', amountColor)}>
              {amountPrefix}
              {formatTonAmount(tx.amount)} GRAM
            </div>
          </div>
        )
      })}
    </div>
  )
})
