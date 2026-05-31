/**
 * iOS-style -/+ stepper buttons in a rounded pill. Presentational only:
 * the caller owns value state and the increment/decrement handlers.
 */

import { Minus, Plus } from 'lucide-react'

interface StepperButtonsProps {
  onDecrement: () => void
  onIncrement: () => void
  decrementDisabled?: boolean
  incrementDisabled?: boolean
}

export function StepperButtons({
  onDecrement,
  onIncrement,
  decrementDisabled = false,
  incrementDisabled = false,
}: StepperButtonsProps) {
  return (
    <div className="inline-flex items-center rounded-full bg-surface-hover border border-border-medium h-8">
      <button
        type="button"
        onClick={onDecrement}
        disabled={decrementDisabled}
        className="flex items-center justify-center w-9 h-full rounded-l-full text-foreground hover:bg-border/50 disabled:opacity-30 transition-colors"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-5 bg-border" />
      <button
        type="button"
        onClick={onIncrement}
        disabled={incrementDisabled}
        className="flex items-center justify-center w-9 h-full rounded-r-full text-foreground hover:bg-border/50 disabled:opacity-30 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
