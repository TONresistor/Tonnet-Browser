import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  disabled?: boolean
  fullWidth?: boolean
  ariaLabel?: string
  className?: string
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  fullWidth,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role={ariaLabel ? 'tablist' : undefined}
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-segment bg-surface p-[2px]', fullWidth && 'flex w-full', className)}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role={ariaLabel ? 'tab' : undefined}
            aria-selected={ariaLabel ? selected : undefined}
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-control px-3 py-1 text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50',
              fullWidth && 'flex-1',
              selected ? 'bg-elevation-4 text-foreground shadow-control' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
