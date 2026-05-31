/**
 * Inline tip pills for .ton sites.
 * Renders 3 pill buttons (0.1, 0.5, 1 TON) directly inside the address bar.
 */

import { useState, useCallback, useEffect } from 'react'
import { LoaderCircle, Check } from 'lucide-react'
import { useWalletStore, tonToNano } from '@/stores/wallet'
import { TX_FEE_RESERVE_NANO } from '@/lib/ton-utils'
import { getIpcError } from '@/lib/ipc-utils'
import { cn } from '@/lib/utils'

interface TipButtonProps {
  domain: string
}

type TipState = 'idle' | 'resolving' | 'sending' | 'success' | 'error'

const TIP_AMOUNTS = ['0.1', '0.5', '1'] as const

export function TipButton({ domain }: TipButtonProps) {
  const balance = useWalletStore((s) => s.balance)
  const [state, setState] = useState<TipState>('idle')
  const [activeAmount, setActiveAmount] = useState<string | null>(null)

  const handleTip = useCallback(
    async (amount: string) => {
      const nanoAmount = tonToNano(amount)
      const balanceBig = BigInt(balance)
      const amountBig = BigInt(nanoAmount)

      if (amountBig + TX_FEE_RESERVE_NANO > balanceBig) {
        setState('error')
        setActiveAmount(amount)
        return
      }

      setActiveAmount(amount)
      setState('resolving')
      try {
        const result = await window.electron.dns.resolve(domain)
        const err = getIpcError(result)
        if (err) throw new Error(err)
        if (!result?.owner) throw new Error('Could not resolve domain owner')

        setState('sending')
        const sendResult = await window.electron.wallet.send(result.owner, nanoAmount)
        const sendErr = getIpcError(sendResult)
        if (sendErr) throw new Error(sendErr)

        setState('success')
      } catch {
        setState('error')
      }
    },
    [domain, balance]
  )

  // Auto-reset after success/error
  useEffect(() => {
    if (state === 'success' || state === 'error') {
      const timer = setTimeout(
        () => {
          setState('idle')
          setActiveAmount(null)
        },
        state === 'success' ? 2000 : 3000
      )
      return () => clearTimeout(timer)
    }
  }, [state])

  const isProcessing = state === 'resolving' || state === 'sending'

  return (
    <div className="flex items-center gap-1">
      {TIP_AMOUNTS.map((amount) => {
        const isActive = activeAmount === amount
        const showSpinner = isActive && isProcessing
        const showCheck = isActive && state === 'success'
        const showError = isActive && state === 'error'

        return (
          <button
            key={amount}
            type="button"
            onClick={() => handleTip(amount)}
            disabled={isProcessing}
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors whitespace-nowrap',
              'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              showCheck && 'bg-green-500/15 text-green-500',
              showError && 'bg-destructive/15 text-destructive',
              isProcessing && !isActive && 'opacity-40 pointer-events-none'
            )}
            title={`Tip ${amount} TON to ${domain}`}
          >
            {showSpinner ? (
              <LoaderCircle className="h-3 w-3 animate-spin" />
            ) : showCheck ? (
              <Check className="h-3 w-3" />
            ) : (
              `${amount}`
            )}
          </button>
        )
      })}
    </div>
  )
}
