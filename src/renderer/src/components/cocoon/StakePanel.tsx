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
import { Loader2, ShieldCheck, AlertTriangle, ArrowDownCircle, Check, Power, Wallet, Hourglass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getIpcError, isIpcError } from '@/lib/ipc-utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { formatTonFixed } from '@/lib/ton-utils'
import { useTransientMessage } from '@/hooks/useTransientMessage'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import { deriveStakeView, type StakeView, type WithdrawStage } from './stake-actions'

const log = createLogger('cocoon:stake-panel')

const PANEL_CLASS = 'overflow-hidden rounded-lg border border-border bg-[hsl(var(--elevation-1))]'
const PANEL_MUTED_TEXT = 'text-foreground-muted'
const ACTION_BUTTON_CLASS =
  'w-full rounded-md border-0 bg-[hsl(var(--elevation-3))] text-foreground shadow-none hover:bg-accent/40 hover:text-foreground'

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
    const exists = await window.electron.cocoon.walletExists()
    if (!exists) {
      setWalletMissing(true)
      setWallets(null)
      setView(null)
      setLoading(false)
      return
    }
    setWalletMissing(false)
    const [stakeRes, walletInfoRes, nativeRes, ownerRes, cocoonRes, pendingRes] = await Promise.allSettled([
      window.electron.cocoon.stakeInfo(),
      window.electron.cocoon.walletInfo(),
      window.electron.wallet.getBalance(),
      window.electron.cocoon.getOwnerBalance(),
      window.electron.cocoon.getCocoonWalletBalance(),
      window.electron.cocoon.flowPending(),
    ])

    const stakeInfo =
      stakeRes.status === 'fulfilled' && !isIpcError(stakeRes.value)
        ? (stakeRes.value as Parameters<typeof deriveStakeView>[0]['stakeInfo'])
        : null
    const walletInfo =
      walletInfoRes.status === 'fulfilled' && walletInfoRes.value && !isIpcError(walletInfoRes.value)
        ? (walletInfoRes.value as { ownerAddress: string; nodeAddress: string })
        : null
    const nativeBalance =
      nativeRes.status === 'fulfilled' && !isIpcError(nativeRes.value) ? BigInt(nativeRes.value as string) : 0n
    const ownerBalance =
      ownerRes.status === 'fulfilled' && !isIpcError(ownerRes.value) ? BigInt(ownerRes.value as string) : 0n
    const cocoonBalance =
      cocoonRes.status === 'fulfilled' && !isIpcError(cocoonRes.value) ? BigInt(cocoonRes.value as string) : 0n
    const pending =
      pendingRes.status === 'fulfilled' && !isIpcError(pendingRes.value)
        ? (pendingRes.value as { startedAt: number } | null)
        : null

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
        log.warn('refresh failed', e)
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
    const off = window.electron.on(IPC_CHANNELS.COCOON_WITHDRAW_EVENT, () => {
      setTickNonce((n) => n + 1)
    })
    return off
  }, [])

  const handleStake = async () => {
    setActionPending('stake')
    setError(null)
    try {
      const result = await window.electron.cocoon.flowStake()
      if (!result.success) {
        setError(result.error ?? t('cocoon.stake.flow.stakeFailed'))
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
      const result = await window.electron.cocoon.flowUnstake()
      if (!result.success) {
        setError(result.error ?? t('cocoon.stake.flow.unstakeFailed'))
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
      const result = await window.electron.cocoon.cashout()
      const err = getIpcError(result)
      if (err) {
        setError(err)
        return
      }
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
      <div className={`${PANEL_CLASS} px-4 py-6 flex items-center justify-center`}>
        <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />
        <span className="ml-2 text-sm text-foreground-muted">{t('cocoon.stake.loading')}</span>
      </div>
    )
  }

  const walletsCard = wallets && <WalletsCard wallets={wallets} />

  return (
    <div className="space-y-4">
      {walletsCard}
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
    <div className={PANEL_CLASS}>
      <div className="border-b border-border px-4 py-3 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {isActiveWithdraw ? 'Deactivate Cocoon' : t(actionTitleKey(view.kind))}
          </h2>
        </div>
        {isActiveWithdraw ? (
          <p className={`text-xs ${PANEL_MUTED_TEXT}`}>Withdraw all Cocoon funds to your main wallet.</p>
        ) : (
          <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{t(actionDescKey(view.kind))}</p>
        )}
      </div>
      <div className="px-4 py-4 space-y-4">
        <ViewBody
          view={view}
          actionPending={actionPending}
          onStake={onStake}
          onUnstake={onUnstake}
          onCashout={onCashout}
          t={t}
        />
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-green-500/10">
            <Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
            <p className="text-xs text-green-400">{success}</p>
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

function ViewBody({ view, actionPending, onStake, onUnstake, onCashout, t }: ViewBodyProps) {
  const busy = actionPending !== null
  switch (view.kind) {
    case 'withdrawing':
      return <WithdrawingView view={view} t={t} />

    case 'active':
      return (
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-md border-0 bg-accent/55 text-foreground shadow-none hover:bg-accent/75 hover:text-foreground"
            disabled={busy}
            onClick={onUnstake}
          >
            {actionPending === 'unstake' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {t('cocoon.stake.flow.unstakeBusy')}
              </>
            ) : (
              <>
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5" />
                {t('cocoon.stake.flow.unstake')}
              </>
            )}
          </Button>
          <p className="text-center text-[11px] text-foreground-muted">
            Stops Cocoon and returns the active stake plus remaining wallet funds.
          </p>
        </div>
      )

    case 'readyToStart':
      return (
        <div className="space-y-3">
          <StatusRow icon={Power} label={t('cocoon.stake.statusReady')} tone="primary" />
          <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{t('cocoon.stake.readyDesc')}</p>
          <Button size="sm" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={onStake}>
            {actionPending === 'stake' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {t('cocoon.stake.flow.stakeBusy')}
              </>
            ) : (
              <>
                <Power className="h-3.5 w-3.5 mr-1.5" />
                {t('cocoon.stake.flow.stake')}
              </>
            )}
          </Button>
          {view.canCashout && (
            <Button variant="outline" size="sm" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={onCashout}>
              {actionPending === 'cashout' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t('cocoon.stake.flow.cashout')}
            </Button>
          )}
        </div>
      )

    case 'readyToFundAndStake':
      return (
        <div className="space-y-3">
          <StatusRow icon={Power} label={t('cocoon.stake.statusReadyFund')} tone="primary" />
          <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{t('cocoon.stake.readyFundDesc')}</p>
          <Button size="sm" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={onStake}>
            {actionPending === 'stake' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {t('cocoon.stake.flow.stakeBusy')}
              </>
            ) : (
              <>
                <Power className="h-3.5 w-3.5 mr-1.5" />
                {t('cocoon.stake.flow.stake')}
              </>
            )}
          </Button>
          {view.canCashout && (
            <Button variant="outline" size="sm" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={onCashout}>
              {actionPending === 'cashout' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t('cocoon.stake.flow.cashout')}
            </Button>
          )}
        </div>
      )

    case 'fundOwnerFirst':
      return (
        <div className="space-y-3">
          <StatusRow icon={Wallet} label={t('cocoon.stake.statusFundOwner')} tone="muted" />
          <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{t('cocoon.stake.fundOwnerDesc')}</p>
          {view.canCashout && (
            <Button variant="outline" size="sm" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={onCashout}>
              {actionPending === 'cashout' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t('cocoon.stake.flow.cashout')}
            </Button>
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
        <span className="text-xs font-medium text-foreground-muted">{t('cocoon.stake.currentStep')}</span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-amber-400 bg-amber-500/10">
          <Hourglass className="h-3.5 w-3.5" />
          {t(stageLabel)}
        </span>
      </div>
      <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{t(stageBlurb)}</p>
      <div className="rounded-md bg-[hsl(var(--elevation-2))] px-3 py-2">
        <p className="text-xs text-foreground-muted">{t('cocoon.stake.withdrawAutoDesc')}</p>
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
      ? 'text-green-400 bg-green-500/10'
      : tone === 'primary'
        ? 'text-primary bg-primary/10'
        : 'text-foreground-muted bg-[hsl(var(--elevation-2))]'
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  )
}

function WalletsCard({ wallets }: { wallets: WalletSnapshot }) {
  const cocoonTotal = getCocoonTotal(wallets)

  return (
    <div className="overflow-hidden rounded-lg border border-transparent bg-transparent">
      <div className="px-2 py-3">
        <div className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Total balance</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-foreground tabular-nums">
            {formatTonFixed(cocoonTotal, 4)}
            <span className="ml-1.5 text-2xl font-semibold text-muted-foreground">GRAM</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function getCocoonTotal(wallets: WalletSnapshot): bigint {
  return BigInt(wallets.ownerBalance) + BigInt(wallets.cocoonBalance) + BigInt(wallets.stakeBalance)
}
