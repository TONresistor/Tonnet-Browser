/**
 * StakePanel — single source of truth for the user's stake-management surface.
 *
 * Architecture:
 *  - Pure selector `deriveStakeView` (stake-actions.ts) maps the IPC snapshot
 *    to one of five mutually-exclusive screens.
 *  - This component renders one screen per kind. No nested conditionals.
 *  - All multi-step protocols (fund + start, unstake + cooldown + claim +
 *    cashout) are hidden behind composite IPCs handled by the main process.
 *    The user clicks one button and sees one progress indicator.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cocoonClient } from '@/features/cocoon/client'
import { walletClient } from '@/features/wallet/client'
import { Loader2, ShieldCheck, AlertTriangle, ArrowDownCircle, Check, Power, Wallet, Hourglass } from 'lucide-react'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { BalanceHero } from '@/components/ui/ios/BalanceHero'
import { formatTonFixed } from '@/lib/ton-utils'
import { useTransientMessage } from '@/hooks/useTransientMessage'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import { deriveStakeView, type StakeView, type WithdrawStage } from './stake-actions'

const log = createLogger('cocoon:stake-panel')

const CARD_CLASS = 'overflow-hidden rounded-card border border-border-subtle bg-elevation-2'

/** Slow poll cadence when nothing is changing. */
const POLL_IDLE_MS = 30_000
/** Faster poll cadence right after an action or while withdrawing. */
const POLL_ACTIVE_MS = 5_000

interface WalletSnapshot {
  nativeBalance: string
  ownerBalance: string
  cocoonBalance: string
  stakeBalance: string
}

export const StakePanel = memo(function StakePanel() {
  const { t } = useTranslation('settings')
  const [view, setView] = useState<StakeView | null>(null)
  const [wallets, setWallets] = useState<WalletSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [walletMissing, setWalletMissing] = useState(false)
  const [actionPending, setActionPending] = useState<'stake' | 'unstake' | 'cashout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, showSuccess] = useTransientMessage()
  const [tickNonce, setTickNonce] = useState(0)

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(async () => {
    const exists = await cocoonClient.walletExists()
    if (!exists) {
      setWalletMissing(true)
      setWallets(null)
      setView(null)
      setLoading(false)
      return
    }
    setWalletMissing(false)
    const [stakeRes, walletInfoRes, nativeRes, ownerRes, cocoonRes, pendingRes] = await Promise.allSettled([
      cocoonClient.stakeInfo(),
      cocoonClient.walletInfo(),
      walletClient.getBalance(),
      cocoonClient.getOwnerBalance(),
      cocoonClient.getCocoonWalletBalance(),
      cocoonClient.flowPending(),
    ])

    const stakeInfo =
      stakeRes.status === 'fulfilled' ? (stakeRes.value as Parameters<typeof deriveStakeView>[0]['stakeInfo']) : null
    const walletInfo =
      walletInfoRes.status === 'fulfilled' && walletInfoRes.value
        ? (walletInfoRes.value as { ownerAddress: string; nodeAddress: string })
        : null
    const nativeBalance = nativeRes.status === 'fulfilled' ? BigInt(nativeRes.value as string) : 0n
    const ownerBalance = ownerRes.status === 'fulfilled' ? BigInt(ownerRes.value as string) : 0n
    const cocoonBalance = cocoonRes.status === 'fulfilled' ? BigInt(cocoonRes.value as string) : 0n
    const pending = pendingRes.status === 'fulfilled' ? (pendingRes.value as { startedAt: number } | null) : null

    if (walletInfo) {
      const stakeBalance = stakeInfo && stakeInfo.status !== 'closed' ? BigInt(stakeInfo.stake) : 0n
      setWallets({
        nativeBalance: nativeBalance.toString(),
        ownerBalance: ownerBalance.toString(),
        cocoonBalance: cocoonBalance.toString(),
        stakeBalance: stakeBalance.toString(),
      })
    }
    setView(
      deriveStakeView({
        nativeBalance,
        ownerBalance,
        cocoonBalance,
        stakeInfo,
        pendingWithdraw: pending,
        nowSec: Math.floor(Date.now() / 1000),
      })
    )
    setLoading(false)
  }, [])

  // Polling loop — fast while pending or after action, idle otherwise.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try {
        await refresh()
      } catch (e) {
        log.debug('refresh failed', e)
      }
      if (cancelled) return
      const isFast = view?.kind === 'withdrawing' || actionPending !== null
      pollTimerRef.current = setTimeout(tick, isFast ? POLL_ACTIVE_MS : POLL_IDLE_MS)
    }
    tick()
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, tickNonce])

  // Refresh on driver progress events.
  useEffect(() => {
    const off = cocoonClient.onWithdraw(() => {
      setTickNonce((n) => n + 1)
    })
    return off
  }, [])

  const handleStake = async () => {
    setActionPending('stake')
    setError(null)
    try {
      const result = await cocoonClient.flowStake()
      if (!result.success) {
        setError(t('cocoon.stake.flow.stakeFailed'))
        return
      }
      showSuccess(t('cocoon.stake.flow.stakeSuccess'))
      setTickNonce((n) => n + 1)
    } catch (e) {
      setError((e as Error).message ?? 'flowStake failed')
    } finally {
      setActionPending(null)
    }
  }

  const handleUnstake = async () => {
    setActionPending('unstake')
    setError(null)
    try {
      const result = await cocoonClient.flowUnstake()
      if (!result.success) {
        setError(t('cocoon.stake.flow.unstakeFailed'))
        return
      }
      showSuccess(t('cocoon.stake.flow.unstakeSent'))
      setTickNonce((n) => n + 1)
    } catch (e) {
      setError((e as Error).message ?? 'flowUnstake failed')
    } finally {
      setActionPending(null)
    }
  }

  const handleCashout = async () => {
    setActionPending('cashout')
    setError(null)
    try {
      const result = await cocoonClient.cashout()
      const r = result as { totalSent: string }
      showSuccess(t('cocoon.stake.flow.cashoutDone', { amount: formatTonFixed(r.totalSent) }))
      setTickNonce((n) => n + 1)
    } catch (e) {
      setError((e as Error).message ?? 'cashout failed')
    } finally {
      setActionPending(null)
    }
  }

  if (walletMissing) {
    return null
  }

  if (loading || !view) {
    return (
      <div className={`${CARD_CLASS} flex items-center justify-center px-4 py-6`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t('cocoon.stake.loading')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {wallets && <WalletsCard wallets={wallets} />}
      <ActionCard
        view={view}
        actionPending={actionPending}
        error={error}
        success={success}
        onStake={handleStake}
        onUnstake={handleUnstake}
        onCashout={handleCashout}
        t={t}
      />
    </div>
  )
})

