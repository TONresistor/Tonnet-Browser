import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, Copy, Loader2 } from 'lucide-react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { getIpcError } from '@/lib/ipc-utils'

/**
 * Renders a scannable QR code for the given address. Mirrors the pattern used
 * by the wallet's ReceivePanel.
 */
function AddressQR({ address }: { address: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !address) return
    QRCode.toCanvas(canvasRef.current, address, {
      width: 160,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch(() => {
      // QR generation failures are non-fatal; the user can still copy the
      // address manually below.
    })
  }, [address])

  return <canvas ref={canvasRef} className="rounded-lg" width={160} height={160} />
}

// Threshold is 19.99 TON, not exactly 20, to absorb the small network fees
// deducted from the user's "send 20 TON" transfer. Without this, a user who
// sends exactly 20 TON sees a "20.00 TON" display (toFixed(2) rounds up from
// e.g. 19.995) but BigInt strict-compare against 20_000_000_000n fails and
// the wizard stays stuck on "Waiting…".
const FUND_THRESHOLD_NANO = 19_990_000_000n

function nanoToTon(nano: string): string {
  return (Number(nano) / 1e9).toFixed(2)
}

interface Props {
  ownerAddress: string
  onComplete: () => void
  /** Optional: when undefined, the Back button is hidden (resume-mode wizard). */
  onBack?: () => void
}

export function Step3Fund({ ownerAddress, onComplete, onBack }: Props) {
  const [balance, setBalance] = useState<string | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const funded = balance !== null && BigInt(balance) >= FUND_THRESHOLD_NANO

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const fetchBalance = useCallback(async () => {
    try {
      const b = await window.electron.cocoon.getOwnerBalance()
      // Guard against IPC error envelopes: if the main side returned
      // {success:false, error:'...'} instead of a nano-TON string, skip
      // the update rather than calling BigInt() on an object.
      const err = getIpcError(b)
      if (err) {
        setBalanceError(err)
        return
      }
      setBalanceError(null)
      setBalance(b)
      if (BigInt(b) >= FUND_THRESHOLD_NANO) {
        stopPolling()
      }
    } catch {
      // Ignore transient errors; poll will retry in 5s.
    }
  }, [stopPolling])

  useEffect(() => {
    fetchBalance()
    pollRef.current = setInterval(fetchBalance, 5_000)
    return () => {
      stopPolling()
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [fetchBalance, stopPolling])

  const handleCopyAddress = async () => {
    await navigator.clipboard.writeText(ownerAddress)
    setCopied(true)
    copyTimerRef.current = setTimeout(() => setCopied(false), 3_000)
  }

  const handleContinue = () => {
    stopPolling()
    onComplete()
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Step 3: Fund your wallet</h2>
        <p className="text-sm text-muted-foreground">Send at least 20 TON to your owner address (stake amount).</p>
      </div>

      <div className="p-3 bg-muted rounded-lg border border-border space-y-3">
        <div className="flex justify-center pt-1">
          <AddressQR address={ownerAddress} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Owner address</p>
          <div className="flex items-start gap-2">
            <code className="flex-1 text-xs font-mono text-foreground break-all leading-relaxed">{ownerAddress}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={handleCopyAddress}
              aria-label="Copy address"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg border border-border flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Current balance</p>
          <p className="text-2xl font-mono font-semibold text-foreground">
            {balance !== null ? `${nanoToTon(balance)} TON` : '0.00 TON'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Required: 20.00 TON minimum</p>
          {balanceError && (
            <p className="text-[11px] text-red-400 mt-1">Failed to load balance: {balanceError}. Retrying…</p>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          {funded ? (
            <>
              <CheckCircle2 className="h-6 w-6 text-green-400" />
              <span className="text-[11px] text-green-400">Funded</span>
            </>
          ) : (
            <>
              <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
              <span className="text-[11px] text-muted-foreground">Waiting…</span>
            </>
          )}
        </div>
      </div>

      <div className={`flex pt-1 ${onBack ? 'justify-between' : 'justify-end'}`}>
        {onBack && (
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        <Button type="button" size="sm" onClick={handleContinue} disabled={!funded}>
          Continue
        </Button>
      </div>
    </div>
  )
}
