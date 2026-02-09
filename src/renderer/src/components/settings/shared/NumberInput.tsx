/**
 * Input numérique réutilisable
 */

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}

export function NumberInput({ value, onChange, min, max, step = 1, suffix }: NumberInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-24 px-3 py-1.5 rounded-full text-sm text-foreground text-right outline-none bg-surface-hover border border-border-medium"
      />
      {suffix && <span className="text-muted-foreground text-sm">{suffix}</span>}
    </div>
  )
}