// ── Sub-components ─────────────────────────────────────────────────────────

interface ActionCardProps {
  view: StakeView
  actionPending: 'stake' | 'unstake' | 'cashout' | null
  error: string | null
  success: string | null
  onStake: () => void
  onUnstake: () => void
  onCashout: () => void
  t: ReturnType<typeof useTranslation>['t']
}

function ActionCard({ view, actionPending, error, success, onStake, onUnstake, onCashout, t }: ActionCardProps) {
  const isActiveWithdraw = view.kind === 'active'
  return (
    <div className={CARD_CLASS}>
      <div className="space-y-1 border-b border-border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">
          {isActiveWithdraw ? 'Deactivate Cocoon' : t(actionTitleKey(view.kind))}
        </h2>
        <p className="text-xs text-muted-foreground">
          {isActiveWithdraw ? 'Withdraw all Cocoon funds to your main wallet.' : t(actionDescKey(view.kind))}
        </p>
      </div>
      <div className="space-y-4 px-4 py-4">
        <ViewBody
          view={view}
          actionPending={actionPending}
          onStake={onStake}
          onUnstake={onUnstake}
          onCashout={onCashout}
          t={t}
        />
        {error && (
          <div className="flex items-start gap-2 rounded-card bg-destructive/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-card bg-success/10 px-3 py-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            <p className="text-xs text-success">{success}</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface ViewBodyProps {
  view: StakeView
  actionPending: 'stake' | 'unstake' | 'cashout' | null
  onStake: () => void
  onUnstake: () => void
  onCashout: () => void
  t: ReturnType<typeof useTranslation>['t']
}

/** Cashout button shared by several views. */
function CashoutButton({
  busy,
  pending,
  onCashout,
  t,
}: {
  busy: boolean
  pending: boolean
  onCashout: () => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <ActionButton
      variant="gray"
      className="w-full"
      disabled={busy}
      onClick={onCashout}
      icon={pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownCircle className="h-4 w-4" />}
    >
      {t('cocoon.stake.flow.cashout')}
    </ActionButton>
  )
}

function ViewBody({ view, actionPending, onStake, onUnstake, onCashout, t }: ViewBodyProps) {
  const busy = actionPending !== null
  switch (view.kind) {
    case 'withdrawing':
      return <WithdrawingView view={view} t={t} />

    case 'active':
      return (
        <div className="space-y-2">
          <ActionButton
            variant="gray"
            className="w-full"
            disabled={busy}
            onClick={onUnstake}
            icon={
              actionPending === 'unstake' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownCircle className="h-4 w-4" />
              )
            }
          >
            {actionPending === 'unstake' ? t('cocoon.stake.flow.unstakeBusy') : t('cocoon.stake.flow.unstake')}
          </ActionButton>
          <p className="text-center text-[11px] text-muted-foreground">
            Stops Cocoon and returns the channel funds plus remaining wallet funds.
          </p>
        </div>
      )

    case 'readyToStart':
      return (
        <div className="space-y-3">
          <StatusRow icon={Power} label={t('cocoon.stake.statusReady')} tone="primary" />
          <p className="text-xs text-muted-foreground">{t('cocoon.stake.readyDesc')}</p>
          <ActionButton
            variant="filled"
            className="w-full"
            disabled={busy}
            onClick={onStake}
            icon={
              actionPending === 'stake' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />
            }
          >
            {actionPending === 'stake' ? t('cocoon.stake.flow.stakeBusy') : t('cocoon.stake.flow.stake')}
          </ActionButton>
          {view.canCashout && (
            <CashoutButton busy={busy} pending={actionPending === 'cashout'} onCashout={onCashout} t={t} />
          )}
        </div>
      )

    case 'readyToFundAndStake':
      return (
        <div className="space-y-3">
          <StatusRow icon={Power} label={t('cocoon.stake.statusReadyFund')} tone="primary" />
          <p className="text-xs text-muted-foreground">{t('cocoon.stake.readyFundDesc')}</p>
          <ActionButton
            variant="filled"
            className="w-full"
            disabled={busy}
            onClick={onStake}
            icon={
              actionPending === 'stake' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />
            }
          >
            {actionPending === 'stake' ? t('cocoon.stake.flow.stakeBusy') : t('cocoon.stake.flow.stake')}
          </ActionButton>
          {view.canCashout && (
            <CashoutButton busy={busy} pending={actionPending === 'cashout'} onCashout={onCashout} t={t} />
          )}
        </div>
      )

    case 'fundOwnerFirst':
      return (
        <div className="space-y-3">
          <StatusRow icon={Wallet} label={t('cocoon.stake.statusFundOwner')} tone="muted" />
          <p className="text-xs text-muted-foreground">{t('cocoon.stake.fundOwnerDesc')}</p>
          {view.canCashout && (
            <CashoutButton busy={busy} pending={actionPending === 'cashout'} onCashout={onCashout} t={t} />
          )}
        </div>
      )
  }
}

function WithdrawingView({
  view,
  t,
}: {
  view: Extract<StakeView, { kind: 'withdrawing' }>
  t: ReturnType<typeof useTranslation>['t']
}) {
  const stageLabel = stageLabelKey(view.stage)
  const stageBlurb = stageBlurbKey(view.stage)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('cocoon.stake.currentStep')}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning px-2.5 py-1 text-xs font-medium text-warning-foreground">
          <Hourglass className="h-3.5 w-3.5" />
          {t(stageLabel)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t(stageBlurb)}</p>
      <div className="rounded-card bg-elevation-3 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('cocoon.stake.withdrawAutoDesc')}</p>
      </div>
    </div>
  )
}

