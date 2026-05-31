/**
 * RecoveryPanel — surfaces the Cocoon recovery queue.
 *
 * The live stake is handled by StakePanel. This panel shows active recovery
 * entries as the driver advances them through refund, cooldown, claim and drain.
 * Archived wallets are still inspected by the backend recovery action, but are
 * not shown as standalone UI unless a recovery entry is actively queued.
 */

import { memo, useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  AlertTriangle,
  ArrowDownCircle,
  Trash2,
  Hourglass,
  CircleCheckBig,
  Archive as ArchiveIcon,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isIpcError, getIpcError } from '@/lib/ipc-utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { useTransientMessage } from '@/hooks/useTransientMessage'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import type { CocoonRecoveryAllResult, RecoveryEntry, RecoveryPhase } from '../../../../shared/cocoon-types'

const log = createLogger('cocoon:recovery-panel')

const PANEL_CLASS = 'rounded-lg border border-border-strong bg-[hsl(var(--elevation-2))] shadow-sm'
const PANEL_MUTED_TEXT = 'text-foreground-muted'

const POLL_MS = 15_000

function shortAddr(addr: string): string {
  if (!addr) return ''
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0s'
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m ${s}s`
  return `${s}s`
}

export const RecoveryPanel = memo(function RecoveryPanel() {
  const { t } = useTranslation('settings')
  const [queue, setQueue] = useState<RecoveryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [busy, setBusy] = useState<number | 'recover' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, showSuccess, clearSuccess] = useTransientMessage()
  const [recoverResult, setRecoverResult] = useState<CocoonRecoveryAllResult | null>(null)

  const refresh = useCallback(async () => {
    const qRes = await window.electron.cocoon.recoveryList()
    if (!isIpcError(qRes)) {
      setQueue(qRes as RecoveryEntry[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh().catch((e) => log.warn('initial refresh failed', e))
    const id = setInterval(() => {
      refresh().catch((e) => log.warn('refresh failed', e))
    }, POLL_MS)
    const clockId = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    const off = window.electron.on(IPC_CHANNELS.COCOON_RECOVERY_EVENT, () => {
      refresh().catch((e) => log.warn('event refresh failed', e))
    })
    return () => {
      clearInterval(id)
      clearInterval(clockId)
      off()
    }
  }, [refresh])

  const handleRemove = useCallback(
    async (archivedAt: number) => {
      setBusy(archivedAt)
      setError(null)
      try {
        const res = await window.electron.cocoon.recoveryRemove(archivedAt)
        const err = getIpcError(res)
        if (err) {
          setError(err)
          return
        }
        await refresh()
      } catch (e) {
        setError((e as Error).message ?? 'remove failed')
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )

  const handleRecoverAll = useCallback(async () => {
    setBusy('recover')
    setError(null)
    clearSuccess()
    try {
      const res = await window.electron.cocoon.recoveryAll()
      const err = getIpcError(res)
      if (err) {
        setError(err)
        return
      }
      const recovery = res as CocoonRecoveryAllResult
      setRecoverResult(recovery)
      showSuccess(
        t('cocoon.recovery.recoverSuccess', {
          txs: recovery.txs.length,
          locked: recovery.locked.length,
        })
      )
      await refresh()
    } catch (e) {
      setError((e as Error).message ?? 'recover failed')
    } finally {
      setBusy(null)
    }
  }, [refresh, t, showSuccess, clearSuccess])

  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      <p className={`min-w-0 truncate text-xs ${PANEL_MUTED_TEXT}`}>{t('cocoon.recovery.sectionDesc')}</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-md border-0 bg-[hsl(var(--elevation-3))] px-2.5 text-foreground shadow-none hover:bg-accent/40 hover:text-foreground"
          disabled={busy !== null}
          onClick={() => refresh().catch((e) => log.warn('manual refresh failed', e))}
          title={t('cocoon.recovery.refresh')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-md border-0 bg-accent/55 px-3 text-foreground shadow-none hover:bg-accent/75 hover:text-foreground whitespace-nowrap"
          disabled={busy !== null}
          onClick={handleRecoverAll}
        >
          {busy === 'recover' ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <ArrowDownCircle className="h-3.5 w-3.5 mr-1.5" />
          )}
          {t('cocoon.recovery.recoverNow')}
        </Button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center">
        <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />
        <span className="ml-2 text-sm text-foreground-muted">{t('cocoon.recovery.loading')}</span>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="space-y-2">
        {toolbar}
        <p className={`px-1 text-xs ${PANEL_MUTED_TEXT}`}>{t('cocoon.recovery.empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {toolbar}
      {error && (
        <div className="rounded-lg px-3 py-2 flex items-start gap-2 border border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-lg px-3 py-2 flex items-start gap-2 border border-green-500/30 bg-green-500/5">
          <CircleCheckBig className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
          <p className="text-xs text-green-400">{success}</p>
        </div>
      )}
      {recoverResult && <RecoverAllSummary result={recoverResult} t={t} />}

      {queue.map((entry) => (
        <RecoveryRow
          key={entry.archivedAt}
          entry={entry}
          now={now}
          busy={busy === entry.archivedAt}
          onRemove={() => handleRemove(entry.archivedAt)}
          t={t}
        />
      ))}
    </div>
  )
})

interface RecoveryRowProps {
  entry: RecoveryEntry
  now: number
  busy: boolean
  onRemove: () => void
  t: ReturnType<typeof useTranslation>['t']
}

function RecoveryRow({ entry, now, busy, onRemove, t }: RecoveryRowProps) {
  const phaseLabel = phaseLabelKey(entry.phase)
  const tone = entry.phase === 'done' ? 'success' : entry.phase === 'failed' ? 'error' : 'warning'
  const toneCls =
    tone === 'success'
      ? 'text-green-400 bg-green-500/10 border-green-500/30'
      : tone === 'error'
        ? 'text-destructive bg-destructive/5 border-destructive/30'
        : 'text-amber-400 bg-amber-500/10 border-amber-500/30'

  const secondsRemaining = entry.phase === 'cooldown' && entry.unlockTs ? Math.max(0, entry.unlockTs - now) : 0

  return (
    <div className={`${PANEL_CLASS} px-4 py-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ArchiveIcon className="h-3.5 w-3.5 text-foreground-muted shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">{t('cocoon.recovery.entryTitle')}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium shrink-0 ${toneCls}`}
        >
          <Hourglass className="h-3.5 w-3.5" />
          {t(phaseLabel)}
        </span>
      </div>

      <div className="text-[11px] font-mono text-foreground/70 break-all" title={entry.clientSCAddress}>
        {shortAddr(entry.clientSCAddress)}
      </div>

      {entry.phase === 'cooldown' && secondsRemaining > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className={`text-xs ${PANEL_MUTED_TEXT} mb-0.5`}>{t('cocoon.stake.unlocksIn')}</p>
          <p className="text-base font-mono font-semibold text-amber-400">{formatCountdown(secondsRemaining)}</p>
        </div>
      )}

      {entry.lastError && <p className="text-[11px] text-destructive break-words">{entry.lastError}</p>}

      <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{t(phaseBlurbKey(entry.phase))}</p>

      {(entry.phase === 'failed' || entry.phase === 'done') && (
        <Button variant="outline" size="sm" className="w-full" disabled={busy} onClick={onRemove}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
          {t('cocoon.recovery.remove')}
        </Button>
      )}
    </div>
  )
}

function RecoverAllSummary({
  result,
  t,
}: {
  result: CocoonRecoveryAllResult
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <div className={`${PANEL_CLASS} px-4 py-4 space-y-2`}>
      <p className="text-sm font-medium text-foreground">{t('cocoon.recovery.resultTitle')}</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border bg-muted/20 px-2 py-2">
          <p className="text-base font-semibold text-foreground">{result.txs.length}</p>
          <p className="text-[11px] text-foreground-muted">{t('cocoon.recovery.resultTxs')}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 px-2 py-2">
          <p className="text-base font-semibold text-foreground">{result.locked.length}</p>
          <p className="text-[11px] text-foreground-muted">{t('cocoon.recovery.resultLocked')}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 px-2 py-2">
          <p className="text-base font-semibold text-foreground">{result.skipped.length}</p>
          <p className="text-[11px] text-foreground-muted">{t('cocoon.recovery.resultSkipped')}</p>
        </div>
      </div>
      {result.locked.length > 0 && <p className="text-xs text-amber-400">{t('cocoon.recovery.lockedHint')}</p>}
      {result.skipped.length > 0 && <p className={`text-xs ${PANEL_MUTED_TEXT}`}>{result.skipped[0].reason}</p>}
    </div>
  )
}

function phaseLabelKey(phase: RecoveryPhase): string {
  switch (phase) {
    case 'refund-pending':
      return 'cocoon.recovery.phase.refundPending'
    case 'cooldown':
      return 'cocoon.recovery.phase.cooldown'
    case 'claim-pending':
      return 'cocoon.recovery.phase.claimPending'
    case 'drain-pending':
      return 'cocoon.recovery.phase.drainPending'
    case 'done':
      return 'cocoon.recovery.phase.done'
    case 'failed':
      return 'cocoon.recovery.phase.failed'
  }
}

function phaseBlurbKey(phase: RecoveryPhase): string {
  switch (phase) {
    case 'refund-pending':
      return 'cocoon.recovery.phase.refundPendingDesc'
    case 'cooldown':
      return 'cocoon.recovery.phase.cooldownDesc'
    case 'claim-pending':
      return 'cocoon.recovery.phase.claimPendingDesc'
    case 'drain-pending':
      return 'cocoon.recovery.phase.drainPendingDesc'
    case 'done':
      return 'cocoon.recovery.phase.doneDesc'
    case 'failed':
      return 'cocoon.recovery.phase.failedDesc'
  }
}
