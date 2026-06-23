import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { getIpcError } from '@/lib/ipc-utils'
import { formatTonFixed } from '@/lib/ton-utils'
import { cn } from '@/lib/utils'
import { ActionButton } from '@/components/ui/ios/ActionButton'

type StakeStatus = 'idle' | 'transferring' | 'transferred' | 'starting' | 'done' | 'error'

interface Props {
  onComplete: () => void
  /** Optional: when undefined, the Back button is hidden. */
  onBack?: () => void
  /**
   * When true, the cocoon node wallet was detected as already funded on-chain
   * (browser restart between fund and start). The fund phase is skipped and
   * we go straight to start() — re-funding would fail since the owner only
   * has the gas reserve left.
   */
  initialFunded?: boolean
}

export function Step4Stake({ onComplete, onBack, initialFunded = false }: Props) {
  const [status, setStatus] = useState<StakeStatus>('idle')
  // Tracks whether fundCocoon has already succeeded, so Retry skips re-funding.
  const [funded, setFunded] = useState(initialFunded)
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (completionTimerRef.current !== null) clearTimeout(completionTimerRef.current)
    }
  }, [])
  const [sentAmount, setSentAmount] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleStake = async () => {
    setErrorMsg(null)

    // Fund phase: only run if not already funded.
    // This prevents a second fundCocoon call on Retry after start() fails.
    if (!funded) {
      setStatus('transferring')
      const fundResult = await window.electron.cocoon.fundCocoon('max')
      const fundErr = getIpcError(fundResult)
      if (fundErr) {
        setErrorMsg(fundErr)
        setStatus('error')
        return
      }
      setSentAmount(fundResult.sentAmount)
      setFunded(true)
      setStatus('transferred')
      // Brief delay so the user reads 'Transfer sent' before we move to 'Starting'.
      await new Promise<void>((r) => setTimeout(r, 1000))
    }

    // Start phase: always runs (and re-runs on Retry if start previously failed).
    setStatus('starting')
    const startResult = await window.electron.cocoon.start()
    const startErr = getIpcError(startResult)
    if (startErr) {
      setErrorMsg(startErr)
      setStatus('error')
      return
    }

    // Persist the "setup complete" flag so a browser restart goes straight
    // to the chat UI instead of resuming the wizard. If this fails the runner
    // is already running, so we surface the error rather than silently
    // bypassing it: otherwise the next restart would land back on the wizard
    // with no obvious cause.
    const markResult = await window.electron.cocoon.walletMarkSetupComplete()
    const markErr = getIpcError(markResult)
    if (markErr) {
      setErrorMsg(`Started, but persistence failed: ${markErr}`)
      setStatus('error')
      return
    }

    setStatus('done')
    completionTimerRef.current = setTimeout(onComplete, 1500)
  }

  const busy = status === 'transferring' || status === 'transferred' || status === 'starting'

  const statusLine = (): string => {
    switch (status) {
      case 'idle':
        return ''
      case 'transferring':
        return 'Transferring to cocoon wallet…'
      case 'transferred':
        return sentAmount
          ? `Transfer sent (${formatTonFixed(sentAmount)} GRAM). Waiting for confirmation…`
          : 'Transfer sent. Waiting for confirmation…'
      case 'starting':
        return 'Starting Cocoon AI runner…'
      case 'done':
        return 'Setup complete!'
      case 'error':
        return `Failed: ${errorMsg}`
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground">Connect to Cocoon</h2>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          Keep your browser open while your Cocoon wallet opens a channel with the Cocoon network.
        </p>
      </div>

      {/* Progress — only once the connection is underway. */}
      {status !== 'idle' && (
        <div className="flex min-h-[60px] items-center gap-3 rounded-card border border-border-subtle bg-elevation-2 p-4">
          {status === 'done' && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
          {busy && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />}
          <p
            className={cn(
              'text-sm',
              status === 'error' ? 'text-destructive' : status === 'done' ? 'text-success' : 'text-foreground'
            )}
          >
            {statusLine()}
          </p>
        </div>
      )}

      {/* Stacked so the CTA stays on one line in the narrow sidebar. */}
      <div className="flex flex-col gap-2">
        {status === 'error' ? (
          <ActionButton variant="filled" onClick={handleStake} className="w-full">
            Retry
          </ActionButton>
        ) : (
          <ActionButton
            variant="filled"
            onClick={handleStake}
            disabled={busy || status === 'done'}
            className="w-full"
            icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          >
            {busy ? 'Connecting…' : 'Connect to Cocoon'}
          </ActionButton>
        )}

        {onBack && (
          <ActionButton
            variant="gray"
            onClick={onBack}
            // Once funded, the owner is at gas reserve and Step 3's polling
            // will never reach the 20 TON threshold again. Lock the back path.
            disabled={busy || status === 'done' || funded}
            className="w-full"
          >
            Back
          </ActionButton>
        )}
      </div>
    </div>
  )
}