function stageLabelKey(stage: WithdrawStage): string {
  switch (stage) {
    case 'requesting':
      return 'cocoon.stake.stage.requesting'
    case 'confirming':
      return 'cocoon.stake.stage.confirming'
    case 'cooldown':
      return 'cocoon.stake.stage.cooldown'
    case 'claiming':
      return 'cocoon.stake.stage.claiming'
    case 'cashingOut':
      return 'cocoon.stake.stage.cashingOut'
    case 'finalizing':
      return 'cocoon.stake.stage.finalizing'
  }
}

function actionTitleKey(kind: StakeView['kind']): string {
  switch (kind) {
    case 'active':
    case 'withdrawing':
      return 'cocoon.stake.actionWithdrawTitle'
    case 'readyToStart':
    case 'readyToFundAndStake':
      return 'cocoon.stake.actionActivateTitle'
    case 'fundOwnerFirst':
      return 'cocoon.stake.actionTopUpTitle'
  }
}

function actionDescKey(kind: StakeView['kind']): string {
  switch (kind) {
    case 'active':
      return 'cocoon.stake.actionWithdrawDesc'
    case 'withdrawing':
      return 'cocoon.stake.actionWithdrawingDesc'
    case 'readyToStart':
      return 'cocoon.stake.actionStartDesc'
    case 'readyToFundAndStake':
      return 'cocoon.stake.actionFundAndStartDesc'
    case 'fundOwnerFirst':
      return 'cocoon.stake.actionTopUpDesc'
  }
}

function stageBlurbKey(stage: WithdrawStage): string {
  switch (stage) {
    case 'requesting':
      return 'cocoon.stake.stage.requestingDesc'
    case 'confirming':
      return 'cocoon.stake.stage.confirmingDesc'
    case 'cooldown':
      return 'cocoon.stake.stage.cooldownDesc'
    case 'claiming':
      return 'cocoon.stake.stage.claimingDesc'
    case 'cashingOut':
      return 'cocoon.stake.stage.cashingOutDesc'
    case 'finalizing':
      return 'cocoon.stake.stage.finalizingDesc'
  }
}

function StatusRow({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof ShieldCheck
  label: string
  tone: 'success' | 'primary' | 'muted'
}) {
  const cls =
    tone === 'success'
      ? 'bg-success text-success-foreground'
      : tone === 'primary'
        ? 'bg-primary text-primary-foreground'
        : 'bg-elevation-3 text-muted-foreground'
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  )
}

function WalletsCard({ wallets }: { wallets: WalletSnapshot }) {
  const cocoonTotal = getCocoonTotal(wallets)
  return (
    <div className="flex flex-col items-center gap-1.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Total balance</p>
      <BalanceHero amount={formatTonFixed(cocoonTotal, 4)} unit="GRAM" size="xl" />
    </div>
  )
}

function getCocoonTotal(wallets: WalletSnapshot): bigint {
  return BigInt(wallets.ownerBalance) + BigInt(wallets.cocoonBalance) + BigInt(wallets.stakeBalance)
}
