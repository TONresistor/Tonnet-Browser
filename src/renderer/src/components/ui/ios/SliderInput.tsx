import { cn } from '@/lib/utils'

interface SliderInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  ariaLabel: string
  compact?: boolean
  className?: string
}

export function SliderInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  ariaLabel,
  compact = false,
  className,
}: SliderInputProps) {
  const progress = Math.round(((value - min) / (max - min)) * 100)
  const background = `linear-gradient(to right, hsl(var(--primary)) ${progress}%, hsl(var(--border) / 0.5) ${progress}%)`

  return (
    <div className={cn('flex items-center', compact ? 'w-40 gap-2' : 'w-48 gap-3', className)}>
      <input
        type="range"
        className={cn(
          'slider-input min-w-0 flex-1 cursor-pointer appearance-none rounded-pill outline-none',
          compact && 'compact'
        )}
        style={{ background }}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
      />
      <span
        className={cn(
          'min-w-12 text-center text-xs tabular-nums',
          compact ? 'text-chrome-foreground' : 'rounded-pill bg-surface-hover px-2 py-0.5 text-muted-foreground'
        )}
      >
        {value}
        {suffix}
      </span>
    </div>
  )
}
