/**
 * Send TON form with confirmation step.
 * NEVER uses parseFloat — all amounts handled via BigInt.
 */

import { useState, useEffect, memo } from 'react'
import { UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'
import { Send, ArrowLeft, LoaderCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { tonToNano, formatTonAmount } from '@/stores/wallet'
import { useTranslation } from 'react-i18next'

interface SendFormProps {
  onSend: (to: string, amount: string) => Promise<void>
  isSending: boolean
  error: string | null
  balance: string // nanoTON
}

// Detects a .ton DNS domain
function isTonDomain(input: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.ton$/.test(input)
}

// Truncates an address to first 6 + last 4 chars
function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// Validates a TON address (EQ/UQ prefix or raw 0:hex format)
function isValidTonAddress(addr: string): boolean {
  if (!addr) return false
  // EQ/UQ bounceable/non-bounceable user-friendly
  if (/^[EeUu][Qq][A-Za-z0-9_-]{46}$/.test(addr)) return true
  // Raw 0:<64hex>
  if (/^(-1|0):[0-9a-fA-F]{64}$/.test(addr)) return true
  return false
}

// Validates a TON amount string (non-zero, positive, valid decimal)
function isValidAmount(val: string): boolean {
  if (!val || val === '0' || val === '0.') return false
  if (!/^\d+(\.\d{0,9})?$/.test(val)) return false
  try {
    const nano = tonToNano(val)
    return BigInt(nano) > 0n
  } catch {
    return false
  }
}

export const SendForm = memo(function SendForm({ onSend, isSending, error, balance }: SendFormProps) {
  const { t } = useTranslation('wallet')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [success, setSuccess] = useState(false)
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null)
  const [resolveSource, setResolveSource] = useState<'wallet-record' | 'owner-fallback' | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTonDomain(to)) {
      setResolvedAddress(null)
      setResolveSource(null)
      setResolveError(null)
      return
    }
    const timer = setTimeout(() => {
      setResolving(true)
      setResolveError(null)
      window.electron.wallet
        .resolveDomain(to)
        .then((result) => {
          setResolvedAddress(result.address)
          setResolveSource(result.source)
        })
        .catch((err) => {
          setResolveError(err.message || 'Resolution failed')
          setResolvedAddress(null)
          setResolveSource(null)
        })
        .finally(() => setResolving(false))
    }, 500)
    return () => clearTimeout(timer)
  }, [to])

  const toValid = isValidTonAddress(to) || (isTonDomain(to) && !!resolvedAddress)
  const amountValid = isValidAmount(amount)
  const canProceed = toValid && amountValid

  const handleMax = () => {
    const balanceBig = BigInt(balance || '0')
    const fee = 10000000n // 0.01 TON
    const maxNano = balanceBig > fee ? balanceBig - fee : 0n
    if (maxNano > 0n) {
      // Convert nanoTON to TON display string
      setAmount(formatTonAmount(maxNano.toString()))
    }
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Allow only digits and one dot
    if (/^(\d*\.?\d*)$/.test(val)) {
      setAmount(val)
    }
  }

  const handleConfirm = () => {
    if (canProceed) setConfirming(true)
  }

  const handleSend = async () => {
    try {
      const nanoAmount = tonToNano(amount)
      const actualAddress = resolvedAddress || to
      await onSend(actualAddress, nanoAmount)
      setSuccess(true)
      setConfirming(false)
      setTo('')
      setAmount('')
      setTimeout(() => setSuccess(false), UI_NOTIFICATION_TIMEOUT_MS)
    } catch {
      setConfirming(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-2">
        <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
        <p className="text-base font-medium text-foreground">{t('send.success')}</p>
        <p className="text-sm text-muted-foreground">{t('send.successDesc')}</p>
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-muted rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">{t('send.confirm')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('send.to')}</span>
              <div className="text-right">
                {resolvedAddress ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-mono text-foreground text-xs">{to}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-muted-foreground text-xs">
                        {truncateAddress(resolvedAddress)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                        {resolveSource === 'wallet-record' ? 'DNS wallet' : 'owner'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <span className="font-mono text-foreground text-xs break-all max-w-[200px]">{to}</span>
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('send.amount')}</span>
              <span className="font-medium text-foreground">{amount} TON</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('send.fee')}</span>
              <span className="text-muted-foreground">~0.01 TON</span>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => setConfirming(false)}
            disabled={isSending}
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {t('send.back')}
          </Button>
          <Button type="button" className="flex-1" onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <LoaderCircle className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4 mr-1.5" aria-hidden="true" />
            )}
            {isSending ? t('send.sending') : t('send.confirm')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor="send-to">
          {t('send.recipientLabel')}
        </label>
        <Input
          id="send-to"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder={t('send.recipientPlaceholder')}
          className={cn(
            to && !isValidTonAddress(to) && !isTonDomain(to) && 'border-destructive focus-visible:ring-destructive'
          )}
          aria-invalid={to ? !isValidTonAddress(to) && !isTonDomain(to) : undefined}
        />
        {to && !isValidTonAddress(to) && !isTonDomain(to) && (
          <p className="text-xs text-destructive">{t('send.invalidAddress')}</p>
        )}
        {resolving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
            Resolving {to}...
          </p>
        )}
        {!resolving && resolveError && <p className="text-xs text-destructive">{resolveError}</p>}
        {!resolving && resolvedAddress && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-mono">{truncateAddress(resolvedAddress)}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
              {resolveSource === 'wallet-record' ? 'DNS wallet' : 'owner'}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor="send-amount">
          {t('send.amountLabel')}
        </label>
        <div className="relative">
          <Input
            id="send-amount"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.0"
            inputMode="decimal"
            className={cn('pr-24', amount && !amountValid && 'border-destructive focus-visible:ring-destructive')}
            aria-invalid={amount ? !amountValid : undefined}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleMax}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              {t('send.max')}
            </button>
            <span className="text-sm text-foreground pointer-events-none">TON</span>
          </div>
        </div>
        {amount && !amountValid && <p className="text-xs text-destructive">{t('send.invalidAmount')}</p>}
        <p className="text-xs text-muted-foreground">{t('send.feeNote', { fee: '~0.01' })}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={handleConfirm} disabled={!canProceed} className="w-full">
        <Send className="h-4 w-4 mr-1.5" aria-hidden="true" />
        {t('send.reviewButton')}
      </Button>
    </div>
  )
})
