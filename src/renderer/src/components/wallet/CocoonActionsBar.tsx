/**
 * State-aware button row for the Cocoon account view.
 *
 * Renders the appropriate primary action (Activate / Open chat / Withdrawing…)
 * and a secondary Withdraw button when applicable. Backend handles the heavy
 * lifting (`flowStake` for activate, `flowUnstake` for withdraw); this
 * component is just a thin wrapper around `useCocoonAccountView`.
 */

import { memo, useCallback, useState } from 'react'
import { ArrowDownCircle, Power, Loader2, AlertTriangle, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getIpcError } from '@/lib/ipc-utils'
import { createLogger } from '@/logger'
import type { CocoonAccountSnapshot } from '@/hooks/useCocoonAccountView'

const log = createLogger('cocoon:actions-bar')

interface CocoonActionsBarProps {
  /** Current cocoon account snapshot (drives labels and disabled states). */
  snapshot: CocoonAccountSnapshot
  /** Activate flow trigger — single atomic IPC call. */
  onActivate: () => Promise<void>
  /** Called after a successful action so the parent refetches state. */
  onActionComplete: () => void
  /** Called when the user wants to open the Cocoon chat (active state). */
  onOpenChat?: () => void
  /** Compact button styling for the sidebar. */
  compact?: boolean
}

export const CocoonActionsBar = memo(function CocoonActionsBar({
  snapshot,
  onActivate,
  onActionComplete,
  onOpenChat,
  compact = false,
}: CocoonActionsBarProps) {
  const { t } = useTranslation('wallet')
  const [busy, setBusy] = useState<'activate' | 'withdraw' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleActivate = useCallback(async () => {
    setBusy('activate')
    setError(null)
    try {
      await onActivate()
      onActionComplete()
    } catch (e) {
      // The hook already set snapshot.error; keep a local copy too so the
      // notice survives a snapshot refresh.
      setError((e as Error).message ?? t('account.errors.activateFailed'))
    } finally {
      setBusy(null)
    }
  }, [onActivate, onActionComplete, t])

  const handleWithdraw = useCallback(async () => {
    setBusy('withdraw')
    setError(null)
    try {
      const r = await window.electron.cocoon.recoveryAll()
      const ipcErr = getIpcError(r)
      if (ipcErr) {
        setError(ipcErr)
        return
      }
      onActionComplete()
    } catch (e) {
      log.warn('withdraw failed', e)
      setError((e as Error).message ?? 'withdraw failed')
    } finally {
      setBusy(null)
    }
  }, [onActionComplete])

  const buttonClass = compact
    ? 'h-10 flex items-center justify-center gap-1.5 rounded-full bg-surface-hover border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150'
    : 'h-9 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200'

  const primaryButtonClass = compact
    ? 'h-10 flex items-center justify-center gap-1.5 rounded-full bg-foreground text-background text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150'
    : 'h-9 flex items-center justify-center gap-2 rounded-full bg-foreground text-background text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200'

  // Top-level error notice (renders above the button row in every state).
  const errorNotice = error ? (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/5">
      <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
      <p className="text-xs text-destructive">{error}</p>
    </div>
  ) : null

  if (snapshot.status === 'idle') {
    return (
      <div className="space-y-2">
        {errorNotice}
        <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={handleActivate}>
          {busy === 'activate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
          {t('account.actions.activate')}
        </button>
      </div>
    )
  }

  if (snapshot.status === 'activating') {
    return (
      <div className="space-y-2">
        {errorNotice}
        <button type="button" className={primaryButtonClass} disabled>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('account.activating')}
        </button>
      </div>
    )
  }

  if (snapshot.status === 'active') {
    return (
      <div className="space-y-2">
        {errorNotice}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy !== null || !onOpenChat}
            onClick={onOpenChat}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {t('account.openChat')}
          </button>
          <button type="button" className={buttonClass} disabled={busy !== null} onClick={handleWithdraw}>
            {busy === 'withdraw' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowDownCircle className="h-3.5 w-3.5" />
            )}
            {t('account.actions.withdrawAll')}
          </button>
        </div>
      </div>
    )
  }

  // status === 'withdrawing'
  return (
    <div className="space-y-2">
      {errorNotice}
      <button type="button" className={buttonClass} disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('account.actions.withdrawing')}
      </button>
    </div>
  )
})
