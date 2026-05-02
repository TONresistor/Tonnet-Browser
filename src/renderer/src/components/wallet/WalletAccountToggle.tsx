/**
 * Pill switcher between the user's Main wallet and Cocoon.
 *
 * Used at the top of ton://wallet and the wallet sidebar — both stay in sync
 * because both bind to `useUIStore.walletAccountTab`.
 */

import { cn } from '@/lib/utils'
import { useUIStore, type WalletAccountTab } from '@/stores/ui'
import { useTranslation } from 'react-i18next'

interface WalletAccountToggleProps {
  /** Compact (sidebar) variant — slightly tighter padding and smaller text. */
  compact?: boolean
}

export function WalletAccountToggle({ compact = false }: WalletAccountToggleProps) {
  const { t } = useTranslation('wallet')
  const tab = useUIStore((s) => s.walletAccountTab)
  const setTab = useUIStore((s) => s.setWalletAccountTab)

  return (
    <div
      role="tablist"
      aria-label={t('account.toggleLabel')}
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-hover/50 backdrop-blur-[10px]',
        compact ? 'p-0.5 gap-0.5' : 'p-1 gap-1'
      )}
    >
      <ToggleButton
        active={tab === 'main'}
        compact={compact}
        onClick={() => setTab('main')}
        label={t('account.main')}
        targetTab="main"
      />
      <ToggleButton
        active={tab === 'cocoon'}
        compact={compact}
        onClick={() => setTab('cocoon')}
        label={t('account.cocoon')}
        targetTab="cocoon"
      />
    </div>
  )
}

interface ToggleButtonProps {
  active: boolean
  compact: boolean
  onClick: () => void
  label: string
  targetTab: WalletAccountTab
}

function ToggleButton({ active, compact, onClick, label, targetTab }: ToggleButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`wallet-account-panel-${targetTab}`}
      onClick={onClick}
      className={cn(
        'rounded-full font-medium transition-colors duration-150',
        compact ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
