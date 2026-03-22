/**
 * Stepper iOS-style : boutons -/+ dans une pilule arrondie
 */

import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'

interface StepperInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  editable?: boolean
}

export function StepperInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  editable = false,
}: StepperInputProps) {
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState(String(value))

  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const decrement = () => onChange(clamp(value - step))
  const increment = () => onChange(clamp(value + step))

  const commitEdit = () => {
    const parsed = parseInt(inputValue)
    if (!isNaN(parsed)) onChange(clamp(parsed))
    else setInputValue(String(value))
    setEditing(false)
  }

  const valueDisplay =
    editable && editing ? (
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
        autoFocus
        className="w-16 text-sm text-foreground tabular-nums text-right bg-transparent outline-none"
        min={min}
        max={max}
      />
    ) : (
      <span
        className={`text-sm text-foreground tabular-nums min-w-[2.5rem] text-right ${editable ? 'cursor-text' : ''}`}
        onClick={() => {
          if (editable) {
            setInputValue(String(value))
            setEditing(true)
          }
        }}
      >
        {value}
      </span>
    )

  return (
    <div className="flex items-center gap-2">
      {valueDisplay}
      {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      <div className="inline-flex items-center rounded-full bg-surface-hover border border-border-medium h-8">
        <button
          onClick={decrement}
          disabled={value <= min}
          className="flex items-center justify-center w-9 h-full rounded-l-full text-foreground hover:bg-border/50 disabled:opacity-30 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div className="w-px h-5 bg-border" />
        <button
          onClick={increment}
          disabled={value >= max}
          className="flex items-center justify-center w-9 h-full rounded-r-full text-foreground hover:bg-border/50 disabled:opacity-30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
