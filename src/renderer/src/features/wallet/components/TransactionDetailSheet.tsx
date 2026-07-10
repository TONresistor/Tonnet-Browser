import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowUp, ArrowDown, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTonAmount } from '@/lib/ton-utils'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { AddressChip } from '@/components/ui/ios/AddressChip'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { useOpenOrSwitchBrowserTab } from '@/features/browser/navigation'
import { useTranslation } from 'react-i18next'
import type { WalletTransaction } from '@shared/types'
import type { ReactNode } from 'react'

interface TransactionDetailSheetProps {
  tx: WalletTransaction | null
  selfAddress: string
  onClose: () => void
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[14px] text-foreground">{children}</span>
    </div>
  )
}

export function TransactionDetailSheet({ tx, selfAddress, onClose }: TransactionDetailSheetProps) {
  const { t, i18n } = useTranslation('wallet')
  const openOrSwitchToTab = useOpenOrSwitchBrowserTab()

  useEffect(() => {
    if (!tx) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tx, onClose])

  if (!tx) return null

  const isReceive = tx.type === 'receive'
  const isX402 = tx.type === 'x402'
  const Icon = isX402 ? Globe : isReceive ? ArrowDown : ArrowUp
  const amountColor = isReceive ? 'text-success' : 'text-foreground'
  const amountPrefix = isReceive ? '+' : '-'
  const from = isReceive ? tx.address : selfAddress
  const to = isReceive ? selfAddress : tx.address

  const openExplorer = () => {
    if (tx.hash) {
      openOrSwitchToTab(`https://tonviewer.com/transaction/${tx.hash}`)
      onClose()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t(`history.types.${tx.type}`)}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('page.close', { defaultValue: 'Close' })}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center gap-2 px-5 pb-5 pt-7">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full',
              isReceive ? 'bg-success' : 'bg-primary'
            )}
          >
            <Icon className="h-6 w-6 text-white" strokeWidth={2.5} aria-hidden="true" />
          </div>
          <p className="text-[13px] font-medium text-muted-foreground">{t(`history.types.${tx.type}`)}</p>
          <p className={cn('text-[32px] font-bold leading-none tabular-nums', amountColor)}>
            {amountPrefix}
            {formatTonAmount(tx.amount)}
            <span className="ml-1.5 text-xl font-semibold text-muted-foreground">GRAM</span>
          </p>
        </div>

        <div className="max-h-[55vh] space-y-4 overflow-auto px-4 pb-5">
          <InsetGroup>
            <DetailRow label={t('detail.from', { defaultValue: 'From' })}>
              <AddressChip address={from} startChars={8} endChars={6} className="bg-transparent px-0" />
            </DetailRow>
            <DetailRow label={t('detail.to', { defaultValue: 'To' })}>
              <AddressChip address={to} startChars={8} endChars={6} className="bg-transparent px-0" />
            </DetailRow>
            {isX402 && tx.x402Domain && (
              <DetailRow label={t('detail.site', { defaultValue: 'Site' })}>{tx.x402Domain}</DetailRow>
            )}
            {tx.comment && <DetailRow label={t('detail.comment', { defaultValue: 'Comment' })}>{tx.comment}</DetailRow>}
          </InsetGroup>

          <InsetGroup>
            {tx.fee && (
              <DetailRow label={t('detail.fee', { defaultValue: 'Network fee' })}>
                {formatTonAmount(tx.fee)} GRAM
              </DetailRow>
            )}
            <DetailRow label={t('detail.date', { defaultValue: 'Date' })}>
              {new Date(tx.timestamp).toLocaleString(i18n.language)}
            </DetailRow>
            <DetailRow label={t('detail.status', { defaultValue: 'Status' })}>
              {t(`history.status.${tx.status}`)}
            </DetailRow>
            {tx.hash && (
              <DetailRow label={t('detail.hash', { defaultValue: 'Hash' })}>
                <AddressChip
                  address={tx.hash}
                  startChars={8}
                  endChars={8}
                  label={t('detail.copyHash', { defaultValue: 'Copy hash' })}
                  className="bg-transparent px-0"
                />
              </DetailRow>
            )}
          </InsetGroup>

          {tx.hash && (
            <ActionButton variant="gray" onClick={openExplorer} className="w-full">
              {t('detail.viewOnExplorer', { defaultValue: 'View on Tonviewer' })}
            </ActionButton>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
