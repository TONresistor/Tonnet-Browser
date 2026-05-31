import { Input } from '@/components/ui/input'
import { StepperButtons } from '../shared/StepperButtons'

export interface TonStepperFieldProps {
  value: string
  onValueChange: (v: string) => void
  onBlur: () => void
  ariaLabel: string
  step?: number
}

export function TonStepperField({ value, onValueChange, onBlur, ariaLabel, step = 0.5 }: TonStepperFieldProps) {
  const numVal = parseFloat(value) || 0
  const decrement = () => {
    const next = Math.max(0, numVal - step)
    const display = Number.isInteger(next) ? String(next) : next.toFixed(1)
    onValueChange(display)
  }
  const increment = () => {
    const next = numVal + step
    const display = Number.isInteger(next) ? String(next) : next.toFixed(1)
    onValueChange(display)
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-24">
        <Input
          value={value}
          onChange={(e) => {
            if (/^(\d*\.?\d*)$/.test(e.target.value)) onValueChange(e.target.value)
          }}
          onBlur={onBlur}
          inputMode="decimal"
          className="pr-10 text-right"
          aria-label={ariaLabel}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          TON
        </span>
      </div>
      <StepperButtons
        onDecrement={() => {
          decrement()
          onBlur()
        }}
        onIncrement={() => {
          increment()
          onBlur()
        }}
        decrementDisabled={numVal <= 0}
      />
    </div>
  )
}
