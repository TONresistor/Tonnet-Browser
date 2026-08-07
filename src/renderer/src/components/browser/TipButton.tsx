/**
 * Inline tip pills for .ton sites.
 * Renders 3 pill buttons (0.1, 0.5, 1 TON) directly inside the address bar.
 */

import { useState, useCallback, useEffect } from 'react'
import { LoaderCircle, Check } from 'lucide-react'
import { useWalletStore } from '@/features/wallet/store'
import { tonToNano } from '@/lib/ton-utils'
import { walletClient } from '@/features/wallet/client'
import { dnsClient } from '@/features/dns/client'
import { TX_FEE_RESERVE_NANO } from '@/lib/ton-utils'
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
        const result = await dnsClient.resolve(domain)
        if (!result?.owner) throw new Error('Could not resolve domain owner')

        setState('sending')
        await walletClient.send(result.owner, nanoAmount)

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
              'bg-muted/50 text-chrome-foreground hover:bg-muted',
              showCheck && 'bg-success/15 text-success',
              showError && 'bg-destructive/15 text-destructive',
              isProcessing && !isActive && 'opacity-40 pointer-events-none'
            )}
            title={`Tip ${amount} GRAM to ${domain}`}
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
