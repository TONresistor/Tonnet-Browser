import { Input } from '@/components/ui/input'
import { StepperButtons } from './StepperButtons'

export interface TonStepperFieldProps {
  value: string
  onChange: (v: string) => void
  /** Commit the value. Receives the fresh stepped value so a +/- click doesn't
   *  commit the stale pre-step value from a closure. */
  onBlur: (committedValue?: string) => void
  ariaLabel: string
  step?: number
}

/** Pure: the next display string after stepping `value` by `dir * step` (>= 0). */
export function computeStep(value: string, step: number, dir: 1 | -1): string {
  const next = Math.max(0, (parseFloat(value) || 0) + dir * step)
  return Number.isInteger(next) ? String(next) : next.toFixed(1)
}

export function TonStepperField({ value, onChange, onBlur, ariaLabel, step = 0.5 }: TonStepperFieldProps) {
  const numVal = parseFloat(value) || 0
  const stepBy = (dir: 1 | -1) => {
    const display = computeStep(value, step, dir)
    onChange(display)
    return display
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-24">
        <Input
          value={value}
          onChange={(e) => {
            if (/^(\d*\.?\d*)$/.test(e.target.value)) onChange(e.target.value)
          }}
          onBlur={() => onBlur()}
          inputMode="decimal"
          className="pr-10 text-right"
          aria-label={ariaLabel}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          GRAM
        </span>
      </div>
      <StepperButtons
        onDecrement={() => onBlur(stepBy(-1))}
        onIncrement={() => onBlur(stepBy(1))}
        decrementDisabled={numVal <= 0}
      />
    </div>
  )
}
