/**
 * Cocoon "account" view rendered inside ton://wallet when the toggle is on
 * Cocoon. Shows a single balance number, a status pill, and a state-aware
 * action row — never exposes the underlying owner / node wallet plumbing.
 *
 * Activation is a single click that delegates to `cocoon.flowStake()` (the
 * backend rotates identity, drains residuals, funds the fresh wallet, and
 * starts the runner atomically).
 */

import { memo } from 'react'
import { Loader2, Hourglass, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatTonAmount } from '@/stores/wallet'
import { useTabsStore } from '@/stores/tabs'
import {
  useCocoonAccountView,
  type CocoonAccountSnapshot,
  type CocoonAccountStatus,
} from '@/hooks/useCocoonAccountView'
import { CocoonActionsBar } from './CocoonActionsBar'
import type { WithdrawStage } from '@/components/cocoon/stake-actions'

const COCOON_PAGE = 'ton://cocoon'

interface CocoonAccountViewProps {
  /** Compact (sidebar) variant. */
  compact?: boolean
}

export const CocoonAccountView = memo(function CocoonAccountView({ compact = false }: CocoonAccountViewProps) {
  const { t } = useTranslation('wallet')
  const { snapshot, refresh, activate } = useCocoonAccountView()
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)

  const openChat = (): void => {
    openOrSwitchToTab(COCOON_PAGE)
  }

  return (
    <div role="tabpanel" id="wallet-account-panel-cocoon" className="space-y-4">
      <BalanceBlock snapshot={snapshot} compact={compact} />

      {snapshot.status === 'loading' ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : snapshot.status === 'unavailable' ? (
        <Notice>{t('account.notice.unavailable')}</Notice>
      ) : snapshot.status === 'withdrawing' ? (
        <WithdrawProgressCard snapshot={snapshot} />
      ) : (
        <CocoonActionsBar
          snapshot={snapshot}
          onActivate={activate}
          onActionComplete={refresh}
          onOpenChat={openChat}
          compact={compact}
        />
      )}
    </div>
  )
})

function BalanceBlock({ snapshot, compact }: { snapshot: CocoonAccountSnapshot; compact: boolean }) {
  const total = formatTonAmount(snapshot.totalNano.toString())
  if (compact) {
    return (
      <div className="text-center">
        <p className="text-3xl font-bold text-foreground tracking-tight">{total}</p>
        <p className="text-xs text-muted-foreground mt-0.5">TON</p>
        <StatusPill status={snapshot.status} className="mt-2" />
      </div>
    )
  }
  return (
    <div className="text-center">
      <p className="text-4xl font-bold text-foreground tracking-tight">
        {total} <span className="text-2xl font-semibold text-muted-foreground">TON</span>
      </p>
      <StatusPill status={snapshot.status} className="mt-2" />
    </div>
  )
}

function StatusPill({ status, className }: { status: CocoonAccountStatus; className?: string }) {
  const { t } = useTranslation('wallet')
  if (status === 'loading') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('account.status.loading')}
      </span>
    )
  }
  if (status === 'unavailable') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
        {t('account.status.unavailable')}
      </span>
    )
  }
  if (status === 'activating') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('account.status.activating')}
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium text-green-400 bg-green-500/10 border-green-500/30 ${className ?? ''}`}
      >
        <ShieldCheck className="h-3 w-3" />
        {t('account.status.active')}
      </span>
    )
  }
  if (status === 'withdrawing') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium text-amber-400 bg-amber-500/10 border-amber-500/30 ${className ?? ''}`}
      >
        <Hourglass className="h-3 w-3" />
        {t('account.status.withdrawing')}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
      {t('account.status.idle')}
    </span>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-center">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  )
}

function WithdrawProgressCard({ snapshot }: { snapshot: CocoonAccountSnapshot }) {
  const { t } = useTranslation('wallet')
  const stage = deriveStage(snapshot)
  const stageLabel = t(`account.withdrawStage.${stage}`)
  const unlockTs = snapshot.stakeInfo?.unlockTs ?? 0
  const nowSec = Math.floor(Date.now() / 1000)
  const secondsRemaining = unlockTs > 0 ? Math.max(0, unlockTs - nowSec) : 0
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 space-y-1.5 text-center">
      <div className="flex items-center justify-center gap-2 text-sm font-medium text-amber-400">
        <Hourglass className="h-3.5 w-3.5" />
        {stageLabel}
      </div>
      {stage === 'cooldown' && secondsRemaining > 0 && (
        <p className="text-xs text-muted-foreground font-mono">{formatCountdown(secondsRemaining)}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('account.withdrawHint')}</p>
    </div>
  )
}

function deriveStage(snapshot: CocoonAccountSnapshot): WithdrawStage {
  const info = snapshot.stakeInfo
  if (!info) return 'finalizing'
  switch (info.status) {
    case 'closing':
      return info.unlockTs === 0 ? 'requesting' : 'cooldown'
    case 'cooldown':
      return 'cooldown'
    case 'refundable':
      return 'claiming'
    case 'closed':
      return 'cashingOut'
    case 'active':
      return 'finalizing'
  }
}

function formatCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
