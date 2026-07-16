import { memo } from 'react'
import { ArrowUp, ArrowDown, Globe, Clock, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { truncateAddress } from '@/lib/format'
import { formatTonAmount } from '@/lib/ton-utils'
import { useTranslation } from 'react-i18next'
import type { WalletTransaction } from '@shared/types'

interface TransactionListProps {
  transactions: WalletTransaction[]
  onSelect?: (tx: WalletTransaction) => void
  compact?: boolean
}

function formatDate(ts: number, locale?: string): string {
  return new Date(ts).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateCompact(ts: number, locale?: string): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

export const TransactionList = memo(function TransactionList({
  transactions,
  onSelect,
  compact,
}: TransactionListProps) {
  const { t, i18n } = useTranslation('wallet')

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <Clock className="h-5 w-5 opacity-40" />
        <p className="text-[13px]">{t('history.empty')}</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      {transactions.map((tx) => {
        const isReceive = tx.type === 'receive'
        const isSend = tx.type === 'send'
        const isX402 = tx.type === 'x402'

        const TypeIcon = isX402 ? Globe : isSend ? ArrowUp : ArrowDown
        const StatusIcon = tx.status === 'failed' ? XCircle : tx.status === 'pending' ? Clock : null
        const statusColor = tx.status === 'failed' ? 'text-destructive' : 'text-warning'

        const amountColor = isReceive ? 'text-success' : 'text-foreground'
        const amountPrefix = isReceive ? '+' : '-'

        const subtitle = isX402
          ? (tx.x402Domain ?? t('history.x402Payment'))
          : `${isReceive ? t('history.from', { defaultValue: 'from' }) : t('history.to', { defaultValue: 'to' })} ${truncateAddress(tx.address, 6, 4)}`

        return (
          <button
            key={tx.id}
            type="button"
            onClick={() => onSelect?.(tx)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevation-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                isReceive ? 'bg-success' : 'bg-primary'
              )}
            >
              <TypeIcon className="h-[18px] w-[18px] text-identity-foreground" strokeWidth={2.5} aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[15px] font-medium text-foreground">
                  {t(`history.types.${tx.type}`)}
                </span>
                <span className={cn('shrink-0 text-[15px] font-semibold tabular-nums', amountColor)}>
                  {amountPrefix}
                  {formatTonAmount(tx.amount)} GRAM
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                <span className="truncate">{subtitle}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {StatusIcon && (
                    <span className={cn('flex items-center gap-1', statusColor)}>
                      <StatusIcon className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">{t(`history.status.${tx.status}`)}</span>
                    </span>
                  )}
                  {(compact ? formatDateCompact : formatDate)(tx.timestamp, i18n.language)}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
})
