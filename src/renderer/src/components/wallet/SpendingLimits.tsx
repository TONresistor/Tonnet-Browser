/**
 * Spending limits configuration.
 * All values displayed in TON, stored as nanoTON strings.
 * Uses BigInt for all conversions, never parseFloat.
 */

import { useState, useEffect, useCallback } from 'react'
import { Shield } from 'lucide-react'
import { tonToNano, formatTonAmount } from '@/stores/wallet'
import type { SpendingLimits as SpendingLimitsType } from '@shared/types'

interface LimitFieldProps {
  label: string
  description: string
  value: string
  onChange: (nanoValue: string) => void
}

function LimitField({ label, description, value, onChange }: LimitFieldProps) {
  const displayValue = value === '0' ? '' : formatTonAmount(value)
  const [inputValue, setInputValue] = useState(displayValue)

  useEffect(() => {
    setInputValue(value === '0' ? '' : formatTonAmount(value))
  }, [value])

  const handleBlur = useCallback(() => {
    if (!inputValue || inputValue.trim() === '') {
      onChange('0')
      return
    }

    // Validate: only digits and at most one dot
    if (!/^\d+(\.\d{0,9})?$/.test(inputValue.trim())) {
      setInputValue(value === '0' ? '' : formatTonAmount(value))
      return
    }

    const nano = tonToNano(inputValue.trim())
    onChange(nano)
  }, [inputValue, onChange, value])

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={(e) => {
            const val = e.target.value
            if (/^(\d*\.?\d*)$/.test(val)) {
              setInputValue(val)
            }
          }}
          onBlur={handleBlur}
          placeholder="0 (unlimited)"
          className="w-full px-3 py-2 pr-14 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">TON</span>
      </div>
    </div>
  )
}

export function SpendingLimits() {
  const [limits, setLimits] = useState<SpendingLimitsType>({
    perRequest: '0',
    perDay: '0',
    perSitePerMonth: '0',
  })

  useEffect(() => {
    window.electron.settings.get('wallet').then((settings) => {
      if (settings && settings.limits) {
        setLimits(settings.limits)
      }
    })
  }, [])

  const updateLimit = useCallback((key: keyof SpendingLimitsType, value: string) => {
    setLimits((prev) => {
      const updated = { ...prev, [key]: value }
      window.electron.settings.set('wallet', { limits: updated })
      return updated
    })
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Spending Limits</h3>
      </div>

      <div className="space-y-4">
        <LimitField
          label="Per request"
          description="Maximum amount for a single 402 payment"
          value={limits.perRequest}
          onChange={(v) => updateLimit('perRequest', v)}
        />

        <LimitField
          label="Per day"
          description="Maximum total spending in a rolling 24-hour window"
          value={limits.perDay}
          onChange={(v) => updateLimit('perDay', v)}
        />

        <LimitField
          label="Per site per month"
          description="Maximum spending per domain in a rolling 30-day window"
          value={limits.perSitePerMonth}
          onChange={(v) => updateLimit('perSitePerMonth', v)}
        />
      </div>

      <p className="text-xs text-muted-foreground">Set to 0 for unlimited. Limits are enforced across all tabs.</p>
    </div>
  )
}
